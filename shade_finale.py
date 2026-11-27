#!/usr/bin/env python3
"""
shade_finale.py - a two-minute final-battle arrangement of the Shade melody
from Hollow Knight (composed by Christopher Larkin), for the Void Vigil piece.

The melody is taken as written in the artist's sheet music (3/4, one flat):
three eight-bar phrases, the middle one in octaves, the last one darker and
ending on C.  Around it this program writes harmony, a battle ostinato,
timpani, brass, choir and percussion, in eight sections:

  1  The Abyss       a glockenspiel alone over a low drone, as in the original
  2  Awakening       strings and choir take the melody, the timpani stir
  3  The Fight       tempo doubles: driving strings, horns sing the theme
  4  Her Shadow      the dark phrase, carried by the choir, brass beneath
  5  Turn            the music climbs a semitone
  6  Radiance Falls  the whole orchestra on the theme
  7  Last Stand      the theme broadened, one enormous final chord
  8  Silence         the glockenspiel again, alone, fading

Writes a MIDI file, then renders it with FluidSynth and a General MIDI
soundfont, and (with --video) pairs it with the Void Vigil animation.

Usage:  python3 shade_finale.py [--video]
Needs:  fluidsynth, a GM soundfont (FluidR3_GM.sf2), ffmpeg, python mido
"""
import os
import subprocess
import sys

import mido

SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
TPB = 480                       # ticks per beat

# --- the melody, from the sheet music --------------------------------------------
# MIDI note numbers (C4 = 60); each bar is a list of (pitch, beats).
F4, A4, G4, Eb4, B4, C5, Cs4 = 65, 69, 67, 63, 71, 72, 61
Eb5, D5, Gb4, G3, D4, Gb3, Fs4, Ab3, B3, Bb4, C4 = 75, 74, 66, 55, 62, 54, 66, 56, 59, 70, 60

PHRASE_A = [  # bars 1-8 (and 9-16, played in octaves)
    [(F4, 1), (A4, 1), (G4, 1)],
    [(Eb4, 1), (B4, 1), (C5, 1)],
    [(F4, 1), (A4, 1), (G4, 1)],
    [(Cs4, 3)],
    [(F4, 1), (A4, 1), (G4, 1)],
    [(Eb4, 1), (B4, 1), (C5, 1)],
    [(G4, 1), (Eb5, 1), (D5, 1)],
    [(Gb4, 3)],
]
PHRASE_B = [  # bars 17-24
    [(G3, 1), (Eb4, 1), (D4, 1)],
    [(Gb3, 1), (Fs4, 1), (G4, 1)],
    [(G3, 1), (Eb4, 1), (D4, 1)],
    [(Gb3, 3)],
    [(G3, 1), (Eb4, 1), (D4, 1)],
    [(Ab3, 1), (Fs4, 1), (G4, 1)],
    [(B3, 1), (Bb4, 1), (A4, 1)],
    [(C4, 3)],
]

# --- harmony, one chord per bar ---------------------------------------------------
# (bass pitch class, chord pitch classes)
D, Eb, E, F, Gb, G, Ab, A, Bb, B, C, Cs = 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1
CH = {
    'Dm': (D, [D, F, A]),
    'CmM7': (C, [C, Eb, G, B]),
    'A7': (A, [A, Cs, E, G]),
    'EbM7': (Eb, [Eb, G, Bb, D]),
    'Ebm': (Eb, [Eb, Gb, Bb]),
    'Gm': (G, [G, Bb, D]),
    'D/F#': (Gb, [D, Gb, A, C]),
    'Ab7': (Ab, [Ab, C, Eb, Gb]),      # a German sixth, falling to G
    'G7': (G, [G, B, D, F]),
    'C5': (C, [C, G]),
}
HARM_A = ['Dm', 'CmM7', 'Dm', 'A7', 'Dm', 'CmM7', 'EbM7', 'Ebm']
HARM_B = ['Gm', 'D/F#', 'Gm', 'D/F#', 'Gm', 'Ab7', 'G7', 'C5']

# --- instruments (General MIDI programs) and their channels -------------------------
CHANNELS = {
    'glock': (0, 9), 'strings': (1, 48), 'ostinato': (2, 48), 'choir': (3, 52),
    'horns': (4, 60), 'trombones': (5, 57), 'timpani': (6, 47), 'violins': (7, 40),
    'basses': (8, 43), 'drums': (9, None), 'piano': (10, 0), 'tremolo': (11, 44),
    'trumpets': (12, 56), 'tuba': (13, 58), 'oohs': (14, 53), 'celesta': (15, 8),
}
KICK, SNARE, TOM_LO, TOM_MID, TOM_HI, CRASH, CRASH2, CHINA = 35, 38, 41, 45, 48, 49, 57, 52


