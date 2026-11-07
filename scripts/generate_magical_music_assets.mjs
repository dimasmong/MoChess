import fs from 'node:fs';
import path from 'node:path';

/**
 * MoChess — Wizard Chess: Arcane Kingdom
 * Original Magical Fantasy Music Synthesis & Rendering Pipeline
 *
 * Generates 5 distinct, seamless-looping original fantasy compositions as 16-bit PCM WAV files:
 * 1. menu_arcane_kingdom.wav         — Main Menu: Arcane Kingdom Theme (Ethereal Choir, Strings, Harp, Celesta Motif)
 * 2. cathedral_sacred_arcana.wav     — Gothic Cathedral: Sacred Arcana (Sacred Choir, Low Strings, Medieval Bells, Woodwind)
 * 3. warhall_crown_of_kingdom.wav    — Royal War Hall: Crown of the Kingdom (Cinematic Strings, Warm Brass, Harp, Ceremonial Percussion)
 * 4. sanctum_celestial_enchantment.wav — Arcane Sanctum: Celestial Enchantment (Celesta, Magical Bells, Shimmering Pads, Harp Arpeggios)
 * 5. classic_timeless_strategy.wav   — Classic Board: Timeless Strategy (Gentle Grand Piano, Soft Chamber Strings, Harp, Subtle Bell Undertones)
 */

const SAMPLE_RATE = 22050;
const OUT_DIR = path.resolve(process.cwd(), 'public', 'audio', 'music');

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Smooth ADSR with exponential release
function envelope(t, duration, attack, decay, sustain, release) {
  if (t < 0 || t >= duration) return 0;
  if (t < attack) {
    return Math.pow(t / Math.max(0.001, attack), 0.85);
  }
  const afterAttack = t - attack;
  if (afterAttack < decay) {
    const p = afterAttack / Math.max(0.001, decay);
    return 1.0 - (1.0 - sustain) * p;
  }
  const relStart = duration - release;
  if (t < relStart) {
    return sustain;
  }
  const relP = (t - relStart) / Math.max(0.001, release);
  return sustain * Math.pow(1.0 - Math.min(1, relP), 2.0);
}

// Instrument 1: Ethereal Choir Pad (detuned harmonic ensemble with vowel formant shaping)
function synthChoirSample(freq, t, dur, phaseSeed = 0) {
  const env = envelope(t, dur, Math.min(1.4, dur * 0.28), 0.6, 0.82, Math.min(1.6, dur * 0.32));
  if (env <= 0) return 0;
  const vib = Math.sin(2 * Math.PI * 4.6 * t + phaseSeed) * 0.0032;
  const f = freq * (1 + vib);
  const w1 = 2 * Math.PI * f * t;
  const w2 = 2 * Math.PI * f * 1.004 * t + 1.1;
  const w3 = 2 * Math.PI * f * 0.996 * t + 2.4;

  // Soft vowel harmonic weights ("Ah" / "Oh" sacred choir timbre)
  const fundamental = (Math.sin(w1) + Math.sin(w2) + Math.sin(w3)) * 0.33;
  const h2 = (Math.sin(w1 * 2) + Math.sin(w2 * 2)) * 0.18;
  const h3 = Math.sin(w1 * 3 + 0.5) * 0.11;
  const h4 = Math.sin(w3 * 4 + 1.2) * 0.05;
  const breath = Math.sin(w1 * 7.01) * 0.012 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.1 * t));
  return (fundamental + h2 + h3 + h4 + breath) * env;
}

