# Mimic Voice Lab

A browser experiment: record yourself, get a live transcript, and train a small neural network that learns to speak in your voice from those recordings. Everything trains and stays in your browser.

## Run it

The microphone only works on https or localhost, so serve the folder rather than opening the file directly:

```
python3 -m http.server 8000
# open http://localhost:8000/mimic-voice-lab/
```

Use Chrome or Edge for automatic transcription. Other browsers still record, and you type each transcript yourself.

## How it works

1. **Record.** The Web Speech API transcribes while MediaRecorder keeps the audio. Clips and transcripts go into IndexedDB. Transcripts can be edited.
2. **Features.** Audio is resampled to 16 kHz, trimmed, loudness-matched and turned into log-magnitude spectrograms (10 ms hop, 512-point FFT, 257 bins).
3. **Train.** A TensorFlow.js MLP maps a 7-letter window plus the position inside the current letter to one spectrogram frame. A second net predicts each letter's duration. Letters start evenly spread, then after 30 epochs monotonic alignment search re-aligns them using the model's own predictions.
4. **Speak.** Typed text, then predicted durations, then predicted spectrogram, then Fast Griffin-Lim, then audio (also downloadable as WAV).

Recording auto-trains 20 epochs; "Train continuously" keeps going until stopped. Models are saved in IndexedDB, so training resumes after a reload.