class Score:
    def __init__(self):
        self.notes = []          # (channel, start beat, beats, pitch, velocity)
        self.ccs = []            # (channel, beat, controller, value)
        self.tempi = []          # (beat, bpm)
        self.beat = 0.0          # where the next bar starts

    def note(self, inst, start, dur, pitch, vel):
        ch = CHANNELS[inst][0]
        vel = max(1, min(127, int(vel)))
        self.notes.append((ch, start, dur, int(pitch), vel))

    def swell(self, inst, start, beats, v0, v1, steps=24):
        ch = CHANNELS[inst][0]
        for k in range(steps + 1):
            self.ccs.append((ch, start + beats * k / steps, 11, int(v0 + (v1 - v0) * k / steps)))

    def tempo(self, bpm, at=None):
        self.tempi.append((self.beat if at is None else at, bpm))

    def seconds(self):
        t, last_b, bpm = 0.0, 0.0, 120
        for b, new in sorted(self.tempi):
            t += (b - last_b) * 60 / bpm
            last_b, bpm = b, new
        end = max(s + d for _, s, d, _, _ in self.notes)
        return t + (end - last_b) * 60 / bpm

    def write(self, path):
        mid = mido.MidiFile(ticks_per_beat=TPB)
        meta = mido.MidiTrack()
        mid.tracks.append(meta)
        meta.append(mido.MetaMessage('time_signature', numerator=3, denominator=4))
        ev = [(int(b * TPB), mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(bpm)))
              for b, bpm in sorted(self.tempi)]
        last = 0
        for t, m in ev:
            m.time = t - last
            last = t
            meta.append(m)
        for name, (ch, prog) in CHANNELS.items():
            tr = mido.MidiTrack()
            mid.tracks.append(tr)
            tr.append(mido.MetaMessage('track_name', name=name))
            evs = []
            if prog is not None:
                evs.append((0, 0, mido.Message('program_change', channel=ch, program=prog)))
            evs.append((0, 0, mido.Message('control_change', channel=ch, control=91, value=100)))
            evs.append((0, 0, mido.Message('control_change', channel=ch, control=93, value=30)))
            evs.append((0, 0, mido.Message('control_change', channel=ch, control=7, value=110)))
            for c, b, cc, v in self.ccs:
                if c == ch:
                    evs.append((int(b * TPB), 1, mido.Message('control_change', channel=ch,
                                                              control=cc, value=v)))
            for c, s, d, p, v in self.notes:
                if c == ch:
                    evs.append((int(s * TPB), 2, mido.Message('note_on', channel=ch, note=p,
                                                              velocity=v)))
                    evs.append((int((s + d) * TPB) - 1, 0, mido.Message('note_off', channel=ch,
                                                                       note=p, velocity=0)))
            evs.sort(key=lambda e: (e[0], e[1]))
            last = 0
            for t, _, m in evs:
                m.time = max(0, t - last)
                last = max(last, t)
                tr.append(m)
        mid.save(path)


# --- writing helpers ------------------------------------------------------------------
def voice(chord, lo, hi, tr=0):
    _, pcs = CH[chord]
    return [p for p in range(lo, hi + 1) if (p - tr) % 12 in pcs]


def bass_of(chord, octave_lo, tr=0):
    pc = (CH[chord][0] + tr) % 12
    p = octave_lo
    while p % 12 != pc:
        p += 1
    return p


def melody(sc, inst, bars, start, vel, shift=0, legato=0.95, tr=0, accent=0):
    b = start
    for bar in bars:
        for k, (p, d) in enumerate(bar):
            sc.note(inst, b, d * legato, p + shift + tr, vel + (accent if k == 0 else 0))
            b += d
    return b


def chords(sc, inst, harm, start, vel, lo, hi, tr=0, dur=3.0, stab=False):
    for i, c in enumerate(harm):
        b = start + 3 * i
        for p in voice(c, lo, hi, tr):
            if stab:
                sc.note(inst, b, 0.7, p, vel)
                sc.note(inst, b + 2, 0.45, p, vel - 18)
            else:
                sc.note(inst, b, dur * 0.98, p, vel)


def bassline(sc, inst, harm, start, vel, octave_lo=36, tr=0):
    for i, c in enumerate(harm):
        sc.note(inst, start + 3 * i, 2.95, bass_of(c, octave_lo, tr), vel)


