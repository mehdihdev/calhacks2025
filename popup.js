const statusEl = document.getElementById("status");
const backendEl = document.getElementById("backend");
const saveBtn = document.getElementById("save");

chrome.storage.sync.get(["backendUrl"], ({ backendUrl }) => {
  backendEl.value = backendUrl || "http://127.0.0.1:5000";
});

saveBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({ backendUrl: backendEl.value.trim() });
  saveBtn.textContent = "Saved!";
  setTimeout(() => (saveBtn.textContent = "Save"), 800);
});

async function getBalance() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["virtualBalance"], ({ virtualBalance }) => {
      resolve(virtualBalance ?? 10); // default $10
    });
  });
}

async function setBalance(newBalance) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ virtualBalance: newBalance }, resolve);
  });
}

function showBalance(balance) {
  const existing = document.getElementById("balance");
  if (existing) existing.remove();

  const balanceDiv = document.createElement("div");
  balanceDiv.id = "balance";
  balanceDiv.style.marginTop = "8px";
  balanceDiv.innerHTML = `💰 Balance: $${balance.toFixed(2)}`;
  statusEl.parentElement.insertBefore(balanceDiv, statusEl.nextSibling);
}

function renderStatus(s, balance) {
  if (!s) {
    statusEl.textContent = "No classification yet for this tab.";
    showBalance(balance);
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

  showBalance(balance);

  // 💸 Trigger punishment if unproductive
  if (!s.productive) {
    triggerPunishment(balance);
  }
}

async function triggerPunishment(currentBalance) {
  const loss = 0.5;
  const newBalance = Math.max(0, currentBalance - loss);
  await setBalance(newBalance);

  // Notification popup
  chrome.notifications.create({
    type: "basic",
    iconUrl: "calhacksicon.png",
    title: "💸 Productivity Fine!",
    message: `You lost $${loss.toFixed(2)} for visiting a distracting site!\nBalance: $${newBalance.toFixed(2)}.`,
    priority: 2,
  });

  // Update balance visually
  showBalance(newBalance);
}

function loading(msg = "Classifying…") {
  statusEl.textContent = msg;
}

document.addEventListener("DOMContentLoaded", async () => {
  const balance = await getBalance();
  showBalance(balance);

  loading();
  chrome.runtime.sendMessage({ type: "CLASSIFY_ACTIVE" }, async (resp) => {
    if (!resp || resp.ok === false) {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, async ({ status }) => {
        if (!resp || resp.error) {
          statusEl.textContent = resp?.error || "Classification failed.";
        }
        const balanceNow = await getBalance();
        if (status) renderStatus(status, balanceNow);
      });
      return;
    }
    const balanceNow = await getBalance();
    renderStatus(resp.status || null, balanceNow);
  });
});
