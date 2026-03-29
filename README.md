# Real-Time American Sign Language Translator for Google Meet

## Overview
This project is developed by Pritham, Mano, and Raghav for our Design of Smart Cities course, submitted to Professor Kabilan K.

We developed this system to recognize the American Sign Language alphabet and translate it into text in real time. Our goal is to make digital communication more accessible for the deaf and hard-of-hearing community. The system integrates directly with Google Meet as a browser extension, allowing users to communicate through sign language during video conferences.

The application captures hand gestures through the user's webcam, extracts specific hand landmarks, and classifies the gestures using a trained machine learning model. The model recognizes letters from "A" to "Z" and includes additional functional gestures such as space, backspace, and clear text.

## Structure
The project is divided into two main components:
1. **Backend Server**: A local Python server that processes video frames using computer vision and predicts the corresponding sign language letter.
2. **Browser Extension**: A user interface overlay that operates within Google Meet, captures the webcam feed, communicates with the backend, and inserts the translated text into the meeting chat.

## Requirements
To run this system, you need the following installed on your machine:
- Python 3
- Google Chrome browser

## Setup Instructions

### 1. Start the Backend Server
The backend server handles the processing for gesture recognition.

1. Open a terminal and navigate to the `backend` directory.
2. Install the required Python dependencies:
```bash
pip install fastapi uvicorn mediapipe opencv-python numpy scikit-learn pydantic
```
3. Start the server:
```bash
python server.py
```
The server will start running locally on port 8765.

### 2. Load the Browser Extension
The extension provides the interface inside Google Meet.

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked" and select the `extension` folder from this project directory.

### 3. Usage in Google Meet
1. Open a Google Meet session in your browser.
2. Click the translator extension icon in your Chrome toolbar.
3. Click "Start Translation".
4. An overlay will appear showing your camera feed. Perform sign language gestures clearly in front of the camera.
5. The translated text will appear on the screen. Click "Send" to place the configured text directly into the Google Meet chat.

## Model Details
We utilize a Random Forest Classifier trained on a dataset of hand landmark coordinates. The data preparation involved extracting relative coordinate points to ensure the model focuses on hand shape rather than exact screen placement. The model processes one frame at a time to determine the most probable letter or command.

## License
This project is licensed under the MIT License.