// Instrument 2: Warm Bowed Orchestral Strings (rosined bow attack + warm ensemble harmonics)
function synthStringsSample(freq, t, dur, phaseSeed = 0) {
  const env = envelope(t, dur, Math.min(0.95, dur * 0.24), 0.5, 0.78, Math.min(1.2, dur * 0.28));
  if (env <= 0) return 0;
  const vibDepth = Math.min(1, t / 0.45) * 0.0042;
  const vib = Math.sin(2 * Math.PI * 5.4 * t + phaseSeed) * vibDepth;
  const f = freq * (1 + vib);

  let sum = 0;
  const detunes = [0.9965, 1.0, 1.0038];
  for (let d = 0; d < detunes.length; d++) {
    const fd = f * detunes[d];
    const p = phaseSeed + d * 1.7;
    // Warm band-limited sawtooth approximation (first 6 harmonics with 1/n^1.35 roll-off)
    for (let h = 1; h <= 6; h++) {
      if (fd * h < SAMPLE_RATE * 0.42) {
        sum += (Math.sin(2 * Math.PI * fd * h * t + p) / Math.pow(h, 1.38)) * (h % 2 === 0 ? -0.85 : 1.0);
      }
    }
  }
  return (sum / 3.2) * env;
}

// Instrument 3: Concert Harp Pluck (damped rich harmonics with warm wooden body resonance)
function synthHarpSample(freq, t, dur) {
  if (t < 0 || t >= dur) return 0;
  const attack = 0.012;
  const env = t < attack ? t / attack : Math.exp(-t * 2.35) * Math.max(0, 1 - t / dur);
  const w = 2 * Math.PI * freq * t;
  const h1 = Math.sin(w);
  const h2 = Math.sin(w * 2 + 0.3) * 0.42 * Math.exp(-t * 3.8);
  const h3 = Math.sin(w * 3 + 0.8) * 0.21 * Math.exp(-t * 5.5);
  const h4 = Math.sin(w * 4 + 1.4) * 0.09 * Math.exp(-t * 8.0);
  return (h1 + h2 + h3 + h4) * env * 0.72;
}

// Instrument 4: Celesta & Magical Bell (FM crystalline bell with warm fundamental & shimmering overtone)
function synthCelestaSample(freq, t, dur, belliness = 1.0) {
  if (t < 0 || t >= dur) return 0;
  const attack = 0.008;
  const bodyEnv = t < attack ? t / attack : Math.exp(-t * 2.6) * Math.max(0, 1 - t / dur);
  const tineEnv = t < attack ? t / attack : Math.exp(-t * 6.8);
  const modFreq = freq * 3.0; // Pure 3:1 celesta bell harmonic ratio
  const modIndex = 0.85 * belliness * tineEnv;
  const mod = Math.sin(2 * Math.PI * modFreq * t) * modIndex;
  const carrier = Math.sin(2 * Math.PI * freq * t + mod);
  const octaveShimmer = Math.sin(2 * Math.PI * freq * 2.0 * t + 0.4) * 0.24 * Math.exp(-t * 4.2);
  return (carrier * 0.78 + octaveShimmer) * bodyEnv * 0.68;
}

// Instrument 5: Mystical Woodwind / Sanctuary Flute (breathy pipe with delayed vibrato)
function synthWoodwindSample(freq, t, dur) {
  const env = envelope(t, dur, 0.18, 0.25, 0.82, 0.35);
  if (env <= 0) return 0;
  const vib = Math.min(1, Math.max(0, (t - 0.15) / 0.35)) * Math.sin(2 * Math.PI * 5.1 * t) * 0.0045;
  const w = 2 * Math.PI * freq * (1 + vib) * t;
  const h1 = Math.sin(w) * 0.75;
  const h2 = Math.sin(w * 2 + 0.4) * 0.14;
  const h3 = Math.sin(w * 3 + 0.9) * 0.22; // Odd-harmonic woody character
  return (h1 + h2 + h3) * env * 0.62;
}

// Instrument 6: Warm French Horn / Noble Brass
function synthBrassSample(freq, t, dur) {
  const env = envelope(t, dur, 0.22, 0.35, 0.78, 0.45);
  if (env <= 0) return 0;
  const swell = envelope(t, dur, Math.min(0.55, dur * 0.4), 0.3, 0.85, 0.4);
  const w = 2 * Math.PI * freq * t;
  const h1 = Math.sin(w) * 0.55;
  const h2 = Math.sin(w * 2) * 0.38 * swell;
  const h3 = Math.sin(w * 3) * 0.24 * swell;
  const h4 = Math.sin(w * 4) * 0.12 * swell;
  const h5 = Math.sin(w * 5) * 0.06 * swell;
  return (h1 + h2 + h3 + h4 + h5) * env * 0.58;
}

