const statusEl = document.getElementById("status");
const backendEl = document.getElementById("backend");
const saveBtn = document.getElementById("save");
const startWorkBtn = document.getElementById("start-work");
const startBreakBtn = document.getElementById("start-break");
const pauseTimerBtn = document.getElementById("pause-timer");
const resumeTimerBtn = document.getElementById("resume-timer");
const openClosetBtn = document.getElementById("open-closet");
const tokenCountEl = document.getElementById("token-count");
const bearNameEl = document.getElementById("bear-name");

chrome.storage.sync.get(["backendUrl"], ({ backendUrl }) => {
  backendEl.value = backendUrl || "http://localhost:4000";
});

saveBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({ backendUrl: backendEl.value.trim() });
  saveBtn.textContent = "Saved!";
  setTimeout(() => (saveBtn.textContent = "Save"), 800);
});

// Pomodoro timer event listeners
startWorkBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "START_POMODORO", isWorkSession: true }, (response) => {
    if (response && response.ok) {
      startWorkBtn.textContent = "Started!";
      setTimeout(() => (startWorkBtn.textContent = "Start Work (25m)"), 1000);
    }
  });
});

startBreakBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "START_POMODORO", isWorkSession: false }, (response) => {
    if (response && response.ok) {
      startBreakBtn.textContent = "Started!";
      setTimeout(() => (startBreakBtn.textContent = "Start Break (5m)"), 1000);
    } else if (response && !response.ok) {
      // Security system blocked the break
      startBreakBtn.textContent = "Blocked!";
      startBreakBtn.style.background = "#dc2626"; // Red background
      setTimeout(() => {
        startBreakBtn.textContent = "Start Break (5m)";
        startBreakBtn.style.background = "#059669"; // Reset to green
      }, 2000);
    }
  });
});

pauseTimerBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PAUSE_POMODORO" }, (response) => {
    if (response && response.ok) {
      pauseTimerBtn.textContent = "Paused!";
      setTimeout(() => (pauseTimerBtn.textContent = "Pause Timer"), 1000);
    }
  });
});

resumeTimerBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESUME_POMODORO" }, (response) => {
    if (response && response.ok) {
      resumeTimerBtn.textContent = "Resumed!";
      setTimeout(() => (resumeTimerBtn.textContent = "Resume Timer"), 1000);
    }
  });
});

// Virtual closet event listener
openClosetBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_CLOSET" }, (response) => {
    if (response && response.ok) {
      openClosetBtn.textContent = "Opening...";
      setTimeout(() => (openClosetBtn.textContent = "Open Bear Closet"), 1000);
    }
  });
});

// Update bear name
function updateBearName() {
  chrome.runtime.sendMessage({ type: "GET_BEAR_NAME" }, (response) => {
    if (response && response.bearName) {
      bearNameEl.textContent = response.bearName;
    } else {
      bearNameEl.textContent = "Virtual Closet";
    }
  });
}

// Update token count
function updateTokenCount() {
  chrome.runtime.sendMessage({ type: "GET_TOKEN_COUNT" }, (response) => {
    if (response && response.tokens !== undefined) {
      tokenCountEl.textContent = `🪙 Tokens: ${response.tokens}`;
    } else {
      tokenCountEl.textContent = "🪙 Tokens: Loading...";
    }
  });
}

function renderStatus(s) {
  if (!s) {
    statusEl.textContent = "No classification yet for this tab.";
    return;
  }
  statusEl.innerHTML = `
    <div style="display:flex; gap:8px; align-items:center;">
      <span class="pill ${s.productive ? "prod" : "unprod"}">
        ${s.productive ? "Productive" : "Not Productive"}
      </span>
      <span class="muted">${s.category || "uncategorized"}</span>
    </div>
    <div style="margin-top:8px; font-weight:600;">${s.title}</div>
    <div class="muted" style="word-break:break-all;">${s.url}</div>
    <div style="margin-top:8px;">${s.reason || ""}</div>
  `;
}

function loading(msg = "Classifying…") {
  statusEl.textContent = msg;
}

// Immediately classify the active tab on popup open
document.addEventListener("DOMContentLoaded", () => {
  loading();
  updateTokenCount(); // Update token count on popup open
  updateBearName(); // Update bear name on popup open
  
  chrome.runtime.sendMessage({ type: "CLASSIFY_ACTIVE" }, (resp) => {
    if (!resp || resp.ok === false) {
      // Try to at least show the last-known status if present
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, ({ status }) => {
        if (!resp || resp.error) {
          statusEl.textContent = resp?.error || "Classification failed.";
        }
        if (status) renderStatus(status);
      });
      return;
    }
    renderStatus(resp.status || null);
  });
});