def ostinato(sc, harm, start, vel, tr=0, piano=True):
    """Driving eighth notes: root, root, fifth, root, octave, fifth."""
    for i, c in enumerate(harm):
        root = bass_of(c, 38, tr)
        fifth = root + 7
        pat = [root, root, fifth, root, root + 12, fifth]
        for k, p in enumerate(pat):
            b = start + 3 * i + k * 0.5
            acc = 18 if k in (0, 3) else 0
            sc.note('ostinato', b, 0.42, p, vel + acc)
            if piano:
                sc.note('piano', b, 0.4, p - 12, vel - 20 + acc)


def timpani(sc, harm, start, vel, tr=0, roll_every=4):
    for i, c in enumerate(harm):
        b = start + 3 * i
        root = bass_of(c, 33, tr)
        if roll_every and i % roll_every == roll_every - 1:
            for k in range(12):                          # crescendo roll
                sc.note('timpani', b + k * 0.25, 0.25, root, vel - 30 + k * 4)
        else:
            sc.note('timpani', b, 1.0, root, vel + 10)
            sc.note('timpani', b + 1.5, 0.5, root + 7 if root + 7 < 53 else root - 5, vel - 15)
            sc.note('timpani', b + 2, 1.0, root, vel)


def drums(sc, bars, start, vel, crash_every=4, fill_last=True):
    for i in range(bars):
        b = start + 3 * i
        sc.note('drums', b, 0.5, KICK, vel + 10)
        sc.note('drums', b + 2, 0.5, KICK, vel - 10)
        sc.note('drums', b + 1, 0.3, SNARE, vel - 35)
        if crash_every and i % crash_every == 0:
            sc.note('drums', b, 2.0, CRASH, vel)
        if fill_last and i == bars - 1:
            for k, t in enumerate((TOM_HI, TOM_HI, TOM_MID, TOM_MID, TOM_LO, TOM_LO)):
                sc.note('drums', b + 1.5 + k * 0.25, 0.25, t, vel - 10 + k * 5)


def roll(sc, start, beats, v0, v1, pitch=SNARE):
    n = int(beats * 4)
    for k in range(n):
        sc.note('drums', start + k * 0.25, 0.25, pitch, v0 + (v1 - v0) * k / max(n - 1, 1))


