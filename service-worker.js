// ---- Config ----
const DEFAULT_BACKEND = "http://localhost:4000";

// ---- Storage helpers ----
async function getBackend() {
  const { backendUrl } = await chrome.storage.sync.get(["backendUrl"]);
  return backendUrl || DEFAULT_BACKEND;
}

// ---- Backend call ----
async function classify(payload) {
  try {
    const backend = await getBackend();
    console.log('Classifying with backend:', backend, 'payload:', payload);
    const res = await fetch(`${backend}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log('Classification response status:', res.status);
    if (!res.ok) throw new Error(`Backend error: ${res.status}`);
    const result = await res.json();
    console.log('Classification result:', result);
    return result;
  } catch (error) {
    console.error('Classification error:', error);
    throw error;
  }
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
  
  // Note: Audio is triggered from content script, not here
  // This prevents duplicate audio triggers
  
  return merged;
}

// ---- Audio berating functionality ----
async function playBeratingAudio(category, targetTabId = null) {
  try {
    const backend = await getBackend();
    const response = await fetch(`${backend}/berate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message: "berate", 
        category: category || "entertainment" 
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const message = data.message;
      console.log('Got berating message:', message);
      
      // Determine which tab to inject into
      let targetTab;
      if (targetTabId) {
        try {
          targetTab = await chrome.tabs.get(targetTabId);
        } catch (error) {
          console.error('Failed to get target tab:', error);
          return;
        }
      } else {
        // Fallback to active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTab = tabs[0];
      }
      
      if (targetTab) {
        console.log('Injecting script into tab:', targetTab.id, targetTab.url);
        chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          function: (message) => {
            // Include all functions in the injected script
            function pauseAllMedia() {
              console.log('pauseAllMedia called');
              
              // Pause all video elements
              const videos = document.querySelectorAll('video');
              console.log('Found video elements:', videos.length);
              videos.forEach(video => {
                if (!video.paused) {
                  video.pause();
                  video.currentTime = 0; // Reset to beginning
                  video.muted = true; // Mute it
                  console.log('Paused video element');
                }
              });

              // Pause all audio elements
              const audios = document.querySelectorAll('audio');
              audios.forEach(audio => {
                if (!audio.paused) {
                  audio.pause();
                  console.log('Paused audio element');
                }
              });

              // Try to pause YouTube videos specifically
              const youtubePlayer = document.querySelector('#movie_player video');
              if (youtubePlayer && !youtubePlayer.paused) {
                youtubePlayer.pause();
                console.log('Paused YouTube video');
              }

              // Try to pause other common video players
              const commonVideoSelectors = [
                'video[src*="youtube"]',
                'video[src*="vimeo"]',
                'video[src*="netflix"]',
                'video[src*="hulu"]',
                'video[src*="twitch"]',
                'video[src*="facebook"]',
                'video[src*="instagram"]',
                'video[src*="tiktok"]'
              ];

              commonVideoSelectors.forEach(selector => {
                const videos = document.querySelectorAll(selector);
                videos.forEach(video => {
                  if (!video.paused) {
                    video.pause();
                    console.log(`Paused video with selector: ${selector}`);
                  }
                });
              });
            }

            function showBeratingAlert(message) {
              // Remove any existing alert
              const existingAlert = document.getElementById('fish-berating-alert');
              if (existingAlert) {
                existingAlert.remove();
              }
              
              // Create alert element
              const alert = document.createElement('div');
              alert.id = 'fish-berating-alert';
              alert.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(45deg, #ff4444, #cc0000);
                color: white;
                padding: 20px;
                border-radius: 10px;
                font-family: Arial, sans-serif;
                font-size: 18px;
                font-weight: bold;
                z-index: 10000;
                box-shadow: 0 4px 20px rgba(255, 68, 68, 0.5);
                border: 3px solid #ff0000;
                max-width: 400px;
                text-align: center;
                animation: shake 0.5s ease-in-out infinite alternate;
              `;
              
              alert.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 10px;">🐟</div>
                <div>${message}</div>
                <div style="font-size: 14px; margin-top: 10px; opacity: 0.8;">GET BACK TO WORK!</div>
              `;
              
              // Add shake animation
              const style = document.createElement('style');
              style.textContent = `
                @keyframes shake {
                  0% { transform: translateX(0); }
                  100% { transform: translateX(5px); }
                }
              `;
              document.head.appendChild(style);
              
              document.body.appendChild(alert);
              
              // Remove alert after 5 seconds
              setTimeout(() => {
                if (alert.parentNode) {
                  alert.remove();
                }
              }, 5000);
            }

            function speakBeratingMessage(message) {
              console.log('speakBeratingMessage called with:', message);
              
              // First, pause all media elements on the page
              pauseAllMedia();
              
              // Add visual indicator
              showBeratingAlert(message);
              
              if ('speechSynthesis' in window) {
                console.log('Speech synthesis is available');
                
                // Wait for voices to load if they're not ready yet
                const speakText = () => {
                  const utterance = new SpeechSynthesisUtterance(message);
                  utterance.volume = 0.9; // Higher volume for more impact
                  utterance.rate = 0.9; // Slower, more menacing speech
                  utterance.pitch = 0.8; // Lower pitch for more authority

                  // Try to use an angry-sounding voice if available
                  const voices = speechSynthesis.getVoices();
                  console.log('Available voices:', voices.length);
                  const angryVoice = voices.find(voice =>
                    voice.name.toLowerCase().includes('male') ||
                    voice.name.toLowerCase().includes('deep') ||
                    voice.name.toLowerCase().includes('stern') ||
                    voice.name.toLowerCase().includes('daniel') ||
                    voice.name.toLowerCase().includes('alex')
                  );

                  if (angryVoice) {
                    utterance.voice = angryVoice;
                    console.log('Using angry voice:', angryVoice.name);
                  }

                  utterance.onstart = () => console.log('Speech started');
                  utterance.onend = () => console.log('Speech ended');
                  utterance.onerror = (error) => console.error('Speech error:', error);

                  speechSynthesis.speak(utterance);
                  console.log('Speech synthesis started');
                };

                // If voices are already loaded, speak immediately
                if (speechSynthesis.getVoices().length > 0) {
                  speakText();
                } else {
                  // Wait for voices to load
                  speechSynthesis.addEventListener('voiceschanged', speakText, { once: true });
                  // Fallback: speak after 1 second even if voices don't load
                  setTimeout(speakText, 1000);
                }
              } else {
                console.error('Speech synthesis not supported');
              }
            }

            // Call the function
            speakBeratingMessage(message);
          },
          args: [message]
        }, (result) => {
          if (chrome.runtime.lastError) {
            console.error('Script injection failed:', chrome.runtime.lastError);
          } else {
            console.log('Script injected successfully');
          }
        });
      } else {
        console.error('No target tab found');
      }
    } else {
      console.error('Failed to get berating message:', response.status);
    }
  } catch (error) {
    console.error('Error playing berating audio:', error);
  }
}

