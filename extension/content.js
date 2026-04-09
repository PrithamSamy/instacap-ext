// ============================================
// InstaCap - ASL Hand Sign Translator for Google Meet
// Content Script (injected into meet.google.com)
// ============================================

(function () {
  "use strict";

  const HTTP_URL = "http://localhost:8765";
  const WS_URL = "ws://localhost:8765/ws";
  
  // Adjusted for faster websocket frame rates (~30fps)
  const STABILITY_THRESHOLD = 5;        
  const MIN_CONFIDENCE = 0.6;          
  const DEBOUNCE_MS = 600;              

  let isRunning = false;
  let stream = null;
  let ws = null;
  let captureInterval = null;
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
          <button class="instacap-btn" id="instacap-send-btn">Send</button>
          <button class="instacap-btn" id="instacap-clear-btn">Clear</button>
        </div>
        <div id="instacap-status">Connecting...</div>
      </div>
    `;
    document.body.appendChild(overlay);

    canvasElement = document.createElement("canvas");
    canvasElement.width = 640;
    canvasElement.height = 480;
    canvasElement.style.display = "none";
    document.body.appendChild(canvasElement);

    document.getElementById("instacap-send-btn").addEventListener("click", sendToMeetChat);
    document.getElementById("instacap-clear-btn").addEventListener("click", clearComposedText);
    document.getElementById("instacap-minimize-btn").addEventListener("click", stopAndRemove);

    videoElement = document.getElementById("instacap-video");
  }

  // ── Toast notification (No emojis) ─────────────────────
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
      updateStatus("connected", "Camera active");
      return true;
    } catch (err) {
      console.error("[InstaCap] Camera error:", err);
      updateStatus("error", "Camera denied");
      showToast("Camera access denied. Please allow camera permissions.");
      return false;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  // ── Frame Capture & WebSocket ────────────────────────
  function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      updateStatus("connected", "Detecting...");
      startStreamingFrames();
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handlePrediction(data);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      updateStatus("error", "Connection error");
    };

    ws.onclose = () => {
      updateStatus("error", "Backend offline");
      if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
      }
    };
  }

  function startStreamingFrames() {
    if (captureInterval) clearInterval(captureInterval);
    captureInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && videoElement.readyState >= 2) {
        const ctx = canvasElement.getContext("2d");
        ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        const dataUrl = canvasElement.toDataURL("image/jpeg", 0.85);
        const base64Data = dataUrl.split(",")[1];
        ws.send(base64Data);
      }
    }, 60); // approx 16 fps capturing
  }

  function handlePrediction(data) {
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

    if (data.confidence < MIN_CONFIDENCE) {
      return;
    }

    document.getElementById("instacap-current-letter").textContent = data.letter;
    document.getElementById("instacap-confidence-fill").style.width = `${data.confidence * 100}%`;

    processPrediction(data.letter, data.raw);
  }

  // ── Stability / Smoothing ──────────────────────────
  function processPrediction(letter, raw) {
    predictionBuffer.push(letter);

    if (predictionBuffer.length > STABILITY_THRESHOLD) {
      predictionBuffer.shift();
    }

    if (predictionBuffer.length < STABILITY_THRESHOLD) return;
    const allSame = predictionBuffer.every(p => p === predictionBuffer[0]);
    if (!allSame) return;

    const stableLetter = predictionBuffer[0];

    const now = Date.now();
    if (stableLetter === lastAcceptedLetter && (now - lastAcceptedTime) < DEBOUNCE_MS) {
      return;
    }

    lastAcceptedTime = now;
    lastAcceptedLetter = stableLetter;
    predictionBuffer = [];

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
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      if (el.closest('[data-panel-id]') || el.closest('[aria-label*="chat" i]') ||
          el.closest('[aria-label*="message" i]') || el.closest('[jsname]')) {
        return el;
      }
    }
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      const label = (ta.getAttribute("aria-label") || "").toLowerCase();
      const placeholder = (ta.getAttribute("placeholder") || "").toLowerCase();
      if (label.includes("chat") || label.includes("message") ||
          placeholder.includes("message") || placeholder.includes("chat")) {
        return ta;
      }
    }
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
      showToast("Chat not found. Please open Meet chat panel first.");
      return;
    }

    try {
      chatInput.focus();

      if (chatInput.tagName === "TEXTAREA" || chatInput.tagName === "INPUT") {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        
        if (nativeInputValueSetter) {
             nativeInputValueSetter.call(chatInput, composedText);
        } else {
             chatInput.value = composedText;
        }
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        // Clear existing text securely and insert new
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, composedText);
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // Simulate Enter key specifically to bypass extra standard user input
      setTimeout(() => {
        const enterEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13
        });
        chatInput.dispatchEvent(enterEvent);
        
        composedText = "";
        updateComposedDisplay();
        showToast("Message sent.");
      }, 100);

    } catch (err) {
      console.error("[InstaCap] Chat injection error:", err);
      showToast("Failed to insert text.");
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

    try {
      const res = await fetch(`${HTTP_URL}/health`);
      if (!res.ok) throw new Error("Backend not ok");
    } catch (e) {
      updateStatus("error", "Backend offline");
      showToast("Backend not running. Start the Python server first.");
      return;
    }

    const camOk = await startCamera();
    if (!camOk) return;

    isRunning = true;
    connectWebSocket();
    showToast("InstaCap translation started.");
  }

  function stop() {
    isRunning = false;
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    stopCamera();
    predictionBuffer = [];
  }

  function stopAndRemove() {
    stop();
    if (overlay) {
      overlay.style.display = "none";
    }
    showToast("InstaCap stopped.");
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
