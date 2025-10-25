const statusEl = document.getElementById("status");
const backendEl = document.getElementById("backend");
const saveBtn = document.getElementById("save");

chrome.storage.sync.get(["backendUrl"], ({ backendUrl }) => {
  backendEl.value = backendUrl || "http://localhost:4000";
});

saveBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({ backendUrl: backendEl.value.trim() });
  saveBtn.textContent = "Saved!";
  setTimeout(() => (saveBtn.textContent = "Save"), 800);
});

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

chrome.runtime.sendMessage({ type: "GET_STATUS" }, ({ status }) => {
  renderStatus(status);
});
