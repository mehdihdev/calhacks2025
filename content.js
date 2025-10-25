// Debounced send to background when URL/title changes.
let lastSent = { url: null, title: null };
let timer = null;

function sendSnapshot() {
  const payload = { url: location.href, title: document.title || "" };
  if (payload.url === lastSent.url && payload.title === lastSent.title) return;
  lastSent = payload;
  chrome.runtime.sendMessage({ type: "SNAPSHOT", payload });
}

// Trigger on common navigation/title-change events
const observeTitle = () => {
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(sendSnapshot, 300);
  });
  obs.observe(titleEl, { subtree: true, childList: true, characterData: true });
};

window.addEventListener("load", () => {
  observeTitle();
  sendSnapshot();
});
window.addEventListener("popstate", () => {
  clearTimeout(timer);
  timer = setTimeout(sendSnapshot, 200);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) sendSnapshot();
});
