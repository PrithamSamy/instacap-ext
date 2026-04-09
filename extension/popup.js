// ============================================
// InstaCap Popup Controller
// ============================================

const BACKEND_URL = "http://localhost:8765";

const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const backendDot = document.getElementById("backend-dot");
const backendText = document.getElementById("backend-text");

// ── Check backend health ─────────────────────────
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      backendDot.classList.add("online");
      backendDot.classList.remove("offline");
      backendText.textContent = "Backend running";
      return true;
    }
  } catch (e) { /* fall through */ }

  backendDot.classList.add("offline");
  backendDot.classList.remove("online");
  backendText.textContent = "Backend offline — start server";
  return false;
}

// ── Send message to content script ───────────────
function sendToContent(action) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  });
}

// ── Update UI state ──────────────────────────────
function setUIState(running) {
  if (running) {
    btnStart.disabled = true;
    btnStop.disabled = false;
    statusDot.classList.add("active");
    statusDot.classList.remove("error");
    statusText.textContent = "Running";
  } else {
    btnStart.disabled = false;
    btnStop.disabled = true;
    statusDot.classList.remove("active");
    statusText.textContent = "Idle";
  }
}

// ── Check if we're on Google Meet ────────────────
async function isOnMeet() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes("meet.google.com")) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

// ── Event Handlers ───────────────────────────────
btnStart.addEventListener("click", async () => {
  const onMeet = await isOnMeet();
  if (!onMeet) {
    statusDot.classList.add("error");
    statusText.textContent = "Open Google Meet first";
    return;
  }

  const backendOnline = await checkBackend();
  if (!backendOnline) {
    statusDot.classList.add("error");
    statusText.textContent = "Start backend first";
    return;
  }

  const res = await sendToContent("start");
  if (res) {
    setUIState(true);
  } else {
    statusDot.classList.add("error");
    statusText.textContent = "Failed — reload Meet page";
  }
});

btnStop.addEventListener("click", async () => {
  await sendToContent("stop");
  setUIState(false);
});

// ── Initialize ───────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await checkBackend();

  // Check current status from content script
  const status = await sendToContent("status");
  if (status && status.isRunning) {
    setUIState(true);
  }
});
