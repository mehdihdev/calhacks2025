// Debounced send to background when URL/title changes.
let lastSent = { url: null, title: null };
let timer = null;
let lastClassification = null;

function sendSnapshot() {
  const payload = { url: location.href, title: document.title || "" };
  if (payload.url === lastSent.url && payload.title === lastSent.title) return;
  lastSent = payload;
  chrome.runtime.sendMessage({ type: "SNAPSHOT", payload }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('SNAPSHOT error:', chrome.runtime.lastError);
      return;
    }
    
    console.log('Content script received response:', response);
    
    // Check if this is an unproductive site and we haven't already played audio
    if (response && response.result && !response.result.productive && 
        lastClassification !== response.result.url) {
      lastClassification = response.result.url;
      console.log('Unproductive site detected, triggering audio and popup');
      
      // Wait 3 seconds for video to start playing, then berate the user
      setTimeout(() => {
        // Trigger audio berating
        chrome.runtime.sendMessage({ 
          type: "PLAY_BERATING_AUDIO", 
          category: response.result.category 
        }, (audioResponse) => {
          if (chrome.runtime.lastError) {
            console.error('PLAY_BERATING_AUDIO error:', chrome.runtime.lastError);
          } else {
            console.log('Audio berating triggered successfully');
          }
        });
        
        // Trigger popup to open
        chrome.runtime.sendMessage({ 
          type: "OPEN_POPUP" 
        }, (popupResponse) => {
          if (chrome.runtime.lastError) {
            console.error('OPEN_POPUP error:', chrome.runtime.lastError);
          } else {
            console.log('Popup notification triggered successfully');
          }
        });
      }, 3000); // 3 second delay
    }
  });
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
