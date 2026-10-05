# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy>=2.0"]
# ///
"""The teaser's soundtrack: the synthesized music (music.py) with the game's own sounds over it.

    uv run scripts/teaser/mix.py <music.wav> <sfx.f32> <duck.json> <out.wav> [--sfx-db 0] [--music-db 0]

music.wav is music.py's 16-bit stereo; sfx.f32 the game's sounds laid on the cut by sound.mjs
(interleaved stereo float32, 44.1 kHz); duck.json the spans [[t0, t1] ...] where the music steps
back 6 dB for what is heard then (in 0.12 s, back over 0.5 s after). The game's sounds go through
a peak limiter of their own first (the seal's thud goes straight to the output in the game, two
at once reach +4 dBFS): its slam is kept short of the rest instead of pushing the music down with
it. Writes 16-bit stereo, kept under -1 dBFS sample peak; the loudness and the true peak are set
after, by sound.mjs. Also writes <out>.music.wav and <out>.sfx.wav, the two layers as mixed, to
measure them apart.
"""

import json
import sys
import wave

import numpy as np

SR = 44100
DUCK_DB = 6.0
ATTACK = 0.12
RELEASE = 0.5


def read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2 and w.getframerate() == SR, "16-bit 44.1 kHz expected"
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768
        return data.reshape(-1, w.getnchannels())


def write_wav(path: str, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def duck_curve(n: int, spans: list[list[float]]) -> np.ndarray:
    """How far the music is stepped back, 0-1, per sample: ramps in before a span, out after it."""
    t = np.arange(n) / SR
    d = np.zeros(n)
    for a, b in spans:
        attack = np.clip((t - (a - ATTACK)) / ATTACK, 0, 1)
        release = np.clip(1 - (t - b) / RELEASE, 0, 1)
        d = np.maximum(d, np.minimum(attack, release))
    return d


def limit(x: np.ndarray, ceiling_db: float, release: float = 0.08, block: int = 32) -> np.ndarray:
    """A look-ahead peak limiter: gain from the loudest of the next few blocks, back over `release` s."""
    ceiling = 10 ** (ceiling_db / 20)
    n = len(x)
    blocks = -(-n // block)
    padded = np.zeros((blocks * block, x.shape[1]))
    padded[:n] = x
    peaks = np.max(np.abs(padded).reshape(blocks, block, -1), axis=(1, 2))
    # Looking 4 blocks (2.9 ms) ahead, so the gain is down before the peak arrives.
    ahead = np.max(np.stack([np.roll(peaks, -k) for k in range(5)]), axis=0)
    need = np.minimum(1.0, ceiling / np.maximum(ahead, 1e-12))
    coeff = np.exp(-block / (release * SR))
    gain = np.empty(blocks)
    g = 1.0
    for i, v in enumerate(need):
        g = v if v < g else v + (g - v) * coeff
        gain[i] = g
    per_sample = np.interp(np.arange(blocks * block), np.arange(blocks) * block + block / 2, gain)[:n]
    return x * per_sample[:, None]


def main() -> None:
    music_path, sfx_path, duck_path, out = sys.argv[1:5]
    opts = dict(zip(sys.argv[5::2], sys.argv[6::2], strict=True))
    sfx_db = float(opts.get("--sfx-db", 0))
    music_db = float(opts.get("--music-db", 0))
    music = read_wav(music_path)
    if music.shape[1] == 1:
        music = np.repeat(music, 2, axis=1)
    sfx = np.fromfile(sfx_path, dtype="<f4").astype(np.float64).reshape(-1, 2)
    n = len(music)
    if len(sfx) < n:
        sfx = np.vstack([sfx, np.zeros((n - len(sfx), 2))])
    sfx = sfx[:n]
    with open(duck_path) as f:
        spans = json.load(f)
    duck = duck_curve(n, spans)
    music_gain = 10 ** ((music_db - DUCK_DB * duck) / 20)
    sfx = limit(sfx, -6.0)
    layers = (music * music_gain[:, None], sfx * 10 ** (sfx_db / 20))
    mix = layers[0] + layers[1]
    peak = float(np.max(np.abs(mix)))
    ceiling = 10 ** (-1 / 20)
    scale = min(1.0, ceiling / peak) if peak > 0 else 1.0
    write_wav(out, mix * scale)
    write_wav(out + ".music.wav", layers[0] * scale)
    write_wav(out + ".sfx.wav", layers[1] * scale)
    print(
        json.dumps(
            {
                "event": "mixed",
                "seconds": round(n / SR, 2),
                "peakDb": round(20 * np.log10(peak), 2) if peak > 0 else None,
                "scaledDb": round(20 * np.log10(scale), 2),
                "duckedSeconds": round(float(np.sum(duck > 0.5)) / SR, 2),
            }
        )
    )


if __name__ == "__main__":
    main()
