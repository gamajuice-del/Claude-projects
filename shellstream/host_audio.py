"""Game audio for the game host: whatever the machine plays, captured from the default output's loopback (WASAPI
loopback on Windows, the PulseAudio monitor on Linux), encoded as 20 ms Opus packets (low-delay mode), and sent
over the same WebSocket.  The browser decodes them with WebCodecs and plays them through a short jitter buffer.

Audio isn't predicted and doesn't need to be: a sound that starts one round trip after the action that caused
it is what every online game already does.  What matters is that it never stutters, so the browser schedules
packets on its own clock and lets the buffer absorb network jitter.
"""
from __future__ import annotations

import threading
import time

import numpy as np


class AudioCapture:
    """Calls on_packet(opus_bytes, pts_samples) for every 20 ms of the machine's audio output."""

    def __init__(self, on_packet, rate=48000, channels=2, frame_ms=20, bitrate=128_000, speaker=None):
        import av
        import soundcard as sc
        spk = sc.get_speaker(speaker) if speaker else sc.default_speaker()
        self.mic = sc.get_microphone(id=str(spk.name), include_loopback=True)
        self.source = spk.name
        self.on_packet, self.rate, self.channels = on_packet, rate, channels
        self.n = rate * frame_ms // 1000
        enc = av.CodecContext.create("libopus", "w")
        enc.sample_rate, enc.layout, enc.format = rate, "stereo" if channels == 2 else "mono", "flt"
        enc.bit_rate = bitrate
        enc.options = {"application": "lowdelay", "frame_duration": str(frame_ms)}
        enc.open()
        self.av, self.enc = av, enc
        self.alive = True
        self.packets = 0
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        pts = 0
        try:
            with self.mic.recorder(samplerate=self.rate, channels=self.channels, blocksize=self.n) as rec:
                while self.alive:
                    data = rec.record(numframes=self.n).astype(np.float32)        # (n, channels)
                    if data.shape[0] == 0:
                        time.sleep(0.005)
                        continue
                    fr = self.av.AudioFrame.from_ndarray(np.ascontiguousarray(data.reshape(1, -1)), format="flt",
                                                         layout="stereo" if self.channels == 2 else "mono")
                    fr.sample_rate, fr.pts = self.rate, pts
                    pts += data.shape[0]
                    for p in self.enc.encode(fr):
                        self.packets += 1
                        self.on_packet(bytes(p), int(p.pts if p.pts is not None else pts))
        except Exception as e:                       # no audio device: the stream simply has no sound
            import traceback
            traceback.print_exc()
            self.error = repr(e)

    def stop(self):
        self.alive = False
        self.thread.join(timeout=1.0)            # let the recorder close cleanly (PulseAudio aborts otherwise)