# --- the arrangement -----------------------------------------------------------------
def arrange():
    sc = Score()
    A, B = PHRASE_A, PHRASE_B
    HA, HB = HARM_A, HARM_B

    # 1  The Abyss: glockenspiel alone over a drone, the oohs creep in
    s = sc.beat
    sc.tempo(72)
    sc.note('basses', s, 24 - 0.1, 38, 60)
    sc.note('tremolo', s, 24 - 0.1, 50, 34)
    sc.note('tremolo', s, 24 - 0.1, 57, 30)
    sc.swell('tremolo', s, 24, 40, 90)
    melody(sc, 'glock', A, s, 92)
    melody(sc, 'celesta', A[4:], s + 12, 48, shift=-12)
    chords(sc, 'oohs', HA[4:], s + 12, 52, 50, 64)
    sc.swell('oohs', s + 12, 12, 50, 100)
    sc.note('timpani', s + 21, 3, 38, 40)
    sc.beat += 24

    # 2  Awakening: strings and choir take the melody, timpani stir
    s = sc.beat
    sc.tempo(90)
    melody(sc, 'strings', A, s, 84)
    melody(sc, 'strings', A, s, 72, shift=-12)
    melody(sc, 'glock', A, s, 62, shift=12)
    chords(sc, 'choir', HA, s, 62, 50, 62)
    sc.swell('choir', s, 24, 60, 110)
    bassline(sc, 'basses', HA, s, 72)
    for i in range(8):
        sc.note('timpani', s + 3 * i, 1, bass_of(HA[i], 33), 54 + i * 5)
    for k in range(12):
        sc.note('timpani', s + 21 + k * 0.25, 0.25, 38, 50 + k * 6)
    roll(sc, s + 18, 6, 20, 100)
    sc.note('drums', s + 23.5, 0.5, KICK, 110)
    sc.beat += 24

    # 3  The Fight: tempo doubles, horns on the theme, the ostinato drives
    s = sc.beat
    sc.tempo(150)
    H16 = HA + HA
    ostinato(sc, H16, s, 78)
    bassline(sc, 'basses', H16, s, 92)
    timpani(sc, H16, s, 96)
    drums(sc, 16, s, 100)
    melody(sc, 'horns', A, s, 104, accent=6)
    melody(sc, 'horns', A, s, 92, shift=-12, accent=6)
    chords(sc, 'choir', HA, s, 70, 55, 67)
    chords(sc, 'trombones', HA, s, 84, 43, 55, stab=True)
    # second time: trumpets and violins an octave up, horns hold chords
    melody(sc, 'trumpets', A, s + 24, 100, accent=8)
    melody(sc, 'violins', A, s + 24, 96, shift=12)
    melody(sc, 'strings', A, s + 24, 90)
    chords(sc, 'horns', HA, s + 24, 80, 53, 65)
    chords(sc, 'choir', HA, s + 24, 84, 55, 72)
    chords(sc, 'trombones', HA, s + 24, 92, 43, 55, stab=True)
    bassline(sc, 'tuba', H16[8:], s + 24, 90, octave_lo=29)
    sc.beat += 48

    # 4  Her Shadow: the dark phrase, sung by the choir, brass beneath
    s = sc.beat
    HB2 = HB + HB
    ostinato(sc, HB2, s, 82)
    bassline(sc, 'basses', HB2, s, 96)
    bassline(sc, 'tuba', HB2, s, 92, octave_lo=29)
    timpani(sc, HB2, s, 100)
    drums(sc, 16, s, 104)
    melody(sc, 'choir', B, s, 108, shift=12)
    melody(sc, 'choir', B, s, 100)
    chords(sc, 'strings', HB, s, 70, 50, 64)
    chords(sc, 'trombones', HB, s, 88, 41, 55, stab=True)
    # again, with the brass on the theme in octaves
    melody(sc, 'horns', B, s + 24, 112, shift=12, accent=6)
    melody(sc, 'trombones', B, s + 24, 106, accent=6)
    melody(sc, 'trumpets', B, s + 24, 104, shift=12, accent=8)
    melody(sc, 'violins', B, s + 24, 100, shift=24)
    chords(sc, 'choir', HB, s + 24, 96, 55, 72)
    for i in range(0, 8, 2):
        sc.note('drums', s + 24 + 3 * i, 2, CHINA, 96)
    sc.beat += 48

    # 5  Turn: everything drops to the pounding beat, then lifts a semitone
    s = sc.beat
    turn = ['Ebm', 'Ebm', 'Ebm', 'Ebm']
    ostinato(sc, turn, s, 84, piano=True)
    for i in range(4):
        for k in range(6):
            sc.note('timpani', s + 3 * i + k * 0.5, 0.5, 39 if k % 3 else 34, 70 + i * 10 + k * 3)
    chords(sc, 'choir', turn, s, 80, 51, 66)
    sc.swell('choir', s, 12, 60, 127)
    roll(sc, s + 6, 6, 30, 127)
    sc.note('drums', s + 11.5, 0.5, KICK, 127)
    sc.beat += 12

    # 6  Radiance Falls: the whole orchestra on the theme, a semitone higher
    s = sc.beat
    T = 1
    HAB = HA + HB
    ostinato(sc, HAB, s, 90, tr=T)
    bassline(sc, 'basses', HAB, s, 104, tr=T)
    bassline(sc, 'tuba', HAB, s, 100, octave_lo=29, tr=T)
    timpani(sc, HAB, s, 110, tr=T)
    drums(sc, 16, s, 112, crash_every=2)
    full = A + B
    melody(sc, 'horns', full, s, 118, tr=T, accent=6)
    melody(sc, 'horns', full, s, 108, shift=-12, tr=T)
    melody(sc, 'trumpets', full, s, 112, shift=12, tr=T, accent=8)
    melody(sc, 'violins', full, s, 110, shift=12, tr=T)
    melody(sc, 'strings', full, s, 104, tr=T)
    melody(sc, 'choir', full, s, 112, shift=12, tr=T)
    melody(sc, 'glock', full, s, 90, shift=12, tr=T)
    chords(sc, 'trombones', HAB, s, 100, 41, 56, tr=T, stab=True)
    chords(sc, 'oohs', HAB, s, 84, 53, 67, tr=T)
    sc.beat += 48

    # 7  Last Stand: the opening broadened, then one enormous chord
    s = sc.beat
    sc.tempo(96)
    four = A[:4]
    h4 = HA[:4]
    for inst, sh, v in (('horns', 0, 120), ('horns', -12, 110), ('trumpets', 12, 116),
                        ('violins', 12, 112), ('strings', 0, 108), ('choir', 12, 116),
                        ('trombones', -12, 110)):
        melody(sc, inst, four, s, v, shift=sh, tr=T, legato=0.98)
    chords(sc, 'oohs', h4, s, 90, 53, 67, tr=T)
    bassline(sc, 'basses', h4, s, 110, tr=T)
    bassline(sc, 'tuba', h4, s, 106, octave_lo=29, tr=T)
    for i, c in enumerate(h4):
        sc.note('timpani', s + 3 * i, 1, bass_of(c, 33, T), 120)
        sc.note('drums', s + 3 * i, 2, CRASH if i % 2 == 0 else CRASH2, 110)
        sc.note('drums', s + 3 * i, 0.5, KICK, 120)
    for k in range(12):
        sc.note('timpani', s + 9 + k * 0.25, 0.25, bass_of('A7', 33, T), 80 + k * 4)
    # the final chord: E-flat minor, everything, held and let ring
    end = s + 12
    sc.tempo(80, at=end)
    final = 'Dm'
    for inst, lo, hi, v in (('choir', 51, 75, 120), ('oohs', 51, 70, 100),
                            ('strings', 39, 75, 112), ('horns', 46, 70, 116),
                            ('trombones', 34, 58, 112), ('trumpets', 63, 78, 110),
                            ('violins', 63, 87, 108)):
        for p in voice(final, lo, hi, T):
            sc.note(inst, end, 6, p, v)
    sc.note('basses', end, 6, bass_of(final, 26, T), 120)
    sc.note('tuba', end, 6, bass_of(final, 26, T), 116)
    for k in range(20):
        sc.note('timpani', end + k * 0.25, 0.25, bass_of(final, 33, T), 70 + k * 2)
    sc.note('timpani', end + 5, 1, bass_of(final, 33, T), 127)
    sc.note('drums', end, 4, CRASH, 127)
    sc.note('drums', end, 4, CRASH2, 120)
    sc.note('drums', end, 1, KICK, 127)
    sc.note('drums', end + 5, 3, CHINA, 120)
    sc.beat = end + 6

    # 8  Silence: the glockenspiel, alone again, back home, fading
    s = sc.beat + 1
    sc.tempo(60, at=s - 1)
    sc.note('oohs', s - 1, 7, 50, 40)
    sc.note('oohs', s - 1, 7, 57, 36)
    sc.swell('oohs', s - 1, 7, 80, 10)
    b = melody(sc, 'glock', A[:2], s, 70)
    sc.note('glock', b, 3, Cs4, 46)
    sc.note('glock', b, 3, Cs4 - 12, 30)
    sc.beat = b + 3
    return sc


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    mid_path = os.path.join(here, 'shade_finale.mid')
    wav_path = os.path.join(here, 'shade_finale.wav')
    mp3_path = os.path.join(here, 'shade_finale.mp3')
    sc = arrange()
    sc.write(mid_path)
    print('length %.1f s' % sc.seconds())
    subprocess.run(['fluidsynth', '-ni', '-g', '0.16', '-r', '44100',
                    '-o', 'synth.reverb.room-size=0.85', '-o', 'synth.reverb.width=1.0',
                    '-o', 'synth.reverb.level=0.75', '-o', 'synth.reverb.damp=0.3',
                    '-F', wav_path, SF2, mid_path], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # one overall gain (keeping the quiet-to-epic arc), a low shelf for weight,
    # a limiter to catch the loudest hits, and a fade on the last ring
    probe = subprocess.run(['ffmpeg', '-i', wav_path, '-af', 'volumedetect', '-f', 'null', '-'],
                           capture_output=True, text=True).stderr
    peak = float(probe.split('max_volume:')[1].split('dB')[0])
    total = sc.seconds() + 3.5
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path, '-af',
                    'volume=%.2fdB,bass=g=3:f=90,alimiter=limit=0.89:attack=5:release=80,'
                    'afade=t=out:st=%.2f:d=3' % (-1.0 - peak + 4.0, total - 3),
                    '-t', '%.2f' % total, '-b:a', '256k', mp3_path], check=True)
    print('wrote', mid_path, mp3_path)
    if '--video' in sys.argv:
        gif = os.path.join(here, 'void_vigil_x4.gif')
        mp4 = os.path.join(here, 'void_vigil_finale.mp4')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-stream_loop', '-1',
                        '-i', gif, '-i', mp3_path, '-shortest',
                        '-vf', 'scale=1024:1024:flags=neighbor,fps=30',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
                        '-c:a', 'aac', '-b:a', '256k', mp4], check=True)
        print('wrote', mp4)


if __name__ == '__main__':
    main()
