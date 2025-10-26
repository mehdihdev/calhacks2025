// ================================
// 🧠 Productivity Tracker - Service Worker
// ================================

// ---- Config ----
const DEFAULT_BACKEND = "http://127.0.0.1:5000"; 
// ---- Storage helpers ----
async function getBackend() {
  const { backendUrl } = await chrome.storage.sync.get(["backendUrl"]);
  return backendUrl || DEFAULT_BACKEND;
}

// ---- Balance system ----
let balance = 10.0; // start with $10

function deductMoney(amount) {
  balance = Math.max(0, balance - amount);
  chrome.storage.sync.set({ balance });
  console.log(`💸 Deducted $${amount.toFixed(2)} → new balance: $${balance.toFixed(2)}`);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_BALANCE") {
    sendResponse({ balance });
  }
});

// ---- Backend call ----
async function classify(payload) {
  try {
    const backend = await getBackend();
    console.log("Classifying with backend:", backend, "payload:", payload);
    const res = await fetch(`${backend}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log("Classification response status:", res.status);
    if (!res.ok) throw new Error(`Backend error: ${res.status}`);
    const result = await res.json();
    console.log("Classification result:", result);
    return result;
  } catch (error) {
    console.error("Classification error:", error);
    throw error;
  }
}

// ---- State ----
const state = new Map(); // tabId -> { productive, reason, category, url, title }

// ---- Persistent Fish System ----
const persistentFishTimers = new Map(); // tabId -> timer ID
const FISH_INTERVAL = 3000; // repeat berating every 3s

function startPersistentFish(tabId, category) {
  console.log("🐟 Starting persistent Fish for tab:", tabId);
  stopPersistentFish(tabId);

  let count = 0;
  const timer = setInterval(async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) return stopPersistentFish(tabId);

      const result = await classifyTab(tabId);
      if (result && !res
