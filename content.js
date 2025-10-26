// content.js — watches the page and notifies background for classification
let lastSent = { url: null, title: null };
let timer = null;
let lastClassification = null;

function sendSnapshot() {
  const payload = { url: location.href, title: document.title || "" };
  if (payload.url === lastSent.url && payload.title === lastSent.title) return;
  lastSent = payload;

  chrome.runtime.sendMessage({ type: "SNAPSHOT", payload }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("SNAPSHOT error:", chrome.runtime.lastError);
      return;
    }

    console.log("Classification response:", response);

    // If site is unproductive and not already punished recently
    if (
      response &&
      response.result &&
      !response.result.productive &&
      lastClassification !== response.result.url
    ) {
      lastClassification = response.result.url;
      console.log("Unproductive site detected!");

      // Trigger the backend punishment call
      chrome.runtime.sendMessage(
        {
          type: "TRIGGER_PUNISHMENT",
          reason: response.result.reason || "Unproductive site detected",
        },
        (res) => {
          console.log("Punishment triggered:", res);
        }
      );

      // Show floating 💸 animation
      showMoneyLossOverlay();
    }
  });
}

// Simple on-screen money loss animation
function showMoneyLossOverlay() {
  const div = document.createElement("div");
  div.textContent = "💸 -$0.50";
  Object.assign(div.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(255, 0, 0, 0.8)",
    color: "white",
    fontWeight: "bold",
    fontSize: "28px",
    padding: "12px 20px",
    borderRadius: "12px",
    zIndex: 999999,
    opacity: "1",
    transition: "opacity 2s ease-out, transform 2s ease-out",
  });

  document.body.appendChild(div);

  // Fade away gracefully
  setTimeout(() => {
    div.style.opacity = "0";
    div.style.transform = "translate(-50%, -80%)";
  }, 100);

  // Remove after animation
  setTimeout(() => div.remove(), 2500);
}

// Observe title and navigation events
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
