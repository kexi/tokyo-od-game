# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy>=2.0"]
# ///
"""Teaser soundtrack, synthesized from scratch (no samples, no third-party music).

City-pop-ish house at 120 bpm: four-on-the-floor kick, claps, hats, a filtered saw bass, a ii-V-I-vi
pad (Dm9 G13 Cmaj9 Am9) and a 16th-note arpeggio, arranged intro -> build -> drop -> break ->
drop -> outro over the requested length.

    uv run scripts/teaser/music.py <out.wav> <seconds>
"""

import sys
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def note(n: int) -> float:
    """MIDI note number -> Hz."""
    return 440.0 * 2 ** ((n - 69) / 12)


CHORDS = [  # (bass root, chord tones) - ii-V-I-vi in C
    (38, [62, 65, 69, 72, 76]),  # Dm9
    (43, [59, 64, 65, 69, 74]),  # G13
    (36, [60, 64, 67, 71, 74]),  # Cmaj9
    (45, [60, 64, 67, 69, 71]),  # Am9
]


def env(n: int, attack: float, release: float) -> np.ndarray:
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.exp(-t / max(release, 1e-4))
    return a * r


def saw(freq: float, n: int, detune: float = 0.0) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-detune, 0.0, detune):
        f = freq * (1 + d)
        out += 2 * ((t * f) % 1) - 1
    return out / 3


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def kick(n: int) -> np.ndarray:
    t = np.arange(n) / SR
    f = 50 + 110 * np.exp(-t * 28)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t * 7)


def clap(n: int) -> np.ndarray:
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    return lowpass(noise, 4000) * np.exp(-t * 22) * 0.6 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.3


def hat(n: int, *, open_: bool = False) -> np.ndarray:
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    hp = noise - lowpass(noise, 7000)
    return hp * np.exp(-t * (9 if open_ else 55)) * 0.35


def place(track: np.ndarray, sound: np.ndarray, at: float, gain: float) -> None:
    i = int(at * SR)
    if i >= len(track):
        return
    end = min(len(track), i + len(sound))
    track[i:end] += sound[: end - i] * gain


def render(seconds: float) -> np.ndarray:
    n = int(seconds * SR)
    mix = np.zeros(n)
    bars = int(np.ceil(seconds / BAR))

    # Sections by bar (fractions of the length so any duration keeps the shape).
    def section(bar: int) -> str:
        f = bar / bars
        if f < 0.12:
            return "intro"
        if f < 0.25:
            return "build"
        if f < 0.5:
            return "drop"
        if f < 0.6:
            return "break"
        if f < 0.9:
            return "drop2"
        return "outro"

    kick_s, clap_s, hat_s, ohat_s = (
        kick(int(0.45 * SR)),
        clap(int(0.3 * SR)),
        hat(int(0.08 * SR)),
        hat(int(0.3 * SR), open_=True),
    )
    for bar in range(bars):
        s = section(bar)
        t0 = bar * BAR
        root, tones = CHORDS[bar % 4]
        # Pad: detuned saws, soft attack, filtered darker in the break.
        pad_n = int(BAR * SR)
        pad = sum(saw(note(m), pad_n, 0.004) for m in tones) / len(tones)
        pad = lowpass(pad, 900 if s in ("break", "intro") else 2200) * env(pad_n, 0.35, 6.0)
        place(mix, pad, t0, 0.55 if s in ("intro", "break", "outro") else 0.3)
        for beat in range(4):
            tb = t0 + beat * BEAT
            if s in ("build", "drop", "drop2"):
                place(mix, kick_s, tb, 0.9)
            if s in ("drop", "drop2") and beat in (1, 3):
                place(mix, clap_s, tb, 0.55)
            if s != "outro":
                place(mix, hat_s, tb + BEAT / 2, 0.5)
            if s in ("drop", "drop2"):
                place(mix, ohat_s, tb + BEAT / 2, 0.18)
            # Bass: off-beat pumping eighths on the chord root.
            if s in ("build", "drop", "drop2"):
                bn = int(BEAT / 2 * SR)
                b = lowpass(saw(note(root), bn, 0.002), 380) * env(bn, 0.005, 0.18)
                place(mix, b, tb + BEAT / 2, 0.55)
                place(mix, b, tb, 0.35)
        # Arpeggio: 16ths over the chord, in the second drop and the break.
        if s in ("break", "drop2"):
            for k in range(16):
                m = tones[(k * 3) % len(tones)] + 12
                an = int(BEAT / 4 * SR)
                t = np.arange(an) / SR
                arp = (np.sin(2 * np.pi * note(m) * t) + 0.3 * np.sin(4 * np.pi * note(m) * t)) * env(an, 0.002, 0.09)
                place(mix, arp, t0 + k * BEAT / 4, 0.16)
        # Riser into each drop.
        if s == "build" and section(bar + 1) == "drop":
            rn = int(BAR * SR)
            t = np.arange(rn) / SR
            riser = rng.standard_normal(rn) * (t / BAR) ** 2
            place(mix, lowpass(riser, 3000), t0, 0.25)
    # Sidechain-style pump on the pad and bass: duck on every beat.
    t = np.arange(n) / SR
    pump = 0.55 + 0.45 * np.clip(((t % BEAT) / BEAT) * 3, 0, 1)
    mix *= pump
    # Fade in / out and normalise.
    fade = int(1.0 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)
    mix[-fade * 2 :] *= np.linspace(1, 0, fade * 2)
    return mix / (np.max(np.abs(mix)) + 1e-9) * 0.89


def main() -> None:
    out, seconds = sys.argv[1], float(sys.argv[2])
    mono = render(seconds)
    # A little stereo width: hats and arp slightly delayed on the right.
    right = np.concatenate([np.zeros(int(0.012 * SR)), mono])[: len(mono)]
    stereo = np.stack([mono, 0.85 * mono + 0.15 * right], axis=1)
    pcm = (stereo * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
