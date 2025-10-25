// ---- Config ----
const DEFAULT_BACKEND = "http://localhost:4000";

// ---- Storage helpers ----
async function getBackend() {
  const { backendUrl } = await chrome.storage.sync.get(["backendUrl"]);
  return backendUrl || DEFAULT_BACKEND;
}

// ---- Backend call ----
async function classify(payload) {
  const backend = await getBackend();
  const res = await fetch(`${backend}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}

// ---- State: last known result per tab ----
const state = new Map(); // tabId -> { productive, reason, category, url, title }

// ---- Core: classify a tab now ----
async function classifyTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) return null;

  // Skip unsupported/privileged URLs
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    return null;
  }

  const payload = { url: tab.url, title: tab.title || "" };
  const result = await classify(payload);
  const merged = { ...result, ...payload };
  state.set(tabId, merged);
  return merged;
}

// ---- Handle messages from content script (URL/title changes) ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SNAPSHOT") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    classify(msg.payload)
      .then((result) => {
        const merged = { ...result, ...msg.payload };
        state.set(tabId, merged);
        sendResponse({ ok: true, result: merged });
      })
      .catch((err) => {
        console.error("SNAPSHOT classify failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async
  }

  if (msg?.type === "GET_STATUS") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab) return sendResponse({ status: null });
      const s = state.get(tab.id) || null;
      sendResponse({ status: s });
    });
    return true; // async
  }

  // Trigger a fresh classification when popup opens
  if (msg?.type === "CLASSIFY_ACTIVE") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab || !tab.id || !tab.url) {
        return sendResponse({ ok: false, error: "No active tab", status: null });
      }
      if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
        return sendResponse({ ok: false, error: "Blocked URL", status: null });
      }
      try {
        const s = await classifyTab(tab.id);
        sendResponse({ ok: true, status: s || null });
      } catch (e) {
        sendResponse({ ok: false, error: String(e), status: null });
      }
    });
    return true; // async
  }
});

// ---- Proactive updates on tab switches/loads ----
chrome.tabs.onActivated.addListener(({ tabId }) => {
  classifyTab(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    classifyTab(tabId).catch(() => {});
  }
});

// ---- Cleanup ----
chrome.tabs.onRemoved.addListener((tabId) => state.delete(tabId));
