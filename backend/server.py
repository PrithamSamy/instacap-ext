import pickle
import base64
import numpy as np
import cv2
import mediapipe as mp
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import warnings

warnings.filterwarnings("ignore")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model
model_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ASL_model.p")
with open(model_path, "rb") as f:
    model_data = pickle.load(f)
rf_model = model_data["model"]

# Label map
LABELS = {
    "a": "A", "b": "B", "c": "C", "d": "D", "e": "E", "f": "F", "g": "G",
    "h": "H", "i": "I", "j": "J", "k": "K", "l": "L", "m": "M", "n": "N",
    "o": "O", "p": "P", "q": "Q", "r": "R", "s": "S", "t": "T", "u": "U",
    "v": "V", "w": "W", "x": "X", "y": "Y", "z": "Z",
    "1": "BACKSPACE", "2": "CLEAR", "3": "SPACE", "4": "NONE"
}

# MediaPipe Hands
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=1,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)


class FrameRequest(BaseModel):
    image: str  # base64 encoded JPEG


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(req: FrameRequest):
    try:
        # Decode base64 image
        img_bytes = base64.b64decode(req.image)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame is None:
            return {"letter": None, "confidence": 0, "error": "Invalid image"}

        # Process with MediaPipe
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands.process(frame_rgb)

        if not result.multi_hand_landmarks:
            return {"letter": None, "confidence": 0, "error": "No hand detected"}

        hand_landmark = result.multi_hand_landmarks[0]

        # Extract and normalize landmarks (same as training)
        x_coords = [lm.x for lm in hand_landmark.landmark]
        y_coords = [lm.y for lm in hand_landmark.landmark]
        min_x, min_y = min(x_coords), min(y_coords)

        normalized = []
        for lm in hand_landmark.landmark:
            normalized.extend([lm.x - min_x, lm.y - min_y])

        # Predict
        sample = np.asarray(normalized).reshape(1, -1)

        # Check feature length matches model expectation
        if sample.shape[1] != 42:
            return {"letter": None, "confidence": 0, "error": f"Feature mismatch: got {sample.shape[1]}"}

        prediction = rf_model.predict(sample)[0]
        probabilities = rf_model.predict_proba(sample)[0]
        confidence = float(max(probabilities))

        label = LABELS.get(prediction, prediction)

        return {"letter": label, "confidence": round(confidence, 3), "raw": prediction}

    except Exception as e:
        return {"letter": None, "confidence": 0, "error": str(e)}


if __name__ == "__main__":
    print("Starting ASL Backend on http://localhost:8765")
    uvicorn.run(app, host="0.0.0.0", port=8765)