// Instrument 7: Felt Grand Piano (multi-harmonic velocity hammer decay)
function synthPianoSample(freq, t, dur) {
  if (t < 0 || t >= dur) return 0;
  const attack = 0.01;
  const env = t < attack ? t / attack : Math.exp(-t * 1.95) * Math.max(0, 1 - t / dur);
  const hammerEnv = Math.exp(-t * 9.5);
  const w = 2 * Math.PI * freq * t;
  const h1 = Math.sin(w) * 0.68;
  const h2 = Math.sin(w * 2.0005 + 0.2) * 0.32 * (0.6 + 0.4 * hammerEnv);
  const h3 = Math.sin(w * 3.0015 + 0.5) * 0.14 * hammerEnv;
  const h4 = Math.sin(w * 4.003 + 1.1) * 0.06 * hammerEnv;
  return (h1 + h2 + h3 + h4) * env * 0.66;
}

// Instrument 8: Ceremonial Timpani / Deep Frame Drum
function synthTimpaniSample(freq, t, dur) {
  if (t < 0 || t >= dur) return 0;
  const env = t < 0.008 ? t / 0.008 : Math.exp(-t * 4.2);
  const pitchDrop = freq * (1 + 0.28 * Math.exp(-t * 18.0));
  const w = 2 * Math.PI * pitchDrop * t;
  return (Math.sin(w) * 0.8 + Math.sin(w * 1.52) * 0.2 * Math.exp(-t * 8.0)) * env * 0.65;
}

/**
 * Renders a note event list into a seamless-looping buffer with Schroeder Cathedral Reverb.
 */
