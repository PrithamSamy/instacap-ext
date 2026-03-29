// ============================================
// InstaCap - ASL Hand Sign Translator for Google Meet
// Content Script (injected into meet.google.com)
// ============================================

(function () {
  "use strict";

  const BACKEND_URL = "http://localhost:8765";
  const CAPTURE_INTERVAL_MS = 100;      // Send frame every 100ms
  const STABILITY_THRESHOLD = 3;        // Same prediction N times before accepting
  const MIN_CONFIDENCE = 0.45;          // Ignore predictions below this
  const DEBOUNCE_MS = 800;              // Minimum time between accepted letters

  // State
  let isRunning = false;
  let stream = null;
  let captureTimer = null;
  let predictionBuffer = [];
  let composedText = "";
  let lastAcceptedTime = 0;
  let lastAcceptedLetter = "";
  let videoElement = null;
  let canvasElement = null;
  let overlay = null;

  // ── Create Overlay UI ──────────────────────────────
  function createOverlay() {
    if (document.getElementById("instacap-overlay")) return;

    overlay = document.createElement("div");
    overlay.id = "instacap-overlay";
    overlay.innerHTML = `
      <div id="instacap-camera-container">
        <video id="instacap-video" autoplay muted playsinline></video>
        <div id="instacap-camera-label"><span class="dot"></span> ASL Cam</div>
        <button id="instacap-minimize-btn" title="Close">✕</button>
      </div>
      <div id="instacap-prediction-panel">
        <div id="instacap-current-letter">—</div>
        <div id="instacap-confidence-bar"><div id="instacap-confidence-fill"></div></div>
        <div id="instacap-composed-text"></div>
        <div id="instacap-actions">
          <button class="instacap-btn" id="instacap-send-btn">📩 Send</button>
          <button class="instacap-btn" id="instacap-clear-btn">🗑 Clear</button>
        </div>
        <div id="instacap-status">Connecting...</div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Hidden canvas for frame capture
    canvasElement = document.createElement("canvas");
    canvasElement.width = 640;
    canvasElement.height = 480;
    canvasElement.style.display = "none";
    document.body.appendChild(canvasElement);

    // Event listeners
    document.getElementById("instacap-send-btn").addEventListener("click", sendToMeetChat);
    document.getElementById("instacap-clear-btn").addEventListener("click", clearComposedText);
    document.getElementById("instacap-minimize-btn").addEventListener("click", stopAndRemove);

    videoElement = document.getElementById("instacap-video");
  }

  // ── Toast notification ─────────────────────────────
  function showToast(message) {
    let toast = document.getElementById("instacap-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "instacap-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  // ── Camera ─────────────────────────────────────────
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } }
      });
      videoElement.srcObject = stream;
      await videoElement.play();
      updateStatus("connected", "Connected");
      return true;
    } catch (err) {
      console.error("[InstaCap] Camera error:", err);
      updateStatus("error", "Camera denied");
      showToast("⚠️ Camera access denied. Please allow camera permissions.");
      return false;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  // ── Frame Capture & Prediction ─────────────────────
  function captureFrame() {
    if (!videoElement || videoElement.readyState < 2) return null;
    const ctx = canvasElement.getContext("2d");
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    // Return base64 JPEG (strip the data:image/jpeg;base64, prefix)
    const dataUrl = canvasElement.toDataURL("image/jpeg", 0.9);
    return dataUrl.split(",")[1];
  }

  async function sendFrameForPrediction() {
    if (!isRunning) return;

    const frameData = captureFrame();
    if (!frameData) return;

    try {
      const response = await fetch(`${BACKEND_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frameData })
      });

      if (!response.ok) {
        updateStatus("error", "Backend error");
        return;
      }

      const data = await response.json();

      if (data.error && data.error !== "No hand detected") {
        updateStatus("error", data.error);
        return;
      }

      if (!data.letter || data.letter === "NONE") {
        document.getElementById("instacap-current-letter").textContent = "—";
        document.getElementById("instacap-confidence-fill").style.width = "0%";
        predictionBuffer = [];
        return;
      }

      // Confidence filter
      if (data.confidence < MIN_CONFIDENCE) {
        return;
      }

      updateStatus("connected", "Detecting...");

      // Update current letter display
      document.getElementById("instacap-current-letter").textContent = data.letter;
      document.getElementById("instacap-confidence-fill").style.width = `${data.confidence * 100}%`;

      // Stability logic: buffer last N predictions
      processPrediction(data.letter, data.raw);

    } catch (err) {
      updateStatus("error", "Backend offline");
    }
  }

  // ── Stability / Smoothing ──────────────────────────
  function processPrediction(letter, raw) {
    predictionBuffer.push(letter);

    // Keep buffer at STABILITY_THRESHOLD size
    if (predictionBuffer.length > STABILITY_THRESHOLD) {
      predictionBuffer.shift();
    }

    // Check if all items in buffer are the same
    if (predictionBuffer.length < STABILITY_THRESHOLD) return;
    const allSame = predictionBuffer.every(p => p === predictionBuffer[0]);
    if (!allSame) return;

    const stableLetter = predictionBuffer[0];

    // Debounce: don't accept same letter too quickly
    const now = Date.now();
    if (stableLetter === lastAcceptedLetter && (now - lastAcceptedTime) < DEBOUNCE_MS) {
      return;
    }

    // Accept the prediction
    lastAcceptedTime = now;
    lastAcceptedLetter = stableLetter;
    predictionBuffer = [];

    // Handle special commands
    if (stableLetter === "BACKSPACE") {
      composedText = composedText.slice(0, -1);
    } else if (stableLetter === "CLEAR") {
      composedText = "";
    } else if (stableLetter === "SPACE") {
      composedText += " ";
    } else {
      composedText += stableLetter;
    }

    updateComposedDisplay();
  }

  function updateComposedDisplay() {
    const el = document.getElementById("instacap-composed-text");
    if (el) el.textContent = composedText;
  }

  function clearComposedText() {
    composedText = "";
    predictionBuffer = [];
    lastAcceptedLetter = "";
    updateComposedDisplay();
  }

  // ── Google Meet Chat Injection ─────────────────────
  function findMeetChatInput() {
    // Strategy 1: contenteditable div in chat panel
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      // Meet chat input is typically in the chat panel area
      if (el.closest('[data-panel-id]') || el.closest('[aria-label*="chat" i]') ||
          el.closest('[aria-label*="message" i]') || el.closest('[jsname]')) {
        return el;
      }
    }

    // Strategy 2: textarea with chat-related attributes
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      const label = (ta.getAttribute("aria-label") || "").toLowerCase();
      const placeholder = (ta.getAttribute("placeholder") || "").toLowerCase();
      if (label.includes("chat") || label.includes("message") ||
          placeholder.includes("message") || placeholder.includes("chat")) {
        return ta;
      }
    }

    // Strategy 3: Any contenteditable as last resort
    if (editables.length > 0) {
      return editables[editables.length - 1];
    }

    return null;
  }

  function sendToMeetChat() {
    if (!composedText.trim()) {
      showToast("Nothing to send");
      return;
    }

    const chatInput = findMeetChatInput();
    if (!chatInput) {
      showToast("Chat not found — open Meet chat panel first");
      return;
    }

    try {
      // Insert text based on element type
      if (chatInput.tagName === "TEXTAREA" || chatInput.tagName === "INPUT") {
        // For textarea/input elements
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(chatInput, composedText);
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        // For contenteditable divs
        chatInput.focus();
        chatInput.textContent = composedText;
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
        chatInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
        chatInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      }

      // Try to click the send button
      setTimeout(() => {
        // Look for send button near the chat input
        const sendButtons = document.querySelectorAll(
          'button[aria-label*="Send" i], button[data-mdc-dialog-action="send"], [aria-label*="send" i]'
        );
        if (sendButtons.length > 0) {
          sendButtons[sendButtons.length - 1].click();
          composedText = "";
          updateComposedDisplay();
          showToast("✅ Message sent!");
        } else {
          showToast("✅ Text inserted — press Enter to send");
        }
      }, 200);

    } catch (err) {
      console.error("[InstaCap] Chat injection error:", err);
      showToast("❌ Failed to insert text");
    }
  }

  // ── Status Updates ─────────────────────────────────
  function updateStatus(type, message) {
    const el = document.getElementById("instacap-status");
    if (!el) return;
    el.textContent = message;
    el.className = type;
  }

  // ── Start / Stop ───────────────────────────────────
  async function start() {
    if (isRunning) return;

    createOverlay();
    overlay.style.display = "flex";

    // Check backend health
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (!res.ok) throw new Error("Backend not ok");
    } catch (e) {
      updateStatus("error", "Backend offline — start server first");
      showToast("⚠️ Backend not running. Start the Python server first.");
      return;
    }

    const camOk = await startCamera();
    if (!camOk) return;

    isRunning = true;
    captureTimer = setInterval(sendFrameForPrediction, CAPTURE_INTERVAL_MS);
    showToast("🤟 InstaCap started — show your signs!");
  }

  function stop() {
    isRunning = false;
    if (captureTimer) {
      clearInterval(captureTimer);
      captureTimer = null;
    }
    stopCamera();
    predictionBuffer = [];
  }

  function stopAndRemove() {
    stop();
    if (overlay) {
      overlay.style.display = "none";
    }
    showToast("InstaCap stopped");
  }

  // ── Message from popup ─────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "start") {
      start();
      sendResponse({ status: "started" });
    } else if (msg.action === "stop") {
      stop();
      sendResponse({ status: "stopped" });
    } else if (msg.action === "status") {
      sendResponse({ isRunning: isRunning, text: composedText });
    }
    return true;
  });

  console.log("[InstaCap] Content script loaded on Google Meet.");

})();
