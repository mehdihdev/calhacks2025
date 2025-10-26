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

// ---- Pomodoro Timer System ----
const pomodoroTimers = new Map(); // tabId -> { timerId, startTime, duration, isActive, isWorkSession }
const POMODORO_WORK_TIME = 25 * 60 * 1000; // 25 minutes in milliseconds
const POMODORO_BREAK_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds
const globalBreakMode = new Map(); // tabId -> boolean (true if in break mode)

// Start persistent Fish berating for a tab
function startPersistentFish(tabId, category) {
  console.log('🐟 Starting persistent Fish for tab:', tabId);
  
  // Check if tab is in break mode - if so, don't start Fish
  if (globalBreakMode.get(tabId)) {
    console.log('🐟 Tab is in break mode - Fish will not berate');
    return;
  }
  
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
      
      // Check if tab is now in break mode
      if (globalBreakMode.get(tabId)) {
        console.log('🐟 Tab entered break mode - stopping Fish berating');
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

// ---- Pomodoro Timer Functions ----
function startPomodoroTimer(tabId, isWorkSession = true) {
  console.log('🍅 Starting Pomodoro timer for tab:', tabId, 'Work session:', isWorkSession);
  
  // Stop any existing timer for this tab
  stopPomodoroTimer(tabId);
  
  const duration = isWorkSession ? POMODORO_WORK_TIME : POMODORO_BREAK_TIME;
  const startTime = Date.now();
  
  // Set break mode for Fish integration
  globalBreakMode.set(tabId, !isWorkSession);
  
  // If starting break time, stop Fish berating
  if (!isWorkSession) {
    console.log('🍅 Break time started - stopping Fish berating for tab:', tabId);
    stopPersistentFish(tabId);
  }
  
  // First, inject the Pomodoro timer functions
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      // Define Pomodoro timer functions
      window.createPomodoroTimer = function(duration, isWorkSession) {
        console.log('🍅 Creating Pomodoro timer:', duration, 'Work session:', isWorkSession);
        
        // Remove any existing timer
        window.removePomodoroTimer();
        
        // Calculate initial time display
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        const initialTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Create draggable and resizable timer
        const timer = document.createElement('div');
        timer.id = 'pomodoro-timer';
        timer.style.cssText = `
          position: fixed;
          top: 8px;
          left: 8px;
          background: ${isWorkSession ? 'linear-gradient(135deg, #4CAF50, #45a049)' : 'linear-gradient(135deg, #f44336, #d32f2f)'};
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-family: 'Segoe UI', Arial, sans-serif;
          font-size: 14px;
          font-weight: bold;
          z-index: 10000;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          border: 2px solid ${isWorkSession ? '#4CAF50' : '#f44336'};
          cursor: move;
          min-width: 80px;
          min-height: 40px;
          justify-content: center;
          user-select: none;
          width: 120px;
          height: 50px;
        `;
        
        // Add timer content with resize handle
        timer.innerHTML = `
          <span id="timer-emoji" style="font-size: 12px;">${isWorkSession ? '🍅' : '☕'}</span>
          <span id="timer-display" style="font-family: 'Courier New', monospace; font-size: 16px;">${initialTime}</span>
          <div id="resize-handle" style="position: absolute; bottom: 2px; right: 2px; width: 12px; height: 12px; background: rgba(255,255,255,0.4); border-radius: 2px; cursor: se-resize; border: 1px solid rgba(255,255,255,0.2);"></div>
        `;
        
        // Function to update text size based on timer dimensions
        const updateTextSize = () => {
          const width = timer.offsetWidth;
          const height = timer.offsetHeight;
          
          // Calculate font sizes based on dimensions
          const emojiSize = Math.min(width * 0.15, height * 0.4, 20); // Max 20px
          const displaySize = Math.min(width * 0.25, height * 0.6, 32); // Max 32px
          
          const emojiEl = timer.querySelector('#timer-emoji');
          const displayEl = timer.querySelector('#timer-display');
          
          if (emojiEl) emojiEl.style.fontSize = Math.max(8, emojiSize) + 'px';
          if (displayEl) displayEl.style.fontSize = Math.max(10, displaySize) + 'px';
        };
        
        // Initial text size calculation
        updateTextSize();
        
        // Add drag functionality with performance optimization
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        let animationFrameId = null;
        
        timer.addEventListener('mousedown', (e) => {
          // Only start drag if not clicking on resize handle
          if (e.target.id !== 'resize-handle') {
            isDragging = true;
            dragOffset.x = e.clientX - timer.offsetLeft;
            dragOffset.y = e.clientY - timer.offsetTop;
            timer.style.cursor = 'grabbing';
            timer.style.transition = 'none'; // Disable transitions during drag
            e.preventDefault();
          }
        });
        
        const updatePosition = (e) => {
          if (isDragging) {
            const newX = e.clientX - dragOffset.x;
            const newY = e.clientY - dragOffset.y;
            
            // Keep timer within viewport bounds
            const maxX = window.innerWidth - timer.offsetWidth;
            const maxY = window.innerHeight - timer.offsetHeight;
            
            timer.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
            timer.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
          }
        };
        
        document.addEventListener('mousemove', (e) => {
          if (isDragging) {
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
            }
            animationFrameId = requestAnimationFrame(() => updatePosition(e));
          }
        });
        
        document.addEventListener('mouseup', () => {
          if (isDragging) {
            isDragging = false;
            timer.style.cursor = 'move';
            timer.style.transition = 'all 0.2s ease'; // Re-enable transitions
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
              animationFrameId = null;
            }
          }
        });
        
        // Add resize handle functionality
        const resizeHandle = timer.querySelector('#resize-handle');
        let isResizing = false;
        let resizeStart = { x: 0, y: 0, width: 0, height: 0 };
        
        resizeHandle.addEventListener('mousedown', (e) => {
          isResizing = true;
          resizeStart.x = e.clientX;
          resizeStart.y = e.clientY;
          resizeStart.width = timer.offsetWidth;
          resizeStart.height = timer.offsetHeight;
          timer.style.transition = 'none'; // Disable transitions during resize
          e.stopPropagation();
          e.preventDefault();
        });
        
        const updateSize = (e) => {
          if (isResizing) {
            const deltaX = e.clientX - resizeStart.x;
            const deltaY = e.clientY - resizeStart.y;
            const newWidth = Math.max(80, resizeStart.width + deltaX);
            const newHeight = Math.max(40, resizeStart.height + deltaY);
            
            timer.style.width = newWidth + 'px';
            timer.style.height = newHeight + 'px';
            
            // Update text size after resize
            updateTextSize();
          }
        };
        
        document.addEventListener('mousemove', (e) => {
          if (isResizing) {
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
            }
            animationFrameId = requestAnimationFrame(() => updateSize(e));
          }
        });
        
        document.addEventListener('mouseup', () => {
          if (isResizing) {
            isResizing = false;
            timer.style.transition = 'all 0.2s ease'; // Re-enable transitions
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
              animationFrameId = null;
            }
          }
        });
        
        // Add hover effect (only when not dragging/resizing)
        timer.addEventListener('mouseenter', () => {
          if (!isDragging && !isResizing) {
            timer.style.transform = 'scale(1.02)';
            timer.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4)';
          }
        });
        
        timer.addEventListener('mouseleave', () => {
          if (!isDragging && !isResizing) {
            timer.style.transform = 'scale(1)';
            timer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
          }
        });
        
        // Add double-click to toggle timer pause/resume (placeholder for future feature)
        timer.addEventListener('dblclick', (e) => {
          e.preventDefault();
          console.log('🍅 Pomodoro timer double-clicked - pause/resume feature coming soon!');
        });
        
        document.body.appendChild(timer);
        console.log('🍅 Compact Pomodoro timer created with initial time:', initialTime);
      };
      
      window.updatePomodoroTimer = function(remaining, isWorkSession) {
        const timerDisplay = document.getElementById('timer-display');
        const timer = document.getElementById('pomodoro-timer');
        
        if (timerDisplay && timer) {
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
          timerDisplay.textContent = timeString;
          
          // Update color based on session type and remaining time
          if (isWorkSession) {
            // Work session - green colors
            if (remaining < 60000) { // Less than 1 minute
              timer.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)'; // Orange warning
              timer.style.borderColor = '#ff9800';
            } else if (remaining < 300000) { // Less than 5 minutes
              timer.style.background = 'linear-gradient(135deg, #8bc34a, #689f38)'; // Lighter green
              timer.style.borderColor = '#8bc34a';
            } else {
              timer.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)'; // Full green
              timer.style.borderColor = '#4CAF50';
            }
          } else {
            // Break session - red colors
            if (remaining < 60000) { // Less than 1 minute
              timer.style.background = 'linear-gradient(135deg, #ff5722, #e64a19)'; // Darker red warning
              timer.style.borderColor = '#ff5722';
            } else {
              timer.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)'; // Full red
              timer.style.borderColor = '#f44336';
            }
          }
          
          // Add pulsing animation when time is running low
          if (remaining < 60000) {
            timer.style.animation = 'pulse 1s infinite';
          } else {
            timer.style.animation = 'none';
          }
          
          // Update text size based on current dimensions
          const width = timer.offsetWidth;
          const height = timer.offsetHeight;
          const emojiSize = Math.min(width * 0.15, height * 0.4, 20);
          const displaySize = Math.min(width * 0.25, height * 0.6, 32);
          
          const emojiEl = timer.querySelector('#timer-emoji');
          if (emojiEl) emojiEl.style.fontSize = Math.max(8, emojiSize) + 'px';
          timerDisplay.style.fontSize = Math.max(10, displaySize) + 'px';
        }
      };
      
      window.pausePomodoroTimer = function() {
        const timer = document.getElementById('pomodoro-timer');
        if (timer) {
          timer.style.opacity = '0.6';
          timer.style.border = '2px dashed rgba(255,255,255,0.8)';
          timer.style.background = 'linear-gradient(135deg, #666, #555)';
          
          // Add paused indicator
          const pausedIndicator = timer.querySelector('.paused-indicator');
          if (!pausedIndicator) {
            const indicator = document.createElement('span');
            indicator.className = 'paused-indicator';
            indicator.textContent = ' ⏸️';
            indicator.style.fontSize = '12px';
            timer.appendChild(indicator);
          }
          
          console.log('🍅 Pomodoro timer paused');
        }
      };
      
      window.resumePomodoroTimer = function() {
        const timer = document.getElementById('pomodoro-timer');
        if (timer) {
          timer.style.opacity = '1';
          timer.style.border = '2px solid #4CAF50';
          timer.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
          
          // Remove paused indicator
          const pausedIndicator = timer.querySelector('.paused-indicator');
          if (pausedIndicator) {
            pausedIndicator.remove();
          }
          
          console.log('🍅 Pomodoro timer resumed');
        }
      };
      
      window.removePomodoroTimer = function() {
        const existingTimer = document.getElementById('pomodoro-timer');
        if (existingTimer) {
          existingTimer.remove();
          console.log('🍅 Pomodoro timer removed');
        }
      };
      
      window.playKitchenAlarm = function() {
        console.log('🔔 Playing kitchen alarm sound');
        
        // Create audio context for alarm sound
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create a kitchen timer-like alarm sound
        const playAlarmTone = (frequency, duration, delay = 0) => {
          setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
            oscillator.type = 'square'; // More buzzer-like sound
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
          }, delay);
        };
        
        // Play multiple alarm tones to simulate kitchen timer
        playAlarmTone(800, 0.2, 0);    // First beep
        playAlarmTone(800, 0.2, 300);  // Second beep
        playAlarmTone(800, 0.2, 600);  // Third beep
        playAlarmTone(1000, 0.3, 900); // Higher tone
        playAlarmTone(800, 0.2, 1300); // Final beep
        playAlarmTone(1000, 0.3, 1600); // Final higher tone
      };
      
      window.showPomodoroComplete = function(isWorkSession) {
        console.log('🍅 Pomodoro session complete:', isWorkSession ? 'Work' : 'Break');
        
        // Create completion notification
        const notification = document.createElement('div');
        notification.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: linear-gradient(135deg, #4CAF50, #45a049);
          color: white;
          padding: 30px;
          border-radius: 15px;
          font-family: Arial, sans-serif;
          font-size: 24px;
          font-weight: bold;
          text-align: center;
          z-index: 20000;
          box-shadow: 0 8px 32px rgba(76, 175, 80, 0.5);
          border: 3px solid #4CAF50;
          animation: celebration 2s ease-in-out;
        `;
        
        notification.innerHTML = `
          <div style="font-size: 48px; margin-bottom: 15px;">${isWorkSession ? '🎉' : '☕'}</div>
          <div>${isWorkSession ? 'Work Session Complete!' : 'Break Time!'}</div>
          <div style="font-size: 16px; margin-top: 10px; opacity: 0.9;">
            ${isWorkSession ? 'Time for a 5-minute break!' : 'Ready to get back to work?'}
          </div>
          <div style="font-size: 14px; margin-top: 15px; opacity: 0.8;">🍅 Pomodoro Timer</div>
        `;
        
        // Add celebration animation
        if (!document.getElementById('celebration-animation')) {
          const style = document.createElement('style');
          style.id = 'celebration-animation';
          style.textContent = `
            @keyframes celebration {
              0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
              50% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
              100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
            @keyframes pulse {
              0% { transform: scale(1); }
              50% { transform: scale(1.05); }
              100% { transform: scale(1); }
            }
          `;
          document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        // Remove notification after 5 seconds
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
        }, 5000);
      };
      
      console.log('🍅 Pomodoro timer functions injected');
    }
  }).then(() => {
    // Now create the timer
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (duration, isWorkSession) => {
        window.createPomodoroTimer(duration, isWorkSession);
      },
      args: [duration, isWorkSession]
    }).catch(error => {
      console.log('Could not create Pomodoro timer for tab:', tabId, error);
    });
  }).catch(error => {
    console.log('Could not inject Pomodoro timer functions for tab:', tabId, error);
  });
  
  // Set up timer to update every second
  const timerId = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, duration - elapsed);
    
    // Update timer display
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (remaining, isWorkSession) => {
        window.updatePomodoroTimer(remaining, isWorkSession);
      },
      args: [remaining, isWorkSession]
    }).catch(error => {
      console.log('Could not update Pomodoro timer for tab:', tabId, error);
    });
    
    // Check if timer is finished
    if (remaining <= 0) {
      clearInterval(timerId);
      pomodoroTimers.delete(tabId);
      
      // Timer finished - play alarm and show notification
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (isWorkSession) => {
          window.playKitchenAlarm();
          window.showPomodoroComplete(isWorkSession);
        },
        args: [isWorkSession]
      }).catch(error => {
        console.log('Could not show Pomodoro complete for tab:', tabId, error);
      });
      
      console.log('🍅 Pomodoro timer finished for tab:', tabId);
      
      // Auto-start next session after a short delay
      setTimeout(() => {
        if (isWorkSession) {
          console.log('🍅 Auto-starting break session');
          startPomodoroTimer(tabId, false);
        } else {
          console.log('🍅 Break finished - ready for work session');
          globalBreakMode.delete(tabId);
        }
      }, 3000); // 3 second delay before auto-starting next session
    }
  }, 1000);
  
  pomodoroTimers.set(tabId, { timerId, startTime, duration, isActive: true, isWorkSession });
}

function stopPomodoroTimer(tabId) {
  const timerData = pomodoroTimers.get(tabId);
  if (timerData) {
    console.log('🍅 Pausing Pomodoro timer for tab:', tabId);
    clearInterval(timerData.timerId);
    
    // Mark timer as paused instead of deleting it
    timerData.isActive = false;
    timerData.isPaused = true;
    pomodoroTimers.set(tabId, timerData);
    
    // Clear break mode
    globalBreakMode.delete(tabId);
    
    // Pause timer display (show paused state)
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        window.pausePomodoroTimer();
      }
    }).catch(error => {
      console.log('Could not pause Pomodoro timer for tab:', tabId, error);
    });
  }
}

function resumePomodoroTimer(tabId, timerData) {
  console.log('🍅 Resuming Pomodoro timer for tab:', tabId);
  
  // Calculate remaining time
  const elapsed = Date.now() - timerData.startTime;
  const remaining = Math.max(0, timerData.duration - elapsed);
  
  if (remaining <= 0) {
    // Timer was already finished, remove it
    pomodoroTimers.delete(tabId);
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        window.removePomodoroTimer();
      }
    }).catch(error => {
      console.log('Could not remove completed Pomodoro timer for tab:', tabId, error);
    });
    return;
  }
  
  // Resume the timer
  const newStartTime = Date.now();
  timerData.startTime = newStartTime;
  timerData.isActive = true;
  timerData.isPaused = false;
  pomodoroTimers.set(tabId, timerData);
  
  // Resume timer display
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      window.resumePomodoroTimer();
    }
  }).catch(error => {
    console.log('Could not resume Pomodoro timer for tab:', tabId, error);
  });
  
  // Restart the interval
  const timerId = setInterval(() => {
    const elapsed = Date.now() - newStartTime;
    const remaining = Math.max(0, timerData.duration - elapsed);
    
    // Update timer display
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (remaining, isWorkSession) => {
        window.updatePomodoroTimer(remaining, isWorkSession);
      },
      args: [remaining, timerData.isWorkSession]
    }).catch(error => {
      console.log('Could not update Pomodoro timer for tab:', tabId, error);
    });
    
    // Check if timer is finished
    if (remaining <= 0) {
      clearInterval(timerId);
      pomodoroTimers.delete(tabId);
      
      // Timer finished - play alarm and show notification
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (isWorkSession) => {
          window.playKitchenAlarm();
          window.showPomodoroComplete(isWorkSession);
        },
        args: [timerData.isWorkSession]
      }).catch(error => {
        console.log('Could not show Pomodoro complete for tab:', tabId, error);
      });
      
      console.log('🍅 Pomodoro timer finished for tab:', tabId);
      
      // Auto-start next session after a short delay
      setTimeout(() => {
        if (timerData.isWorkSession) {
          console.log('🍅 Auto-starting break session');
          startPomodoroTimer(tabId, false);
        } else {
          console.log('🍅 Break finished - ready for work session');
          globalBreakMode.delete(tabId);
        }
      }, 3000); // 3 second delay before auto-starting next session
    }
  }, 1000);
  
  timerData.timerId = timerId;
  pomodoroTimers.set(tabId, timerData);
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
            
            // Define Pomodoro timer functions inside injected script
            function createPomodoroTimer(duration, isWorkSession) {
              console.log('🍅 Creating Pomodoro timer:', duration, 'Work session:', isWorkSession);
              
              // Remove any existing timer
              removePomodoroTimer();
              
              // Calculate initial time display
              const minutes = Math.floor(duration / 60000);
              const seconds = Math.floor((duration % 60000) / 1000);
              const initialTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              
              // Create compact timer for extension bar area
              const timer = document.createElement('div');
              timer.id = 'pomodoro-timer';
              timer.style.cssText = `
                position: fixed;
                top: 8px;
                right: 200px;
                background: ${isWorkSession ? 'linear-gradient(135deg, #4CAF50, #45a049)' : 'linear-gradient(135deg, #f44336, #d32f2f)'};
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 12px;
                font-weight: bold;
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                border: 1px solid ${isWorkSession ? '#4CAF50' : '#f44336'};
                cursor: pointer;
                transition: all 0.2s ease;
                min-width: 60px;
                justify-content: center;
              `;
              
              // Add timer content
              timer.innerHTML = `
                <span style="font-size: 10px;">${isWorkSession ? '🍅' : '☕'}</span>
                <span id="timer-display" style="font-family: 'Courier New', monospace;">${initialTime}</span>
              `;
              
              // Add hover effect
              timer.addEventListener('mouseenter', () => {
                timer.style.transform = 'scale(1.05)';
                timer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
              });
              
              timer.addEventListener('mouseleave', () => {
                timer.style.transform = 'scale(1)';
                timer.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
              });
              
              // Click to pause/resume (placeholder for now)
              timer.addEventListener('click', () => {
                console.log('🍅 Pomodoro timer clicked');
              });
              
              document.body.appendChild(timer);
              console.log('🍅 Compact Pomodoro timer created with initial time:', initialTime);
            }
            
            function updatePomodoroTimer(remaining, isWorkSession) {
              const timerDisplay = document.getElementById('timer-display');
              const timer = document.getElementById('pomodoro-timer');
              
              if (timerDisplay && timer) {
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                timerDisplay.textContent = timeString;
                
                // Update color based on session type and remaining time
                if (isWorkSession) {
                  // Work session - green colors
                  if (remaining < 60000) { // Less than 1 minute
                    timer.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)'; // Orange warning
                    timer.style.borderColor = '#ff9800';
                  } else if (remaining < 300000) { // Less than 5 minutes
                    timer.style.background = 'linear-gradient(135deg, #8bc34a, #689f38)'; // Lighter green
                    timer.style.borderColor = '#8bc34a';
                  } else {
                    timer.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)'; // Full green
                    timer.style.borderColor = '#4CAF50';
                  }
                } else {
                  // Break session - red colors
                  if (remaining < 60000) { // Less than 1 minute
                    timer.style.background = 'linear-gradient(135deg, #ff5722, #e64a19)'; // Darker red warning
                    timer.style.borderColor = '#ff5722';
                  } else {
                    timer.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)'; // Full red
                    timer.style.borderColor = '#f44336';
                  }
                }
                
                // Add pulsing animation when time is running low
                if (remaining < 60000) {
                  timer.style.animation = 'pulse 1s infinite';
                } else {
                  timer.style.animation = 'none';
                }
              }
            }
            
            function playKitchenAlarm() {
              console.log('🔔 Playing kitchen alarm sound');
              
              // Create audio context for alarm sound
              const audioContext = new (window.AudioContext || window.webkitAudioContext)();
              
              // Create a kitchen timer-like alarm sound
              const playAlarmTone = (frequency, duration, delay = 0) => {
                setTimeout(() => {
                  const oscillator = audioContext.createOscillator();
                  const gainNode = audioContext.createGain();
                  
                  oscillator.connect(gainNode);
                  gainNode.connect(audioContext.destination);
                  
                  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
                  oscillator.type = 'square'; // More buzzer-like sound
                  
                  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                  
                  oscillator.start(audioContext.currentTime);
                  oscillator.stop(audioContext.currentTime + duration);
                }, delay);
              };
              
              // Play multiple alarm tones to simulate kitchen timer
              playAlarmTone(800, 0.2, 0);    // First beep
              playAlarmTone(800, 0.2, 300);  // Second beep
              playAlarmTone(800, 0.2, 600);  // Third beep
              playAlarmTone(1000, 0.3, 900); // Higher tone
              playAlarmTone(800, 0.2, 1300); // Final beep
              playAlarmTone(1000, 0.3, 1600); // Final higher tone
            }
            
            function showPomodoroComplete(isWorkSession) {
              console.log('🍅 Pomodoro session complete:', isWorkSession ? 'Work' : 'Break');
              
              // Create completion notification
              const notification = document.createElement('div');
              notification.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: linear-gradient(135deg, #4CAF50, #45a049);
                color: white;
                padding: 30px;
                border-radius: 15px;
                font-family: Arial, sans-serif;
                font-size: 24px;
                font-weight: bold;
                text-align: center;
                z-index: 20000;
                box-shadow: 0 8px 32px rgba(76, 175, 80, 0.5);
                border: 3px solid #4CAF50;
                animation: celebration 2s ease-in-out;
              `;
              
              notification.innerHTML = `
                <div style="font-size: 48px; margin-bottom: 15px;">${isWorkSession ? '🎉' : '☕'}</div>
                <div>${isWorkSession ? 'Work Session Complete!' : 'Break Time!'}</div>
                <div style="font-size: 16px; margin-top: 10px; opacity: 0.9;">
                  ${isWorkSession ? 'Time for a 5-minute break!' : 'Ready to get back to work?'}
                </div>
                <div style="font-size: 14px; margin-top: 15px; opacity: 0.8;">🍅 Pomodoro Timer</div>
              `;
              
              // Add celebration animation
              if (!document.getElementById('celebration-animation')) {
                const style = document.createElement('style');
                style.id = 'celebration-animation';
                style.textContent = `
                  @keyframes celebration {
                    0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                    50% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
                    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                  }
                  @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                    100% { transform: scale(1); }
                  }
                `;
                document.head.appendChild(style);
              }
              
              document.body.appendChild(notification);
              
              // Remove notification after 5 seconds
              setTimeout(() => {
                if (notification.parentNode) {
                  notification.remove();
                }
              }, 5000);
            }
            
            function removePomodoroTimer() {
              const existingTimer = document.getElementById('pomodoro-timer');
              if (existingTimer) {
                existingTimer.remove();
                console.log('🍅 Pomodoro timer removed');
              }
            }
            
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

  // Handle Pomodoro timer requests
  if (msg?.type === "START_POMODORO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        startPomodoroTimer(tabs[0].id, msg.isWorkSession !== false);
      }
    });
    sendResponse({ ok: true });
    return true;
  }
  
  if (msg?.type === "STOP_POMODORO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        stopPomodoroTimer(tabs[0].id);
      }
    });
    sendResponse({ ok: true });
    return true;
  }
  
  if (msg?.type === "PAUSE_POMODORO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        stopPomodoroTimer(tabs[0].id); // This now pauses instead of stops
      }
    });
    sendResponse({ ok: true });
    return true;
  }
  
  if (msg?.type === "RESUME_POMODORO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const timerData = pomodoroTimers.get(tabs[0].id);
        if (timerData && timerData.isPaused) {
          // Resume the paused timer
          resumePomodoroTimer(tabs[0].id, timerData);
        } else {
          sendResponse({ ok: false, error: "No paused timer found" });
        }
      }
    });
    sendResponse({ ok: true });
    return true;
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
