import type { MapId, MoveRecord, PieceSymbol } from '../engine/types';

export const MAP_MUSIC_TRACKS: Record<MapId, { trackId: string; titleEn: string; titleId: string }> = {
  cathedral: {
    trackId: 'cathedral_solemn_chant',
    titleEn: 'Cathedral — Solemn Pipe-Organ & Nave Chimes',
    titleId: 'Katedral — Organ Pipa Khidmat & Lonceng'
  },
  warhall: {
    trackId: 'warhall_noble_march',
    titleEn: 'War Hall — Noble Brass Horns & War Drums',
    titleId: 'Aula Perang — Terompet Kerajaan & Genderang'
  },
  sanctum: {
    trackId: 'sanctum_mystic_astra',
    titleEn: 'Arcane Sanctum — Astral Crystal Choir & Celesta',
    titleId: 'Sanktum Arkana — Paduan Kristal Astral & Selesta'
  }
};

export class SoundManager {
  private static defaultInstance: SoundManager | null = null;

  private ctx: AudioContext | null = null;
  private muted = false;
  private sfxEnabled = true;
  private musicEnabled = true;
  private volume = 0.75;
  private activeMapId: MapId = 'cathedral';
  private activeTrackId = MAP_MUSIC_TRACKS.cathedral.trackId;
  private noiseBuffer: AudioBuffer | null = null;
  private musicGain: GainNode | null = null;
  private musicOscillators: OscillatorNode[] = [];
  private musicInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        if (this.musicEnabled && !this.muted) {
          this.updateMusicState();
        }
      };
      window.addEventListener('pointerdown', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
    }
  }

  public static getInstance(): SoundManager {
    if (!SoundManager.defaultInstance) {
      SoundManager.defaultInstance = new SoundManager();
    }
    return SoundManager.defaultInstance;
  }

  public static setMuted(muted: boolean): void {
    SoundManager.getInstance().setMuted(muted);
  }

  public static isMuted(): boolean {
    return SoundManager.getInstance().isMuted();
  }

  public static toggleMute(): boolean {
    return SoundManager.getInstance().toggleMute();
  }

  public static playSelect(): void {
    SoundManager.getInstance().playSelect();
  }

  public static playMove(): void {
    SoundManager.getInstance().playMove();
  }

  public static playCapture(): void {
    SoundManager.getInstance().playCapture();
  }

  public static playCastle(): void {
    SoundManager.getInstance().playCastle();
  }

  public static playCheck(): void {
    SoundManager.getInstance().playCheck();
  }

  public static playPromote(): void {
    SoundManager.getInstance().playPromote();
  }

  public static playVictory(): void {
    SoundManager.getInstance().playVictory();
  }

  public setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    this.updateMusicState();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    this.updateMusicState();
    return this.muted;
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = Boolean(enabled);
    this.muted = !this.sfxEnabled;
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled && !this.muted;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = Boolean(enabled);
    this.updateMusicState();
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(
        this.musicEnabled && !this.muted ? this.volume * 0.14 : 0.0001,
        this.ctx.currentTime,
        0.15
      );
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * Switches the active background music track to match the selected 3D Arena Map (`cathedral`, `warhall`, `sanctum`).
   */
  public setMapMusic(mapId: MapId): void {
    const nextTrack = MAP_MUSIC_TRACKS[mapId]?.trackId ?? MAP_MUSIC_TRACKS.cathedral.trackId;
    const changed = this.activeMapId !== mapId || this.activeTrackId !== nextTrack;
    this.activeMapId = mapId;
    this.activeTrackId = nextTrack;
    if (changed) {
      this.stopMusicNodes();
      if (this.musicEnabled && !this.muted) {
        this.updateMusicState();
      }
    }
  }

  public getMusicStatus(): {
    mapId: MapId;
    trackId: string;
    enabled: boolean;
    playing: boolean;
    volume: number;
  } {
    return {
      mapId: this.activeMapId,
      trackId: this.activeTrackId,
      enabled: this.musicEnabled,
      playing: this.musicEnabled && !this.muted && this.musicOscillators.length > 0,
      volume: this.volume
    };
  }

  private stopMusicNodes(): void {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
    for (const osc of this.musicOscillators) {
      try {
        osc.stop();
      } catch {
        // Ignore
      }
    }
    this.musicOscillators = [];
    this.musicGain = null;
  }

  private getRawContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        try {
          void this.ctx.resume().catch(() => {});
        } catch {
          // Ignore
        }
      }
      return this.ctx;
    }
    try {
      const globalScope = globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AudioCtx = globalScope.AudioContext ?? globalScope.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private updateMusicState(): void {
    if (!this.musicEnabled || this.muted || this.volume <= 0) {
      this.stopMusicNodes();
      return;
    }

    const ctx = this.getRawContext();
    if (!ctx || this.musicOscillators.length > 0) return;

    try {
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.001, ctx.currentTime);
      master.gain.linearRampToValueAtTime(this.volume * 0.13, ctx.currentTime + 1.2);
      master.connect(ctx.destination);
      this.musicGain = master;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';

      if (this.activeMapId === 'warhall') {
        // MAP 2: ROYAL WAR HALL — Noble brass-horn fifths in A Phrygian/Aeolian + rhythmic war-drum & horn melody
        filter.frequency.setValueAtTime(410, ctx.currentTime);
        filter.connect(master);

        const warHorns: Array<{ f: number; type: OscillatorType }> = [
          { f: 55.0, type: 'sawtooth' },   // A1 bass horn
          { f: 82.41, type: 'sawtooth' },  // E2 fifth
          { f: 110.0, type: 'triangle' },  // A2 octave
          { f: 130.81, type: 'triangle' }  // C3 minor third
        ];
        for (const h of warHorns) {
          const osc = ctx.createOscillator();
          osc.type = h.type;
          osc.frequency.setValueAtTime(h.f, ctx.currentTime);
          osc.connect(filter);
          osc.start();
          this.musicOscillators.push(osc);
        }

        const marchScale = [220.0, 246.94, 261.63, 293.66, 329.63, 392.0, 440.0];
        let step = 0;
        this.musicInterval = setInterval(() => {
          if (!this.musicEnabled || this.muted || !this.ctx || this.ctx.state !== 'running') return;
          try {
            const now = this.ctx.currentTime;
            // Deep royal war-drum pulse on even beats
            if (step % 2 === 0) {
              const drumOsc = this.ctx.createOscillator();
              const drumGain = this.ctx.createGain();
              drumOsc.type = 'sine';
              drumOsc.frequency.setValueAtTime(72, now);
              drumOsc.frequency.exponentialRampToValueAtTime(32, now + 0.32);
              drumGain.gain.setValueAtTime(this.volume * 0.08, now);
              drumGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
              drumOsc.connect(drumGain);
              drumGain.connect(this.ctx.destination);
              drumOsc.start(now);
              drumOsc.stop(now + 0.36);
            }
            // Noble brass-lute motif
            const freq = marchScale[(step * 2 + 1) % marchScale.length];
            step++;
            const hornOsc = this.ctx.createOscillator();
            const hornGain = this.ctx.createGain();
            hornOsc.type = 'triangle';
            hornOsc.frequency.setValueAtTime(freq, now);
            hornGain.gain.setValueAtTime(0.0001, now);
            hornGain.gain.linearRampToValueAtTime(this.volume * 0.05, now + 0.09);
            hornGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
            hornOsc.connect(hornGain);
            hornGain.connect(this.ctx.destination);
            hornOsc.start(now);
            hornOsc.stop(now + 1.65);
          } catch {
            // Ignore
          }
        }, 1850);
      } else if (this.activeMapId === 'sanctum') {
        // MAP 3: ARCANE SANCTUM — Mystical C-Lydian celestial crystal choir pad + shimmering celesta arpeggio
        filter.frequency.setValueAtTime(560, ctx.currentTime);
        filter.connect(master);

        const crystalPadFreqs: Array<{ f: number; type: OscillatorType }> = [
          { f: 130.81, type: 'sine' },     // C3
          { f: 196.0, type: 'triangle' },  // G3
          { f: 246.94, type: 'sine' },     // B3 (maj7)
          { f: 293.66, type: 'sine' },     // D4 (9th)
          { f: 369.99, type: 'triangle' }  // F#4 (#11 Lydian)
        ];
        for (const c of crystalPadFreqs) {
          const osc = ctx.createOscillator();
          osc.type = c.type;
          osc.frequency.setValueAtTime(c.f, ctx.currentTime);
          osc.connect(filter);
          osc.start();
          this.musicOscillators.push(osc);
        }

        const lydianScale = [523.25, 587.33, 659.25, 739.99, 783.99, 987.77, 1046.5];
        let arpIdx = 0;
        this.musicInterval = setInterval(() => {
          if (!this.musicEnabled || this.muted || !this.ctx || this.ctx.state !== 'running') return;
          try {
            const now = this.ctx.currentTime;
            const freq = lydianScale[(arpIdx * 3 + 2) % lydianScale.length];
            arpIdx++;
            const celOsc = this.ctx.createOscillator();
            const celGain = this.ctx.createGain();
            celOsc.type = 'sine';
            celOsc.frequency.setValueAtTime(freq, now);
            celGain.gain.setValueAtTime(0.0001, now);
            celGain.gain.linearRampToValueAtTime(this.volume * 0.042, now + 0.05);
            celGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
            celOsc.connect(celGain);
            celGain.connect(this.ctx.destination);
            celOsc.start(now);
            celOsc.stop(now + 2.65);
          } catch {
            // Ignore
          }
        }, 2100);
      } else {
        // MAP 1: GOTHIC CATHEDRAL — Solemn D-Dorian pipe-organ drone & cathedral nave harp chimes
        filter.frequency.setValueAtTime(310, ctx.currentTime);
        filter.connect(master);

        const droneFreqs = [73.42, 110.0, 146.83, 174.61];
        for (const f of droneFreqs) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f, ctx.currentTime);
          osc.connect(filter);
          osc.start();
          this.musicOscillators.push(osc);
        }

        const scale = [293.66, 329.63, 349.23, 440.0, 493.88, 523.25, 587.33];
        let noteIdx = 0;
        this.musicInterval = setInterval(() => {
          if (!this.musicEnabled || this.muted || !this.ctx || this.ctx.state !== 'running') return;
          try {
            const now = this.ctx.currentTime;
            const freq = scale[(noteIdx * 3 + 1) % scale.length];
            noteIdx++;
            const noteOsc = this.ctx.createOscillator();
            const noteGain = this.ctx.createGain();
            noteOsc.type = 'sine';
            noteOsc.frequency.setValueAtTime(freq, now);
            noteGain.gain.setValueAtTime(0.0001, now);
            noteGain.gain.linearRampToValueAtTime(this.volume * 0.045, now + 0.08);
            noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
            noteOsc.connect(noteGain);
            noteGain.connect(this.ctx.destination);
            noteOsc.start(now);
            noteOsc.stop(now + 2.5);
          } catch {
            // Ignore
          }
        }, 2700);
      }
    } catch {
      // Ignore in headless environments
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || !this.sfxEnabled || this.volume <= 0) {
      return null;
    }
    return this.getRawContext();
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) {
      return this.noiseBuffer;
    }
    try {
      const sampleRate = ctx.sampleRate || 44100;
      const length = Math.floor(sampleRate * 0.5);
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }

  /**
   * Subtle crystal/carved stone click when selecting a piece.
   */
  public playSelect(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Subtle stone tap
      const tapOsc = ctx.createOscillator();
      const tapGain = ctx.createGain();
      tapOsc.type = 'triangle';
      tapOsc.frequency.setValueAtTime(210, now);
      tapOsc.frequency.exponentialRampToValueAtTime(85, now + 0.045);

      tapGain.gain.setValueAtTime(0.18 * this.volume, now);
      tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      tapOsc.connect(tapGain);
      tapGain.connect(ctx.destination);
      tapOsc.start(now);
      tapOsc.stop(now + 0.05);

      // Arcane crystal overtone
      const chimeOsc = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chimeOsc.type = 'sine';
      chimeOsc.frequency.setValueAtTime(980, now);
      chimeOsc.frequency.exponentialRampToValueAtTime(1320, now + 0.06);

      chimeGain.gain.setValueAtTime(0.08 * this.volume, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(ctx.destination);
      chimeOsc.start(now);
      chimeOsc.stop(now + 0.07);
    } catch {
      // Ignore Web Audio errors in headless environments
    }
  }

  /**
   * Internal helper to synthesize a single carved stone slide & thud at `startTime`.
   */
  private triggerStoneSlideAndThud(ctx: AudioContext, startTime: number, pitchScale = 1): void {
    const noiseBuf = this.getNoiseBuffer(ctx);
    if (noiseBuf) {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(340 * pitchScale, startTime);
      filter.frequency.exponentialRampToValueAtTime(190 * pitchScale, startTime + 0.11);
      filter.Q.setValueAtTime(2.5, startTime);

      const slideGain = ctx.createGain();
      slideGain.gain.setValueAtTime(0.001, startTime);
      slideGain.gain.linearRampToValueAtTime(0.16 * this.volume, startTime + 0.025);
      slideGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      noise.connect(filter);
      filter.connect(slideGain);
      slideGain.connect(ctx.destination);

      noise.start(startTime);
      noise.stop(startTime + 0.13);
    }

    // Heavy stone thud on landing
    const thudTime = startTime + 0.055;
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(145 * pitchScale, thudTime);
    thudOsc.frequency.exponentialRampToValueAtTime(42 * pitchScale, thudTime + 0.13);

    thudGain.gain.setValueAtTime(0.32 * this.volume, thudTime);
    thudGain.gain.exponentialRampToValueAtTime(0.001, thudTime + 0.14);

    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(thudTime);
    thudOsc.stop(thudTime + 0.15);
  }

  /**
   * Heavy carved marble/stone slide & thud on chessboard.
   */
  public playMove(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      this.triggerStoneSlideAndThud(ctx, ctx.currentTime, 1.0);
    } catch {
      // Ignore Web Audio errors
    }
  }

  /**
   * Metallic sword clash + stone shatter for wizard chess captures.
   */
  public playCapture(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // 1. Metallic sword clash (inharmonic high partials)
      const clashFreqs = [1380, 2120, 2890];
      for (const freq of clashFreqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.84, now + 0.22);

        gain.gain.setValueAtTime(0.09 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      }

      // 2. Heavy stone impact & shatter burst
      const impactOsc = ctx.createOscillator();
      const impactGain = ctx.createGain();
      impactOsc.type = 'sawtooth';
      impactOsc.frequency.setValueAtTime(175, now);
      impactOsc.frequency.exponentialRampToValueAtTime(36, now + 0.22);

      impactGain.gain.setValueAtTime(0.36 * this.volume, now);
      impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      impactOsc.connect(impactGain);
      impactGain.connect(ctx.destination);
      impactOsc.start(now);
      impactOsc.stop(now + 0.25);

      const noiseBuf = this.getNoiseBuffer(ctx);
      if (noiseBuf) {
        const shatter = ctx.createBufferSource();
        shatter.buffer = noiseBuf;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(820, now + 0.02);
        filter.frequency.exponentialRampToValueAtTime(240, now + 0.28);
        filter.Q.setValueAtTime(1.4, now + 0.02);

        const shatterGain = ctx.createGain();
        shatterGain.gain.setValueAtTime(0.28 * this.volume, now + 0.015);
        shatterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.29);

        shatter.connect(filter);
        filter.connect(shatterGain);
        shatterGain.connect(ctx.destination);

        shatter.start(now + 0.015);
        shatter.stop(now + 0.3);
      }
    } catch {
      // Ignore Web Audio errors
    }
  }

  /**
   * Double heavy stone slide (King + Rook castling maneuver).
   */
  public playCastle(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      this.triggerStoneSlideAndThud(ctx, now, 0.92);
      this.triggerStoneSlideAndThud(ctx, now + 0.14, 1.12);
    } catch {
      // Ignore Web Audio errors
    }
  }

  /**
   * Dramatic brass/cathedral bell warning chime when a King is placed in Check.
   */
  public playCheck(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // Minor-second / minor-third cathedral bell + brass tension chord
      const partials: Array<{ freq: number; type: OscillatorType; amp: number; dur: number }> = [
        { freq: 440.0, type: 'triangle', amp: 0.22, dur: 0.65 },
        { freq: 523.25, type: 'sawtooth', amp: 0.12, dur: 0.55 },
        { freq: 880.0, type: 'sine', amp: 0.16, dur: 0.6 },
        { freq: 1174.66, type: 'sine', amp: 0.1, dur: 0.45 }
      ];

      for (const p of partials) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = p.type;
        osc.frequency.setValueAtTime(p.freq, now);
        osc.frequency.exponentialRampToValueAtTime(p.freq * 0.992, now + p.dur);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(p.amp * this.volume, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + p.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + p.dur + 0.02);
      }
    } catch {
      // Ignore Web Audio errors
    }
  }

  /**
   * Ascending golden arcane chord for Pawn Promotion.
   */
  public playPromote(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // Ascending D-Major / Lydian golden arpeggio
      const notes = [293.66, 369.99, 440.0, 587.33, 739.99];
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.065;
        const duration = 0.42;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.18 * this.volume, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);

        // Shimmering harmonic octave
        const shimmer = ctx.createOscillator();
        const shimmerGain = ctx.createGain();
        shimmer.type = 'sine';
        shimmer.frequency.setValueAtTime(freq * 2, start);

        shimmerGain.gain.setValueAtTime(0.001, start);
        shimmerGain.gain.linearRampToValueAtTime(0.07 * this.volume, start + 0.02);
        shimmerGain.gain.exponentialRampToValueAtTime(0.001, start + duration * 0.85);

        shimmer.connect(shimmerGain);
        shimmerGain.connect(ctx.destination);
        shimmer.start(start);
        shimmer.stop(start + duration);
      });
    } catch {
      // Ignore Web Audio errors
    }
  }

  /**
   * Grand medieval fanfare chord for Checkmate / Victory.
   */
  public playVictory(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // Royal medieval fanfare motif: C4 -> G4 -> C5 -> E5 + sustained C-Major triad
      const fanfare: Array<{ freq: number; delay: number; dur: number; amp: number }> = [
        { freq: 261.63, delay: 0.0, dur: 0.18, amp: 0.2 },
        { freq: 392.0, delay: 0.14, dur: 0.18, amp: 0.22 },
        { freq: 523.25, delay: 0.28, dur: 0.75, amp: 0.24 },
        { freq: 659.25, delay: 0.28, dur: 0.75, amp: 0.18 },
        { freq: 783.99, delay: 0.42, dur: 0.85, amp: 0.22 },
        { freq: 261.63, delay: 0.42, dur: 0.85, amp: 0.18 }
      ];

      for (const note of fanfare) {
        const start = now + note.delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note.freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(note.amp * this.volume, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + note.dur + 0.02);
      }
    } catch {
      // Ignore Web Audio errors
    }
  }

  public playRoleCapture(pieceType: PieceSymbol): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      if (pieceType === 'b' || pieceType === 'q') {
        // Arcane spell cast + energy burst
        const castOsc = ctx.createOscillator();
        const castGain = ctx.createGain();
        castOsc.type = 'sine';
        castOsc.frequency.setValueAtTime(520, now);
        castOsc.frequency.exponentialRampToValueAtTime(1480, now + 0.18);
        castGain.gain.setValueAtTime(0.22 * this.volume, now);
        castGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        castOsc.connect(castGain);
        castGain.connect(ctx.destination);
        castOsc.start(now);
        castOsc.stop(now + 0.26);
      } else if (pieceType === 'r') {
        // Heavy fortress seismic impact
        const slamOsc = ctx.createOscillator();
        const slamGain = ctx.createGain();
        slamOsc.type = 'triangle';
        slamOsc.frequency.setValueAtTime(98, now);
        slamOsc.frequency.exponentialRampToValueAtTime(28, now + 0.32);
        slamGain.gain.setValueAtTime(0.45 * this.volume, now);
        slamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        slamOsc.connect(slamGain);
        slamGain.connect(ctx.destination);
        slamOsc.start(now);
        slamOsc.stop(now + 0.35);
      }
    } catch {
      // Ignore
    }
    this.playCapture();
  }

  /**
   * Convenience dispatcher that plays the appropriate sound effect for a `MoveRecord`.
   */
  public playForMove(move: MoveRecord): void {
    if (move.isCheckmate) {
      if (move.captured) {
        this.playRoleCapture(move.piece);
      } else {
        this.playMove();
      }
      this.playVictory();
      return;
    }

    if (move.promotion) {
      this.playPromote();
    } else if (move.castling) {
      this.playCastle();
    } else if (move.captured) {
      this.playRoleCapture(move.piece);
    } else {
      this.playMove();
    }

    if (move.isCheck) {
      this.playCheck();
    }
  }
}

export const soundManager = SoundManager.getInstance();
