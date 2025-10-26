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

// ---- Persistent Fish System ----
const persistentFishTimers = new Map(); // tabId -> timer ID
const FISH_INTERVAL = 3000; // Reduced from 10000ms to 3000ms for more continuous berating

// Start persistent Fish berating for a tab
function startPersistentFish(tabId, category) {
  console.log('🐟 Starting persistent Fish for tab:', tabId);
  
  // Clear any existing timer
  stopPersistentFish(tabId);
  
  // Track berating count for this tab
  let beratingCount = 0;
  
  // Set up recurring Fish berating every 3 seconds
  const timerId = setInterval(async () => {
    try {
      // Check if tab still exists and is still unproductive
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        stopPersistentFish(tabId);
        return;
      }
      
      // Re-classify to make sure it's still unproductive
      const result = await classifyTab(tabId);
      if (result && !result.productive) {
        // Increment berating count
        beratingCount++;
        
        // Add Fish prefix every 3rd berating to reduce repetition
        const addFishPrefix = (beratingCount % 3 === 1);
        
        console.log(`🐟 Persistent Fish berating #${beratingCount} for tab ${tabId}, addFishPrefix: ${addFishPrefix}`);
        await playBeratingAudio(category, tabId, addFishPrefix);
      } else {
        // Tab became productive, stop Fish
        console.log('🐟 Tab became productive, stopping persistent Fish');
        stopPersistentFish(tabId);
      }
    } catch (error) {
      console.error('🐟 Persistent Fish error:', error);
      stopPersistentFish(tabId);
    }
  }, FISH_INTERVAL);
  
  persistentFishTimers.set(tabId, timerId);
}

// Stop persistent Fish berating for a tab
function stopPersistentFish(tabId) {
  const timerId = persistentFishTimers.get(tabId);
  if (timerId) {
    console.log('🐟 Stopping persistent Fish for tab:', tabId);
    clearInterval(timerId);
    persistentFishTimers.delete(tabId);
    
    // Also stop any ongoing speech synthesis in that tab
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        if ('speechSynthesis' in window) {
          speechSynthesis.cancel();
          console.log('🐟 Speech synthesis cancelled for tab');
        }
      }
    }).catch(error => {
      console.log('Could not stop speech synthesis for tab:', tabId, error);
    });
  }
}