// Function to inject into tab for speech synthesis
function speakBeratingMessage(message) {
  console.log('speakBeratingMessage called with:', message);
  
  // First, pause all media elements on the page
  pauseAllMedia();
  
  // Add visual indicator
  showBeratingAlert(message);
  
  if ('speechSynthesis' in window) {
    console.log('Speech synthesis is available');
    
    // Wait for voices to load if they're not ready yet
    const speakText = () => {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.volume = 0.9; // Higher volume for more impact
      utterance.rate = 0.9; // Slower, more menacing speech
      utterance.pitch = 0.8; // Lower pitch for more authority

      // Try to use an angry-sounding voice if available
      const voices = speechSynthesis.getVoices();
      console.log('Available voices:', voices.length);
      const angryVoice = voices.find(voice =>
        voice.name.toLowerCase().includes('male') ||
        voice.name.toLowerCase().includes('deep') ||
        voice.name.toLowerCase().includes('stern') ||
        voice.name.toLowerCase().includes('daniel') ||
        voice.name.toLowerCase().includes('alex')
      );

      if (angryVoice) {
        utterance.voice = angryVoice;
        console.log('Using angry voice:', angryVoice.name);
      }

      utterance.onstart = () => console.log('Speech started');
      utterance.onend = () => console.log('Speech ended');
      utterance.onerror = (error) => console.error('Speech error:', error);

      speechSynthesis.speak(utterance);
      console.log('Speech synthesis started');
    };

    // If voices are already loaded, speak immediately
    if (speechSynthesis.getVoices().length > 0) {
      speakText();
    } else {
      // Wait for voices to load
      speechSynthesis.addEventListener('voiceschanged', speakText, { once: true });
      // Fallback: speak after 1 second even if voices don't load
      setTimeout(speakText, 1000);
    }
  } else {
    console.error('Speech synthesis not supported');
  }
}