function renderCompositionToWav(durationSec, events, reverbWet = 0.36) {
  const numSamples = Math.floor(durationSec * SAMPLE_RATE);
  // Render extra 2.5 seconds of tail so we can wrap the reverb tail into the beginning for a 100% seamless loop
  const tailSec = 2.5;
  const totalSamples = Math.floor((durationSec + tailSec) * SAMPLE_RATE);
  const dryBuf = new Float32Array(totalSamples);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const startSample = Math.max(0, Math.floor(ev.start * SAMPLE_RATE));
    const endSample = Math.min(totalSamples, Math.floor((ev.start + ev.dur) * SAMPLE_RATE));
    const freq = midiToHz(ev.midi);
    const gain = ev.gain ?? 0.2;
    const seed = (i * 1.618) % 6.28;

    for (let s = startSample; s < endSample; s++) {
      const localT = (s - startSample) / SAMPLE_RATE;
      let val = 0;
      switch (ev.inst) {
        case 'choir':
          val = synthChoirSample(freq, localT, ev.dur, seed);
          break;
        case 'strings':
          val = synthStringsSample(freq, localT, ev.dur, seed);
          break;
        case 'harp':
          val = synthHarpSample(freq, localT, ev.dur);
          break;
        case 'celesta':
          val = synthCelestaSample(freq, localT, ev.dur, 1.0);
          break;
        case 'bell':
          val = synthCelestaSample(freq, localT, ev.dur, 1.65);
          break;
        case 'woodwind':
          val = synthWoodwindSample(freq, localT, ev.dur);
          break;
        case 'brass':
          val = synthBrassSample(freq, localT, ev.dur);
          break;
        case 'piano':
          val = synthPianoSample(freq, localT, ev.dur);
          break;
        case 'timpani':
          val = synthTimpaniSample(freq, localT, ev.dur);
          break;
      }
      dryBuf[s] += val * gain;
    }
  }

  // Apply 4 parallel Comb Filters + 2 series Allpass Filters (Cathedral Reverb)
  const combDelays = [
    Math.floor(0.0297 * SAMPLE_RATE),
    Math.floor(0.0371 * SAMPLE_RATE),
    Math.floor(0.0411 * SAMPLE_RATE),
    Math.floor(0.0437 * SAMPLE_RATE)
  ];
  const combGains = [0.76, 0.73, 0.71, 0.69];
  const wetBuf = new Float32Array(totalSamples);

  for (let c = 0; c < combDelays.length; c++) {
    const delay = combDelays[c];
    const fb = combGains[c];
    const line = new Float32Array(delay);
    let idx = 0;
    let lpState = 0;
    for (let s = 0; s < totalSamples; s++) {
      const delayed = line[idx];
      lpState = lpState * 0.42 + delayed * 0.58; // Warm high-frequency damping in cathedral stone
      line[idx] = dryBuf[s] + lpState * fb;
      idx = (idx + 1) % delay;
      wetBuf[s] += delayed * 0.25;
    }
  }

  // Series allpass diffusers
  const allpassDelays = [Math.floor(0.005 * SAMPLE_RATE), Math.floor(0.0017 * SAMPLE_RATE)];
  for (const apDelay of allpassDelays) {
    const apLine = new Float32Array(apDelay);
    let apIdx = 0;
    const g = 0.5;
    for (let s = 0; s < totalSamples; s++) {
      const bufOut = apLine[apIdx];
      const input = wetBuf[s];
      apLine[apIdx] = input + bufOut * g;
      wetBuf[s] = bufOut - input * g;
      apIdx = (apIdx + 1) % apDelay;
    }
  }

  // Combine dry + wet and fold the tail into the start of the loop for seamless looping
  const loopBuf = new Float32Array(numSamples);
  for (let s = 0; s < totalSamples; s++) {
    const mixed = dryBuf[s] * (1 - reverbWet * 0.45) + wetBuf[s] * reverbWet;
    if (s < numSamples) {
      loopBuf[s] += mixed;
    } else {
      const wrapIdx = s - numSamples;
      const tailFade = 1.0 - wrapIdx / (totalSamples - numSamples);
      loopBuf[wrapIdx] += mixed * tailFade;
    }
  }

  // Normalize peak to -1.5 dBFS (0.84) with soft-knee limiting
  let maxAbs = 0.001;
  for (let s = 0; s < numSamples; s++) {
    const a = Math.abs(loopBuf[s]);
    if (a > maxAbs) maxAbs = a;
  }
  const normScale = 0.84 / maxAbs;

  // Encode 16-bit PCM Mono WAV
  const dataBytes = numSamples * 2;
  const wavBuffer = Buffer.alloc(44 + dataBytes);
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataBytes, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); // PCM chunk size
  wavBuffer.writeUInt16LE(1, 20);  // AudioFormat = 1 (PCM)
  wavBuffer.writeUInt16LE(1, 22);  // NumChannels = 1
  wavBuffer.writeUInt32LE(SAMPLE_RATE, 24);
  wavBuffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wavBuffer.writeUInt16LE(2, 32);  // BlockAlign
  wavBuffer.writeUInt16LE(16, 34); // BitsPerSample
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataBytes, 40);

  for (let s = 0; s < numSamples; s++) {
    const sample = Math.max(-1, Math.min(1, Math.tanh(loopBuf[s] * normScale * 1.05)));
    wavBuffer.writeInt16LE(Math.round(sample * 32767), 44 + s * 2);
  }

  return wavBuffer;
}