// Stop all persistent Fish activity (emergency stop)
function stopAllPersistentFish() {
  console.log('🐟 EMERGENCY STOP: Stopping all persistent Fish activity');
  persistentFishTimers.forEach((timerId, tabId) => {
    console.log('🐟 Stopping persistent Fish for tab:', tabId);
    clearInterval(timerId);
    
    // Also stop any ongoing speech synthesis in that tab
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        if ('speechSynthesis' in window) {
          speechSynthesis.cancel();
          console.log('🐟 Speech synthesis cancelled for tab');
        }
      }
    }).catch(error => {
      console.log('Could not stop speech synthesis for tab:', tabId, error);
    });
  });
  persistentFishTimers.clear();
}

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
async function playBeratingAudio(category, targetTabId = null, addFishPrefix = true) {
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
          function: (message, addFishPrefix) => {
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

            function speakBeratingMessage(message, addFishPrefix = true) {
              console.log('speakBeratingMessage called with:', message);
              
              // First, pause all media elements on the page
              pauseAllMedia();
              
              // Add visual indicator
              showBeratingAlert(message);
              
              // Conditionally add Fish personality to the message
              const fishMessage = addFishPrefix ? `🐟 Fish here! ${message}` : message;
              
              if ('speechSynthesis' in window) {
                console.log('Speech synthesis is available');
                
                // Wait for voices to load if they're not ready yet
                const speakText = () => {
                  const utterance = new SpeechSynthesisUtterance(fishMessage);
                  utterance.volume = 1.0; // Maximum volume for maximum impact
                  utterance.rate = 0.7; // Much slower, more menacing speech
                  utterance.pitch = 0.5; // Much lower pitch for deep, intimidating voice

                  // Try to use the most menacing voice available
                  const voices = speechSynthesis.getVoices();
                  console.log('Available voices:', voices.length);
                  
                  // Priority order for menacing voices
                  const menacingVoices = [
                    'Daniel', 'Alex', 'Fred', 'Ralph', 'Tom', 'Bruce',
                    'male', 'deep', 'stern', 'gruff', 'harsh', 'rough'
                  ];
                  
                  let selectedVoice = null;
                  
                  // First try to find voices by exact name match
                  for (const voiceName of menacingVoices) {
                    selectedVoice = voices.find(voice => 
                      voice.name.toLowerCase().includes(voiceName.toLowerCase())
                    );
                    if (selectedVoice) break;
                  }
                  
                  // If no exact match, find any male voice
                  if (!selectedVoice) {
                    selectedVoice = voices.find(voice =>
                      voice.name.toLowerCase().includes('male') ||
                      voice.name.toLowerCase().includes('man') ||
                      voice.name.toLowerCase().includes('guy')
                    );
                  }
                  
                  // If still no match, find any voice that sounds deep
                  if (!selectedVoice) {
                    selectedVoice = voices.find(voice =>
                      voice.name.toLowerCase().includes('deep') ||
                      voice.name.toLowerCase().includes('low') ||
                      voice.name.toLowerCase().includes('bass')
                    );
                  }

                  if (selectedVoice) {
                    utterance.voice = selectedVoice;
                    console.log('Using menacing Fish voice:', selectedVoice.name);
                  } else {
                    console.log('Using default voice for Fish');
                  }

                  utterance.onstart = () => console.log('🐟 Fish speech started');
                  utterance.onend = () => console.log('🐟 Fish speech ended');
                  utterance.onerror = (error) => console.error('🐟 Fish speech error:', error);

                  speechSynthesis.speak(utterance);
                  console.log('🐟 Fish speech synthesis started with smooth menacing voice');
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
            speakBeratingMessage(message, addFishPrefix);
            
            // Trigger chaotic popup flood
            console.log('About to trigger chaotic popup flood...');
            
            // Define chaotic popup flood function inside injected script
            async function triggerChaoticPopupFlood() {
              console.log('CHAOTIC POPUP FLOOD INITIATED! 💥');
              console.log('Document body exists:', !!document.body);
              console.log('Window innerWidth:', window.innerWidth);
              console.log('Window innerHeight:', window.innerHeight);
              
              // Fallback hateful memes
              const hatefulMemes = [
                "YOUR PRODUCTIVITY IS DRYER THAN A DESERT!",
                "SLOTHS WORK HARDER THAN YOU!",
                "YOUR GOALS ARE CRYING!",
                "GET BACK TO WORK, SLACKER!",
                "STOP WASTING TIME!",
                "YOUR FUTURE SELF HATES YOU!",
                "THIS IS WHY YOU'RE NOT RICH!",
                "STOP WATCHING CAT VIDEOS!",
                "YOUR DREAMS ARE DYING!",
                "PRODUCTIVITY: 0%",
                "YOU'RE A LAZY SLUG!",
                "WORK ETHIC: NONEXISTENT!",
                "YOUR BRAIN IS ROTTING!",
                "STOP BEING USELESS!",
                "YOUR AMBITION IS DEAD!",
                "WASTE OF OXYGEN!",
                "YOUR PARENTS ARE DISAPPOINTED!",
                "STOP PROCRASTINATING!",
                "YOUR CAREER IS DYING!",
                "GET OFF YOUR BUTT!"
              ];

              // Trolling emojis
              const trollingEmojis = [
                "😡", "🤬", "💢", "😤", "👿", "😠", "😾", "💀", "🔥", "💥",
                "⚡", "🌪️", "💣", "🎯", "🚫", "❌", "⚠️", "🛑", "🔴", "⛔",
                "💀", "👹", "👺", "🤡", "💩", "🤢", "🤮", "😈", "👻", "🎭",
                "💀", "⚰️", "🪦", "☠️", "🔪", "🗡️", "⚔️", "🏹", "🔫", "💣"
              ];

              // Random message bubbles
              const messageBubbles = [
                "GET BACK TO WORK!",
                "STOP PROCRASTINATING!",
                "YOUR GOALS ARE WAITING!",
                "FOCUS! FOCUS! FOCUS!",
                "PRODUCTIVITY MODE: ON",
                "DISTRACTION LEVEL: CRITICAL",
                "WORK NOW, PLAY LATER!",
                "YOUR FUTURE SELF NEEDS YOU!",
                "STOP WASTING TIME!",
                "GET YOUR LIFE TOGETHER!",
                "YOU'RE BEING LAZY!",
                "STOP SCROLLING!",
                "GET TO WORK!",
                "FOCUS UP!",
                "STOP SLACKING!",
                "WORK HARDER!",
                "BE PRODUCTIVE!",
                "STOP WASTING LIFE!",
                "GET MOTIVATED!",
                "STOP BEING LAZY!"
              ];

              // Create multiple popups with escalating intensity
              let popupCount = 0;
              const maxPopups = 25; // Increased from 15 to 25
              
              const createChaoticPopup = () => {
                if (popupCount >= maxPopups) return;
                
                console.log('Creating chaotic popup #', popupCount + 1);
                const popup = document.createElement('div');
                popup.className = 'chaotic-popup';
                
                // Random position
                const x = Math.random() * (window.innerWidth - 300);
                const y = Math.random() * (window.innerHeight - 200);
                
                // Random type of content
                const contentType = Math.random();
                let content = '';
                
                if (contentType < 0.4) {
                  // Hateful meme
                  content = hatefulMemes[Math.floor(Math.random() * hatefulMemes.length)];
                } else if (contentType < 0.7) {
                  // Trolling emojis
                  const emojiCount = Math.floor(Math.random() * 5) + 3;
                  content = Array(emojiCount).fill().map(() => 
                    trollingEmojis[Math.floor(Math.random() * trollingEmojis.length)]
                  ).join(' ');
                } else {
                  // Message bubble
                  content = messageBubbles[Math.floor(Math.random() * messageBubbles.length)];
                }
                
                // Random styling
                const colors = ['#ff0000', '#ff4444', '#cc0000', '#ff6666', '#ff3333'];
                const bgColor = colors[Math.floor(Math.random() * colors.length)];
                
                popup.style.cssText = `
                  position: fixed;
                  left: ${x}px;
                  top: ${y}px;
                  background: ${bgColor};
                  color: white;
                  padding: 15px 20px;
                  border-radius: 10px;
                  font-family: Arial, sans-serif;
                  font-size: ${Math.random() * 10 + 14}px;
                  font-weight: bold;
                  z-index: 99999;
                  box-shadow: 0 4px 20px rgba(255, 0, 0, 0.5);
                  border: 3px solid #ff0000;
                  max-width: 300px;
                  text-align: center;
                  animation: chaoticShake 0.3s ease-in-out infinite alternate;
                  cursor: pointer;
                `;
                
                popup.innerHTML = `
                  <div style="font-size: 20px; margin-bottom: 5px;">🐟</div>
                  <div>${content}</div>
                `;
                
                // Add chaotic shake animation
                if (!document.getElementById('chaotic-animations')) {
                  const style = document.createElement('style');
                  style.id = 'chaotic-animations';
                  style.textContent = `
                    @keyframes chaoticShake {
                      0% { transform: translateX(0) translateY(0) rotate(0deg); }
                      25% { transform: translateX(5px) translateY(-3px) rotate(1deg); }
                      50% { transform: translateX(-3px) translateY(5px) rotate(-1deg); }
                      75% { transform: translateX(4px) translateY(2px) rotate(0.5deg); }
                      100% { transform: translateX(-2px) translateY(-4px) rotate(-0.5deg); }
                    }
                  `;
                  document.head.appendChild(style);
                }
                
                // Click to remove
                popup.onclick = () => {
                  popup.remove();
                };
                
                document.body.appendChild(popup);
                popupCount++;
                console.log('Popup added to DOM, total popups:', popupCount);
                
                // Auto-remove after random time
                setTimeout(() => {
                  if (popup.parentNode) {
                    popup.remove();
                    console.log('Popup auto-removed');
                  }
                }, Math.random() * 3000 + 2000); // 2-5 seconds
              };
              
              // Create popups with escalating frequency
              const createPopups = () => {
                const popupsToCreate = Math.min(5, maxPopups - popupCount); // Increased from 3 to 5
                for (let i = 0; i < popupsToCreate; i++) {
                  setTimeout(() => createChaoticPopup(), i * 100); // Reduced delay from 200ms to 100ms
                }
              };
              
              // Initial burst
              createPopups();
              
              // Continue creating popups every 500ms-1 second (faster spam)
              const interval = setInterval(() => {
                if (popupCount < maxPopups) {
                  createPopups();
                } else {
                  clearInterval(interval);
                }
              }, Math.random() * 500 + 500); // Reduced from 1000-2000ms to 500-1000ms
              
              // Stop after 10 seconds
              setTimeout(() => {
                clearInterval(interval);
              }, 10000);
            }
            
            // Call the function
            triggerChaoticPopupFlood();
          },
          args: [message, addFishPrefix]
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

// Function to trigger chaotic popup flood
async function triggerChaoticPopupFlood() {
  console.log('CHAOTIC POPUP FLOOD INITIATED! 💥');
  console.log('Document body exists:', !!document.body);
  console.log('Window innerWidth:', window.innerWidth);
  console.log('Window innerHeight:', window.innerHeight);
  
  // Get AI-generated meme from backend
  let aiMeme = "WHEN YOU'RE SUPPOSED TO BE WORKING BUT YOU'RE ON YOUTUBE AGAIN";
  try {
    const response = await fetch('http://127.0.0.1:5000/generate-meme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'entertainment' })
    });
    if (response.ok) {
      const data = await response.json();
      aiMeme = data.meme;
    }
  } catch (error) {
    console.log('Using fallback meme');
  }
  
  // Fallback hateful memes
  const hatefulMemes = [
    aiMeme,
    "WHEN YOU'RE SUPPOSED TO BE WORKING BUT YOU'RE ON YOUTUBE AGAIN",
    "ME: I'll just watch one video\nALSO ME: *watches 47 videos*",
    "PRODUCTIVITY LEVEL: 📉📉📉📉📉",
    "YOUR BRAIN: Let's be productive!\nYOUR HANDS: *opens YouTube*",
    "WHEN YOU REALIZE YOU'VE BEEN DISTRACTED FOR 3 HOURS",
    "PRODUCTIVITY: 0%\nPROCRASTINATION: 100%",
    "YOUR FUTURE SELF HATES YOU RIGHT NOW",
    "THIS IS WHY YOU'RE NOT RICH YET",
    "STOP WASTING YOUR LIFE ON CAT VIDEOS",
    "YOUR DREAMS ARE DYING WHILE YOU SCROLL"
  ];

  // Trolling emojis
  const trollingEmojis = [
    "😡", "🤬", "💢", "😤", "👿", "😠", "😾", "💀", "🔥", "💥",
    "⚡", "🌪️", "💣", "🎯", "🚫", "❌", "⚠️", "🛑", "🔴", "⛔"
  ];

  // Random message bubbles
  const messageBubbles = [
    "GET BACK TO WORK!",
    "STOP PROCRASTINATING!",
    "YOUR GOALS ARE WAITING!",
    "FOCUS! FOCUS! FOCUS!",
    "PRODUCTIVITY MODE: ON",
    "DISTRACTION LEVEL: CRITICAL",
    "WORK NOW, PLAY LATER!",
    "YOUR FUTURE SELF NEEDS YOU!",
    "STOP WASTING TIME!",
    "GET YOUR LIFE TOGETHER!"
  ];

  // Create multiple popups with escalating intensity
  let popupCount = 0;
  const maxPopups = 15; // Maximum number of popups
  
  const createChaoticPopup = () => {
    if (popupCount >= maxPopups) return;
    
    console.log('Creating chaotic popup #', popupCount + 1);
    const popup = document.createElement('div');
    popup.className = 'chaotic-popup';
    
    // Random position
    const x = Math.random() * (window.innerWidth - 300);
    const y = Math.random() * (window.innerHeight - 200);
    
    // Random type of content
    const contentType = Math.random();
    let content = '';
    
    if (contentType < 0.4) {
      // Hateful meme
      content = hatefulMemes[Math.floor(Math.random() * hatefulMemes.length)];
    } else if (contentType < 0.7) {
      // Trolling emojis
      const emojiCount = Math.floor(Math.random() * 5) + 3;
      content = Array(emojiCount).fill().map(() => 
        trollingEmojis[Math.floor(Math.random() * trollingEmojis.length)]
      ).join(' ');
    } else {
      // Message bubble
      content = messageBubbles[Math.floor(Math.random() * messageBubbles.length)];
    }
    
    // Random styling
    const colors = ['#ff0000', '#ff4444', '#cc0000', '#ff6666', '#ff3333'];
    const bgColor = colors[Math.floor(Math.random() * colors.length)];
    
    popup.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: ${bgColor};
      color: white;
      padding: 15px 20px;
      border-radius: 10px;
      font-family: Arial, sans-serif;
      font-size: ${Math.random() * 10 + 14}px;
      font-weight: bold;
      z-index: 99999;
      box-shadow: 0 4px 20px rgba(255, 0, 0, 0.5);
      border: 3px solid #ff0000;
      max-width: 300px;
      text-align: center;
      animation: chaoticShake 0.3s ease-in-out infinite alternate;
      cursor: pointer;
    `;
    
    popup.innerHTML = `
      <div style="font-size: 20px; margin-bottom: 5px;">🐟</div>
      <div>${content}</div>
    `;
    
    // Add chaotic shake animation
    if (!document.getElementById('chaotic-animations')) {
      const style = document.createElement('style');
      style.id = 'chaotic-animations';
      style.textContent = `
        @keyframes chaoticShake {
          0% { transform: translateX(0) translateY(0) rotate(0deg); }
          25% { transform: translateX(5px) translateY(-3px) rotate(1deg); }
          50% { transform: translateX(-3px) translateY(5px) rotate(-1deg); }
          75% { transform: translateX(4px) translateY(2px) rotate(0.5deg); }
          100% { transform: translateX(-2px) translateY(-4px) rotate(-0.5deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Click to remove
    popup.onclick = () => {
      popup.remove();
    };
    
    document.body.appendChild(popup);
    popupCount++;
    console.log('Popup added to DOM, total popups:', popupCount);
    
    // Auto-remove after random time
    setTimeout(() => {
      if (popup.parentNode) {
        popup.remove();
        console.log('Popup auto-removed');
      }
    }, Math.random() * 3000 + 2000); // 2-5 seconds
  };
  
  // Create popups with escalating frequency
  const createPopups = () => {
    const popupsToCreate = Math.min(3, maxPopups - popupCount);
    for (let i = 0; i < popupsToCreate; i++) {
      setTimeout(() => createChaoticPopup(), i * 200);
    }
  };
  
  // Initial burst
  createPopups();
  
  // Continue creating popups every 1-2 seconds
  const interval = setInterval(() => {
    if (popupCount < maxPopups) {
      createPopups();
    } else {
      clearInterval(interval);
    }
  }, Math.random() * 1000 + 1000);
  
  // Stop after 10 seconds
  setTimeout(() => {
    clearInterval(interval);
  }, 10000);
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
        
        // Start persistent Fish if site is unproductive
        if (!result.productive) {
          console.log('🐟 Unproductive site detected, starting persistent Fish');
          startPersistentFish(tabId, result.category);
        } else {
          // Stop persistent Fish if site became productive
          console.log('🐟 Productive site detected, stopping persistent Fish');
          stopPersistentFish(tabId);
        }
        
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
        playBeratingAudio(msg.category, tabs[0].id, true);
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

        // Test Fish audio functionality
        if (msg?.type === "TEST_FISH_AUDIO") {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: () => {
                  console.log('Testing Fish speech synthesis...');
                  if ('speechSynthesis' in window) {
                    const fishMessage = '🐟 Fish here! This is a test of my menacing voice! Get back to work!';
                    const utterance = new SpeechSynthesisUtterance(fishMessage);
                    utterance.volume = 1.0; // Maximum volume
                    utterance.rate = 0.7; // Slow, menacing speech
                    utterance.pitch = 0.5; // Deep, intimidating voice
                    
                    // Try to find a menacing voice
                    const voices = speechSynthesis.getVoices();
                    const menacingVoices = ['Daniel', 'Alex', 'Fred', 'Ralph', 'Tom', 'Bruce'];
                    let selectedVoice = null;
                    
                    for (const voiceName of menacingVoices) {
                      selectedVoice = voices.find(voice => 
                        voice.name.toLowerCase().includes(voiceName.toLowerCase())
                      );
                      if (selectedVoice) break;
                    }
                    
                    if (selectedVoice) {
                      utterance.voice = selectedVoice;
                      console.log('Using Fish voice:', selectedVoice.name);
                    }
                    
                    utterance.onstart = () => console.log('🐟 Fish test speech started');
                    utterance.onend = () => console.log('🐟 Fish test speech ended');
                    utterance.onerror = (error) => console.error('🐟 Fish test speech error:', error);
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
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  console.log('🐟 Tab activated:', tabId);
  
  // Immediately classify the new active tab
  const result = await classifyTab(tabId);
  
  if (result) {
    if (result.productive) {
      // Stop all persistent Fish timers when switching to productive tab
      console.log('🐟 Productive tab activated, stopping all persistent Fish');
      stopAllPersistentFish();
    } else {
      // Start persistent Fish for this unproductive tab
      console.log('🐟 Unproductive tab activated, starting persistent Fish');
      startPersistentFish(tabId, result.category);
    }
  }
});

// Clean up persistent Fish when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  stopPersistentFish(tabId);
  state.delete(tabId);
});

// Clean up persistent Fish when tabs are updated (URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Re-classify the tab and manage persistent Fish accordingly
    classifyTab(tabId).catch(() => {});
  }
});

// ---- Cleanup ----
chrome.tabs.onRemoved.addListener((tabId) => state.delete(tabId));