// Function to show visual berating alert
function showBeratingAlert(message) {
  // Remove any existing alert
  const existingAlert = document.getElementById('fish-berating-alert');
  if (existingAlert) {
    existingAlert.remove();
  }
  
  // Create alert element
  const alert = document.createElement('div');
  alert.id = 'fish-berating-alert';
  alert.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(45deg, #ff4444, #cc0000);
    color: white;
    padding: 20px;
    border-radius: 10px;
    font-family: Arial, sans-serif;
    font-size: 18px;
    font-weight: bold;
    z-index: 10000;
    box-shadow: 0 4px 20px rgba(255, 68, 68, 0.5);
    border: 3px solid #ff0000;
    max-width: 400px;
    text-align: center;
    animation: shake 0.5s ease-in-out infinite alternate;
  `;
  
  alert.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 10px;">🐟</div>
    <div>${message}</div>
    <div style="font-size: 14px; margin-top: 10px; opacity: 0.8;">GET BACK TO WORK!</div>
  `;
  
  // Add shake animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0% { transform: translateX(0); }
      100% { transform: translateX(5px); }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(alert);
  
  // Remove alert after 5 seconds
  setTimeout(() => {
    if (alert.parentNode) {
      alert.remove();
    }
  }, 5000);
}

// Function to pause all media elements on the page
function pauseAllMedia() {
  console.log('pauseAllMedia called');
  
  // Pause all video elements
  const videos = document.querySelectorAll('video');
  console.log('Found video elements:', videos.length);
  videos.forEach(video => {
    if (!video.paused) {
      video.pause();
      video.currentTime = 0; // Reset to beginning
      video.muted = true; // Mute it
      console.log('Paused video element');
    }
  });

  // Pause all audio elements
  const audios = document.querySelectorAll('audio');
  audios.forEach(audio => {
    if (!audio.paused) {
      audio.pause();
      console.log('Paused audio element');
    }
  });

  // Try to pause YouTube videos specifically
  const youtubePlayer = document.querySelector('#movie_player video');
  if (youtubePlayer && !youtubePlayer.paused) {
    youtubePlayer.pause();
    console.log('Paused YouTube video');
  }

  // Try to pause other common video players
  const commonVideoSelectors = [
    'video[src*="youtube"]',
    'video[src*="vimeo"]',
    'video[src*="netflix"]',
    'video[src*="hulu"]',
    'video[src*="twitch"]',
    'video[src*="facebook"]',
    'video[src*="instagram"]',
    'video[src*="tiktok"]'
  ];

  commonVideoSelectors.forEach(selector => {
    const videos = document.querySelectorAll(selector);
    videos.forEach(video => {
      if (!video.paused) {
        video.pause();
        console.log(`Paused video with selector: ${selector}`);
      }
    });
  });

  // Try to pause media using common player APIs
  try {
    // YouTube iframe API
    if (window.YT && window.YT.Player) {
      const players = document.querySelectorAll('.ytp-video-player');
      players.forEach(player => {
        if (player.pauseVideo) {
          player.pauseVideo();
          console.log('Paused YouTube iframe player');
        }
      });
    }

    // Vimeo player API
    if (window.Vimeo && window.Vimeo.Player) {
      const players = document.querySelectorAll('[data-vimeo-id]');
      players.forEach(player => {
        if (player.pause) {
          player.pause();
          console.log('Paused Vimeo player');
        }
      });
    }
  } catch (error) {
    console.log('Error pausing media players:', error);
  }
}

// Keep service worker alive
let keepAliveInterval;

function keepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000); // Ping every 20 seconds
}

// Start keep-alive when service worker starts
keepAlive();

// ---- Handle messages from content script (URL/title changes) ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Reset keep-alive timer on any message
  keepAlive();
  console.log('Service worker received message:', msg?.type, 'from tab:', sender.tab?.id);
  
  if (msg?.type === "SNAPSHOT") {
    const tabId = sender.tab?.id;
    console.log('SNAPSHOT received for tab:', tabId, 'payload:', msg.payload);
    if (!tabId) {
      console.error('No tab ID in SNAPSHOT message');
      return;
    }
    classify(msg.payload)
      .then((result) => {
        console.log('Classification successful:', result);
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

  // Handle audio berating requests
  if (msg?.type === "PLAY_BERATING_AUDIO") {
    // Get the current active tab since sender.tab is undefined
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        playBeratingAudio(msg.category, tabs[0].id);
      } else {
        console.error('No active tab found for audio berating');
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  // Handle popup opening requests
  if (msg?.type === "OPEN_POPUP") {
    // Since chrome.action.openPopup() requires user interaction, 
    // we'll use a notification to alert the user instead
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'calhacksicon.png',
      title: 'Productivity Alert!',
      message: 'You\'re on an unproductive site. Click the extension icon to see details.',
      priority: 2
    });
    sendResponse({ ok: true });
    return true;
  }

  // Test audio functionality
  if (msg?.type === "TEST_AUDIO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: () => {
            console.log('Testing speech synthesis...');
            if ('speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance('Hello, this is a test!');
              utterance.volume = 0.8;
              utterance.rate = 1.0;
              utterance.onstart = () => console.log('Test speech started');
              utterance.onend = () => console.log('Test speech ended');
              utterance.onerror = (error) => console.error('Test speech error:', error);
              speechSynthesis.speak(utterance);
            } else {
              console.error('Speech synthesis not supported');
            }
          }
        });
      }
    });
    sendResponse({ ok: true });
    return true;
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