// ============================================================================
// 1. MAIN MENU — ARCANE KINGDOM THEME (16.0s loop, D Minor / Dorian-Aeolian)
// Mood: Mysterious, Majestic, Elegant, Cinematic
// ============================================================================
function buildMainMenuComposition() {
  const events = [];
  const chords = [
    // Dm9 (D2, A2, D3, F3, A3, E4)
    { start: 0.0, dur: 4.0, bass: 38, notes: [50, 57, 62, 65], arp: [62, 65, 69, 76, 74, 69, 65, 62] },
    // Bbmaj7#11 (Bb1, F2, Bb2, D3, A3, E4)
    { start: 4.0, dur: 4.0, bass: 34, notes: [46, 53, 58, 62], arp: [58, 62, 65, 72, 69, 65, 62, 58] },
    // Gm9 (G1, D2, G2, Bb2, F3, A3)
    { start: 8.0, dur: 4.0, bass: 31, notes: [43, 50, 55, 58], arp: [55, 58, 62, 69, 67, 62, 58, 55] },
    // Asus4 -> A7b9 (A1, E2, A2, D3 -> C#3, G3)
    { start: 12.0, dur: 4.0, bass: 33, notes: [45, 52, 57, 61], arp: [57, 62, 64, 69, 67, 64, 61, 57] }
  ];

  for (const ch of chords) {
    // Deep orchestral contrabass + cello foundation
    events.push({ inst: 'strings', midi: ch.bass, start: ch.start, dur: ch.dur + 0.4, gain: 0.26 });
    events.push({ inst: 'strings', midi: ch.bass + 12, start: ch.start, dur: ch.dur + 0.4, gain: 0.22 });
    // Ethereal choir + strings harmony
    for (const n of ch.notes) {
      events.push({ inst: 'choir', midi: n, start: ch.start, dur: ch.dur + 0.5, gain: 0.16 });
      events.push({ inst: 'strings', midi: n, start: ch.start, dur: ch.dur + 0.3, gain: 0.14 });
    }
    // Concert harp flowing 8th-note arpeggios
    ch.arp.forEach((midi, idx) => {
      events.push({ inst: 'harp', midi, start: ch.start + idx * 0.5, dur: 1.4, gain: 0.19 });
    });
  }

  // Memorable Arcane Kingdom Celesta & Woodwind Motif
  const melody = [
    { midi: 69, start: 0.5, dur: 1.5, inst: 'celesta' },
    { midi: 74, start: 2.0, dur: 1.0, inst: 'celesta' },
    { midi: 76, start: 3.0, dur: 1.0, inst: 'celesta' },
    { midi: 77, start: 4.0, dur: 2.0, inst: 'celesta' },
    { midi: 76, start: 6.0, dur: 1.0, inst: 'celesta' },
    { midi: 72, start: 7.0, dur: 1.0, inst: 'celesta' },
    { midi: 74, start: 8.0, dur: 1.5, inst: 'woodwind' },
    { midi: 70, start: 9.5, dur: 1.5, inst: 'woodwind' },
    { midi: 69, start: 11.0, dur: 1.0, inst: 'celesta' },
    { midi: 67, start: 12.0, dur: 1.5, inst: 'celesta' },
    { midi: 64, start: 13.5, dur: 1.0, inst: 'celesta' },
    { midi: 69, start: 14.5, dur: 1.5, inst: 'bell' }
  ];
  for (const m of melody) {
    events.push({ ...m, gain: 0.24 });
    if (m.inst === 'celesta') {
      events.push({ inst: 'woodwind', midi: m.midi - 12, start: m.start, dur: m.dur * 1.1, gain: 0.11 });
    }
  }

  return renderCompositionToWav(16.0, events, 0.42);
}

