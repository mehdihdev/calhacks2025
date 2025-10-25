// Configure your backend URL in extension storage or hardcode for now:
const DEFAULT_BACKEND = "http://localhost:4000";

async function getBackend() {
  const { backendUrl } = await chrome.storage.sync.get(["backendUrl"]);
  return backendUrl || DEFAULT_BACKEND;
}

async function classify(payload) {
  const backend = await getBackend();
  const res = await fetch(`${backend}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}

// Keep last status per tab
const state = new Map(); // tabId -> { productive, reason, category, url, title }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "SNAPSHOT") return;
  const tabId = sender.tab?.id;
  if (!tabId) return;

  classify(msg.payload)
    .then(result => {
      state.set(tabId, { ...result, ...msg.payload });
      // Optionally log event
      fetch(`${DEFAULT_BACKEND}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...msg.payload, ...result, ts: Date.now() })
      }).catch(() => {});
      sendResponse({ ok: true, result });
    })
    .catch(err => {
      console.error(err);
      sendResponse({ ok: false, error: String(err) });
    });
  // Indicate async response
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => state.delete(tabId));

// For popup to fetch current tab status:
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "GET_STATUS") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const s = state.get(tab?.id) || null;
    sendResponse({ status: s });
  });
  return true;
});