// ============================================================================
// 2. GOTHIC CATHEDRAL — SACRED ARCANA (16.0s loop, D Dorian)
// Mood: Ancient, Mysterious, Sacred, Atmospheric
// Instrumentation: Soft Choir, Low Strings, Medieval Bells, Ethereal Woodwind
// ============================================================================
function buildCathedralComposition() {
  const events = [];
  // D Dorian sacred progression: Dm -> C/D -> Bm7b5/D -> Gm/D -> Dm
  const chords = [
    { start: 0.0, dur: 4.0, bass: 38, choir: [50, 57, 62, 65], strings: [38, 45, 50, 57] },
    { start: 4.0, dur: 4.0, bass: 36, choir: [48, 55, 60, 64], strings: [36, 48, 52, 55] },
    { start: 8.0, dur: 4.0, bass: 35, choir: [47, 55, 59, 62], strings: [35, 47, 50, 55] },
    { start: 12.0, dur: 4.0, bass: 38, choir: [46, 53, 58, 62], strings: [38, 45, 52, 57] }
  ];

  for (const ch of chords) {
    for (const n of ch.choir) {
      events.push({ inst: 'choir', midi: n, start: ch.start, dur: ch.dur + 0.6, gain: 0.21 });
    }
    for (const n of ch.strings) {
      events.push({ inst: 'strings', midi: n, start: ch.start, dur: ch.dur + 0.5, gain: 0.16 });
    }
  }

  // Medieval Cathedral Chimes & Sanctuary Woodwind Counterpoint
  const bells = [
    { midi: 74, start: 0.0, dur: 3.2 },
    { midi: 69, start: 2.0, dur: 2.8 },
    { midi: 72, start: 4.0, dur: 3.2 },
    { midi: 76, start: 6.5, dur: 2.5 },
    { midi: 71, start: 8.0, dur: 3.4 },
    { midi: 67, start: 10.5, dur: 2.5 },
    { midi: 69, start: 12.0, dur: 3.6 },
    { midi: 62, start: 14.0, dur: 2.5 }
  ];
  for (const b of bells) {
    events.push({ inst: 'bell', midi: b.midi, start: b.start, dur: b.dur, gain: 0.19 });
  }

  const chant = [
    { midi: 62, start: 1.0, dur: 1.5 },
    { midi: 65, start: 2.5, dur: 1.5 },
    { midi: 67, start: 4.5, dur: 2.0 },
    { midi: 64, start: 6.5, dur: 1.5 },
    { midi: 62, start: 8.5, dur: 2.0 },
    { midi: 59, start: 10.5, dur: 1.5 },
    { midi: 60, start: 12.5, dur: 1.5 },
    { midi: 57, start: 14.0, dur: 2.0 }
  ];
  for (const c of chant) {
    events.push({ inst: 'woodwind', midi: c.midi, start: c.start, dur: c.dur, gain: 0.17 });
  }

  return renderCompositionToWav(16.0, events, 0.48);
}

// ============================================================================
// 3. ROYAL WAR HALL — CROWN OF THE KINGDOM (16.0s loop, A Aeolian / Heroic)
// Mood: Noble, Grand, Heroic, Magical
// Instrumentation: Cinematic Strings, Warm Brass, Harp, Ceremonial Percussion
// ============================================================================
function buildWarHallComposition() {
  const events = [];
  // Noble A minor -> Fmaj7 -> Dm7 -> E7 progression
  const chords = [
    { start: 0.0, dur: 4.0, bass: 33, brass: [45, 52, 57, 60], arp: [57, 60, 64, 69, 64, 60] },
    { start: 4.0, dur: 4.0, bass: 29, brass: [41, 48, 53, 57], arp: [53, 57, 60, 64, 60, 57] },
    { start: 8.0, dur: 4.0, bass: 38, brass: [38, 45, 50, 53], arp: [50, 53, 57, 62, 57, 53] },
    { start: 12.0, dur: 4.0, bass: 28, brass: [40, 47, 52, 56], arp: [52, 56, 59, 64, 59, 56] }
  ];

  for (const ch of chords) {
    events.push({ inst: 'strings', midi: ch.bass, start: ch.start, dur: ch.dur + 0.3, gain: 0.25 });
    for (const n of ch.brass) {
      events.push({ inst: 'brass', midi: n, start: ch.start, dur: ch.dur + 0.2, gain: 0.18 });
      events.push({ inst: 'strings', midi: n + 12, start: ch.start, dur: ch.dur + 0.3, gain: 0.13 });
    }
    ch.arp.forEach((midi, idx) => {
      events.push({ inst: 'harp', midi, start: ch.start + idx * 0.66, dur: 1.2, gain: 0.17 });
    });
    // Restrained ceremonial timpani pulse on beat 1 and beat 3.5
    events.push({ inst: 'timpani', midi: ch.bass + 12, start: ch.start, dur: 0.9, gain: 0.24 });
    events.push({ inst: 'timpani', midi: ch.bass + 7, start: ch.start + 2.0, dur: 0.7, gain: 0.16 });
    events.push({ inst: 'timpani', midi: ch.bass + 12, start: ch.start + 3.0, dur: 0.6, gain: 0.14 });
  }

  // Heroic French Horn & Strings Melody
  const hornMelody = [
    { midi: 69, start: 0.0, dur: 1.5 },
    { midi: 64, start: 1.5, dur: 1.0 },
    { midi: 72, start: 2.5, dur: 1.5 },
    { midi: 71, start: 4.0, dur: 1.5 },
    { midi: 69, start: 5.5, dur: 1.0 },
    { midi: 67, start: 6.5, dur: 1.5 },
    { midi: 65, start: 8.0, dur: 1.5 },
    { midi: 69, start: 9.5, dur: 1.0 },
    { midi: 74, start: 10.5, dur: 1.5 },
    { midi: 71, start: 12.0, dur: 2.0 },
    { midi: 68, start: 14.0, dur: 2.0 }
  ];
  for (const hm of hornMelody) {
    events.push({ inst: 'brass', midi: hm.midi, start: hm.start, dur: hm.dur, gain: 0.24 });
    events.push({ inst: 'strings', midi: hm.midi, start: hm.start, dur: hm.dur + 0.2, gain: 0.15 });
  }

  return renderCompositionToWav(16.0, events, 0.36);
}

// ============================================================================
// 4. ARCANE SANCTUM — CELESTIAL ENCHANTMENT (16.0s loop, C Lydian / Astral)
// Mood: Mystical, Dreamlike, Enchanted, Otherworldly
// Instrumentation: Celesta, Magical Bells, Shimmering Choir Pads, Harp Arpeggios
// ============================================================================
function buildSanctumComposition() {
  const events = [];
  // Cmaj7#11 -> D/C -> Bm7 -> Em9 (Lydian dreamscape)
  const chords = [
    { start: 0.0, dur: 4.0, pad: [48, 55, 59, 66], arp: [60, 64, 66, 71, 74, 78, 74, 71] },
    { start: 4.0, dur: 4.0, pad: [48, 57, 62, 66], arp: [62, 66, 69, 74, 78, 81, 78, 74] },
    { start: 8.0, dur: 4.0, pad: [47, 54, 59, 62], arp: [59, 62, 66, 71, 74, 78, 74, 69] },
    { start: 12.0, dur: 4.0, pad: [40, 52, 55, 66], arp: [55, 59, 64, 66, 71, 74, 71, 66] }
  ];

  for (const ch of chords) {
    for (const n of ch.pad) {
      events.push({ inst: 'choir', midi: n, start: ch.start, dur: ch.dur + 0.7, gain: 0.18 });
      events.push({ inst: 'strings', midi: n, start: ch.start, dur: ch.dur + 0.5, gain: 0.11 });
    }
    ch.arp.forEach((midi, idx) => {
      events.push({ inst: 'harp', midi, start: ch.start + idx * 0.5, dur: 1.5, gain: 0.18 });
    });
  }

  // Sparkling Celesta & Magical Bell Constellation Melody
  const stars = [
    { midi: 79, start: 0.25, dur: 1.5, inst: 'celesta' },
    { midi: 78, start: 1.25, dur: 1.5, inst: 'bell' },
    { midi: 74, start: 2.25, dur: 1.5, inst: 'celesta' },
    { midi: 71, start: 3.25, dur: 1.2, inst: 'celesta' },
    { midi: 81, start: 4.25, dur: 1.8, inst: 'bell' },
    { midi: 78, start: 5.75, dur: 1.2, inst: 'celesta' },
    { midi: 74, start: 6.75, dur: 1.5, inst: 'celesta' },
    { midi: 78, start: 8.25, dur: 1.5, inst: 'celesta' },
    { midi: 74, start: 9.5, dur: 1.2, inst: 'bell' },
    { midi: 71, start: 10.75, dur: 1.5, inst: 'celesta' },
    { midi: 76, start: 12.25, dur: 1.8, inst: 'bell' },
    { midi: 74, start: 13.75, dur: 1.2, inst: 'celesta' },
    { midi: 71, start: 14.75, dur: 1.5, inst: 'celesta' }
  ];
  for (const st of stars) {
    events.push({ ...st, gain: 0.22 });
  }

  return renderCompositionToWav(16.0, events, 0.50);
}

// ============================================================================
// 5. CLASSIC BOARD — TIMELESS STRATEGY (16.0s loop, F Major / D Minor Chamber)
// Mood: Classical, Peaceful, Intellectual, Refined
// Instrumentation: Gentle Grand Piano, Soft Chamber Strings, Harp, Subtle Undertones
// ============================================================================
function buildClassicComposition() {
  const events = [];
  // Fmaj7 -> Dm9 -> Gm7 -> C9sus4
  const chords = [
    { start: 0.0, dur: 4.0, strings: [41, 48, 57, 60], pianoComp: [53, 57, 60, 64, 60, 57, 53, 60] },
    { start: 4.0, dur: 4.0, strings: [38, 45, 53, 57], pianoComp: [50, 53, 57, 62, 57, 53, 50, 57] },
    { start: 8.0, dur: 4.0, strings: [43, 50, 55, 58], pianoComp: [46, 50, 55, 58, 55, 50, 46, 55] },
    { start: 12.0, dur: 4.0, strings: [36, 48, 55, 58], pianoComp: [48, 52, 55, 60, 58, 55, 52, 48] }
  ];

  for (const ch of chords) {
    for (const n of ch.strings) {
      events.push({ inst: 'strings', midi: n, start: ch.start, dur: ch.dur + 0.4, gain: 0.16 });
    }
    ch.pianoComp.forEach((midi, idx) => {
      events.push({ inst: 'piano', midi, start: ch.start + idx * 0.5, dur: 1.1, gain: 0.16 });
      if (idx % 2 === 0) {
        events.push({ inst: 'harp', midi: midi + 12, start: ch.start + idx * 0.5, dur: 1.2, gain: 0.10 });
      }
    });
  }

  // Expressive Classical Grand Piano & Chamber Violin Nocturne Melody
  const nocturne = [
    { midi: 69, start: 0.0, dur: 1.5 },
    { midi: 72, start: 1.5, dur: 1.0 },
    { midi: 69, start: 2.5, dur: 1.0 },
    { midi: 67, start: 3.5, dur: 0.5 },
    { midi: 65, start: 4.0, dur: 2.0 },
    { midi: 62, start: 6.0, dur: 1.0 },
    { midi: 65, start: 7.0, dur: 1.0 },
    { midi: 67, start: 8.0, dur: 1.5 },
    { midi: 70, start: 9.5, dur: 1.0 },
    { midi: 69, start: 10.5, dur: 1.5 },
    { midi: 67, start: 12.0, dur: 2.0 },
    { midi: 64, start: 14.0, dur: 2.0 }
  ];
  for (const n of nocturne) {
    events.push({ inst: 'piano', midi: n.midi, start: n.start, dur: n.dur * 1.2, gain: 0.26 });
    events.push({ inst: 'strings', midi: n.midi, start: n.start + 0.05, dur: n.dur, gain: 0.11 });
    if (n.start % 4 === 0) {
      events.push({ inst: 'celesta', midi: n.midi + 12, start: n.start, dur: 1.8, gain: 0.09 });
    }
  }

  return renderCompositionToWav(16.0, events, 0.34);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tracks = [
    { file: 'menu_arcane_kingdom.wav', builder: buildMainMenuComposition },
    { file: 'cathedral_sacred_arcana.wav', builder: buildCathedralComposition },
    { file: 'warhall_crown_of_kingdom.wav', builder: buildWarHallComposition },
    { file: 'sanctum_celestial_enchantment.wav', builder: buildSanctumComposition },
    { file: 'classic_timeless_strategy.wav', builder: buildClassicComposition }
  ];

  let totalBytes = 0;
  for (const t of tracks) {
    const buf = t.builder();
    const outPath = path.join(OUT_DIR, t.file);
    fs.writeFileSync(outPath, buf);
    totalBytes += buf.length;
    console.log(`[Magical Music Pipeline] Rendered ${t.file} (${(buf.length / 1024).toFixed(1)} KB)`);
  }
  console.log(
    `[Magical Music Pipeline] Successfully generated 5 original fantasy music tracks (${(
      totalBytes /
      (1024 * 1024)
    ).toFixed(2)} MB total)`
  );
}

main();
