import type { MapId, MoveRecord, PieceSymbol } from '../engine/types';

export interface MusicTrackDescriptor {
  trackId: string;
  url: string;
  titleEn: string;
  titleId: string;
}

export const MAIN_MENU_MUSIC_TRACK: MusicTrackDescriptor = {
  trackId: 'menu_arcane_kingdom',
  url: './audio/music/menu_arcane_kingdom.wav',
  titleEn: 'Main Menu — Arcane Kingdom Theme',
  titleId: 'Menu Utama — Tema Kerajaan Arkana'
};

export const MAP_MUSIC_TRACKS: Record<MapId, MusicTrackDescriptor> = {
  cathedral: {
    trackId: 'cathedral_sacred_arcana',
    url: './audio/music/cathedral_sacred_arcana.wav',
    titleEn: 'Gothic Cathedral — Sacred Arcana',
    titleId: 'Katedral Gotik — Arkana Suci'
  },
  warhall: {
    trackId: 'warhall_crown_of_kingdom',
    url: './audio/music/warhall_crown_of_kingdom.wav',
    titleEn: 'Royal War Hall — Crown of the Kingdom',
    titleId: 'Aula Perang Kerajaan — Mahkota Kerajaan'
  },
  sanctum: {
    trackId: 'sanctum_celestial_enchantment',
    url: './audio/music/sanctum_celestial_enchantment.wav',
    titleEn: 'Arcane Sanctum — Celestial Enchantment',
    titleId: 'Sanktum Arkana — Pesona Surgawi'
  },
  classic: {
    trackId: 'classic_timeless_strategy',
    url: './audio/music/classic_timeless_strategy.wav',
    titleEn: 'Classic Board — Timeless Strategy',
    titleId: 'Papan Klasik — Strategi Abadi'
  }
};

interface ActiveMusicSession {
  trackId: string;
  gain: GainNode;
  sourceNode: AudioBufferSourceNode | null;
  padNodes: OscillatorNode[];
  seqInterval: ReturnType<typeof setInterval> | null;
  fadingOut: boolean;
  disposed: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

interface StoredAudioPrefs {
  volume: number;
  musicVolume: number;
  sfxVolume: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

const AUDIO_PREFS_STORAGE_KEY = 'mochess_audio_prefs_v2';

export class SoundManager {
  private static defaultInstance: SoundManager | null = null;

  private ctx: AudioContext | null = null;
  private muted = false;
  private sfxEnabled = true;
  private musicEnabled = true;
  private volume = 0.8;
  private musicVolume = 0.75;
  private sfxVolume = 0.85;

  private inMenuMode = true;
  private activeMapId: MapId = 'cathedral';
  private activeTrackId: string = MAIN_MENU_MUSIC_TRACK.trackId;

  private noiseBuffer: AudioBuffer | null = null;
  private decodedBuffers = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();
  private currentSession: ActiveMusicSession | null = null;
  private fadingSessions = new Set<ActiveMusicSession>();

  constructor() {
    this.loadStoredPrefs();
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          void this.ctx.resume().catch(() => {});
        }
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

  private loadStoredPrefs(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(AUDIO_PREFS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredAudioPrefs>;
      if (typeof parsed.volume === 'number') this.volume = Math.max(0, Math.min(1, parsed.volume));
      if (typeof parsed.musicVolume === 'number') {
        this.musicVolume = Math.max(0, Math.min(1, parsed.musicVolume));
      }
      if (typeof parsed.sfxVolume === 'number') {
        this.sfxVolume = Math.max(0, Math.min(1, parsed.sfxVolume));
      }
      if (typeof parsed.musicEnabled === 'boolean') this.musicEnabled = parsed.musicEnabled;
      if (typeof parsed.sfxEnabled === 'boolean') {
        this.sfxEnabled = parsed.sfxEnabled;
        this.muted = !this.sfxEnabled && !this.musicEnabled;
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveStoredPrefs(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const prefs: StoredAudioPrefs = {
        volume: this.volume,
        musicVolume: this.musicVolume,
        sfxVolume: this.sfxVolume,
        musicEnabled: this.musicEnabled,
        sfxEnabled: this.sfxEnabled
      };
      localStorage.setItem(AUDIO_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage errors
    }
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
    this.saveStoredPrefs();
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled && !this.muted;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = Boolean(enabled);
    this.saveStoredPrefs();
    this.updateMusicState();
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.saveStoredPrefs();
    this.syncActiveSessionGain();
  }

  public getVolume(): number {
    return this.volume;
  }

  public setMusicVolume(musicVolume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, musicVolume));
    this.saveStoredPrefs();
    this.syncActiveSessionGain();
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public setSfxVolume(sfxVolume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, sfxVolume));
    this.saveStoredPrefs();
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  private getEffectiveMusicGain(): number {
    if (!this.musicEnabled || this.muted) return 0;
    return this.volume * this.musicVolume * 0.34;
  }

  private getEffectiveSfxGain(): number {
    if (!this.sfxEnabled || this.muted) return 0;
    return this.volume * this.sfxVolume;
  }

  private syncActiveSessionGain(): void {
    const targetGain = this.getEffectiveMusicGain();
    if (targetGain <= 0.0001) {
      this.stopAllMusicSessions(0.25);
      return;
    }
    if (!this.currentSession || this.currentSession.fadingOut) {
      this.updateMusicState();
      return;
    }
    if (this.ctx) {
      this.currentSession.gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.12);
    }
  }

  /**
   * Switches between the dedicated Main Menu theme (`menu_arcane_kingdom`) and the active Map's composition.
   */
  public setMenuMusicActive(inMenu: boolean): void {
    const nextTrack = inMenu
      ? MAIN_MENU_MUSIC_TRACK.trackId
      : (MAP_MUSIC_TRACKS[this.activeMapId]?.trackId ?? MAP_MUSIC_TRACKS.cathedral.trackId);
    const changed = this.inMenuMode !== inMenu || this.activeTrackId !== nextTrack;
    this.inMenuMode = inMenu;
    this.activeTrackId = nextTrack;
    if (changed) {
      this.updateMusicState();
    }
  }

  /**
   * Switches the active background music track to match the selected 3D Arena Map (`cathedral`, `warhall`, `sanctum`, `classic`).
   */
  public setMapMusic(mapId: MapId): void {
    const nextTrack = MAP_MUSIC_TRACKS[mapId]?.trackId ?? MAP_MUSIC_TRACKS.cathedral.trackId;
    const changed = this.activeMapId !== mapId || this.activeTrackId !== nextTrack || this.inMenuMode;
    this.activeMapId = mapId;
    this.inMenuMode = false;
    this.activeTrackId = nextTrack;
    if (changed) {
      this.updateMusicState();
    }
  }

  public getActiveTrackDescriptor(): MusicTrackDescriptor {
    if (this.activeTrackId === MAIN_MENU_MUSIC_TRACK.trackId) {
      return MAIN_MENU_MUSIC_TRACK;
    }
    return MAP_MUSIC_TRACKS[this.activeMapId] ?? MAP_MUSIC_MUSIC_FALLBACK;
  }

  public getMusicStatus(): {
    mapId: MapId;
    trackId: string;
    inMenuMode: boolean;
    enabled: boolean;
    playing: boolean;
    volume: number;
    musicVolume: number;
    sfxVolume: number;
  } {
    return {
      mapId: this.activeMapId,
      trackId: this.activeTrackId,
      inMenuMode: this.inMenuMode,
      enabled: this.musicEnabled,
      playing: Boolean(
        this.musicEnabled &&
          !this.muted &&
          this.currentSession &&
          !this.currentSession.fadingOut &&
          !this.currentSession.disposed
      ),
      volume: this.volume,
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume
    };
  }

  private disposeSessionImmediately(session: ActiveMusicSession): void {
    if (session.disposed) return;
    session.disposed = true;
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }
    if (session.seqInterval) {
      clearInterval(session.seqInterval);
      session.seqInterval = null;
    }
    if (session.sourceNode) {
      try {
        session.sourceNode.stop();
        session.sourceNode.disconnect();
      } catch {
        // Ignore
      }
      session.sourceNode = null;
    }
    for (const osc of session.padNodes) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Ignore
      }
    }
    session.padNodes = [];
    try {
      session.gain.disconnect();
    } catch {
      // Ignore
    }
    this.fadingSessions.delete(session);
    if (this.currentSession === session) {
      this.currentSession = null;
    }
  }

  private fadeOutSession(session: ActiveMusicSession, fadeSec = 0.95): void {
    if (session.disposed || session.fadingOut) return;
    session.fadingOut = true;
    if (this.currentSession === session) {
      this.currentSession = null;
    }
    this.fadingSessions.add(session);

    if (!this.ctx || fadeSec <= 0.02) {
      this.disposeSessionImmediately(session);
      return;
    }

    try {
      const now = this.ctx.currentTime;
      session.gain.gain.cancelScheduledValues(now);
      session.gain.gain.setValueAtTime(Math.max(0.0001, session.gain.gain.value), now);
      session.gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
    } catch {
      this.disposeSessionImmediately(session);
      return;
    }

    session.cleanupTimer = setTimeout(() => {
      this.disposeSessionImmediately(session);
    }, Math.ceil(fadeSec * 1000) + 60);
  }

  private stopAllMusicSessions(fadeSec = 0.4): void {
    if (this.currentSession) {
      this.fadeOutSession(this.currentSession, fadeSec);
    }
    for (const s of Array.from(this.fadingSessions)) {
      if (fadeSec <= 0.02) {
        this.disposeSessionImmediately(s);
      }
    }
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

  private async loadTrackAudioBuffer(
    ctx: AudioContext,
    descriptor: MusicTrackDescriptor
  ): Promise<AudioBuffer | null> {
    if (this.decodedBuffers.has(descriptor.trackId)) {
      return this.decodedBuffers.get(descriptor.trackId)!;
    }
    if (this.loadingPromises.has(descriptor.trackId)) {
      return this.loadingPromises.get(descriptor.trackId)!;
    }
    if (typeof fetch !== 'function') return null;

    const promise = (async () => {
      try {
        const res = await fetch(descriptor.url);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        this.decodedBuffers.set(descriptor.trackId, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.loadingPromises.delete(descriptor.trackId);
      }
    })();

    this.loadingPromises.set(descriptor.trackId, promise);
    return promise;
  }

  private updateMusicState(): void {
    const targetGain = this.getEffectiveMusicGain();
    if (targetGain <= 0.0001) {
      this.stopAllMusicSessions(0.35);
      return;
    }

    const descriptor = this.getActiveTrackDescriptor();
    if (
      this.currentSession &&
      this.currentSession.trackId === descriptor.trackId &&
      !this.currentSession.fadingOut &&
      !this.currentSession.disposed
    ) {
      this.syncActiveSessionGain();
      return;
    }

    const ctx = this.getRawContext();
    if (!ctx) return;

    // Crossfade out any previous session so tracks never overlap
    if (this.currentSession) {
      this.fadeOutSession(this.currentSession, 1.05);
    }

    try {
      const sessionGain = ctx.createGain();
      sessionGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      sessionGain.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 1.15);
      sessionGain.connect(ctx.destination);

      const session: ActiveMusicSession = {
        trackId: descriptor.trackId,
        gain: sessionGain,
        sourceNode: null,
        padNodes: [],
        seqInterval: null,
        fadingOut: false,
        disposed: false,
        cleanupTimer: null
      };
      this.currentSession = session;

      // Start immediate soft ethereal WebAudio harmonic layer while the rendered WAV buffer loads
      this.startProceduralFantasyLayer(ctx, session, descriptor.trackId);

      // Load and attach the full multi-instrument rendered WAV composition with seamless looping
      void this.loadTrackAudioBuffer(ctx, descriptor).then((audioBuffer) => {
        if (!audioBuffer || session.disposed || session.fadingOut || this.currentSession !== session) {
          return;
        }
        try {
          // Stop fallback procedural oscillators once the full multi-instrument WAV buffer takes over
          if (session.seqInterval) {
            clearInterval(session.seqInterval);
            session.seqInterval = null;
          }
          for (const osc of session.padNodes) {
            try {
              osc.stop();
              osc.disconnect();
            } catch {
              // Ignore
            }
          }
          session.padNodes = [];

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.loop = true;
          source.connect(session.gain);
          source.start(0);
          session.sourceNode = source;
        } catch {
          // Keep procedural fallback if buffer source fails
        }
      });
    } catch {
      // Ignore in headless environments
    }
  }

  /**
   * Multi-voice magical fantasy harmonic synthesizer used immediately before the WAV buffer finishes decoding
   * (or in unit-test environments without network fetch).
   */
  private startProceduralFantasyLayer(
    ctx: AudioContext,
    session: ActiveMusicSession,
    trackId: string
  ): void {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(480, ctx.currentTime);
    filter.connect(session.gain);

    // Distinct harmonic voicings and melodic motifs for all 5 themes
    const configs: Record<
      string,
      { pad: number[]; motif: number[]; padWave: OscillatorType; motifWave: OscillatorType; tempoMs: number }
    > = {
      menu_arcane_kingdom: {
        pad: [146.83, 220.0, 293.66, 349.23], // Dm9 majestic choir pad
        motif: [440.0, 587.33, 659.25, 698.46, 659.25, 523.25, 587.33, 440.0],
        padWave: 'triangle',
        motifWave: 'sine',
        tempoMs: 1450
      },
      cathedral_sacred_arcana: {
        pad: [146.83, 220.0, 261.63, 329.63], // D Dorian sacred arcana
        motif: [587.33, 440.0, 523.25, 659.25, 493.88, 392.0, 440.0, 293.66],
        padWave: 'sine',
        motifWave: 'sine',
        tempoMs: 1750
      },
      warhall_crown_of_kingdom: {
        pad: [110.0, 164.81, 220.0, 261.63], // A Aeolian royal brass & strings
        motif: [440.0, 329.63, 523.25, 493.88, 440.0, 392.0, 349.23, 329.63],
        padWave: 'triangle',
        motifWave: 'triangle',
        tempoMs: 1350
      },
      sanctum_celestial_enchantment: {
        pad: [130.81, 196.0, 246.94, 369.99], // C Lydian celestial enchantment
        motif: [783.99, 739.99, 587.33, 493.88, 880.0, 739.99, 659.25, 587.33],
        padWave: 'sine',
        motifWave: 'sine',
        tempoMs: 1250
      },
      classic_timeless_strategy: {
        pad: [174.61, 220.0, 261.63, 329.63], // Fmaj7 timeless chamber strings & piano
        motif: [440.0, 523.25, 440.0, 392.0, 349.23, 293.66, 349.23, 392.0],
        padWave: 'triangle',
        motifWave: 'triangle',
        tempoMs: 1500
      }
    };

    const cfg = configs[trackId] ?? configs.menu_arcane_kingdom;
    for (const freq of cfg.pad) {
      const osc = ctx.createOscillator();
      const padGain = ctx.createGain();
      osc.type = cfg.padWave;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      padGain.gain.setValueAtTime(0.16, ctx.currentTime);
      osc.connect(padGain);
      padGain.connect(filter);
      osc.start();
      session.padNodes.push(osc);
    }

    let step = 0;
    session.seqInterval = setInterval(() => {
      if (session.disposed || session.fadingOut || !this.ctx || this.ctx.state !== 'running') return;
      try {
        const now = this.ctx.currentTime;
        const freq = cfg.motif[step % cfg.motif.length];
        step++;

        // Celesta / Harp harmonic note
        const noteOsc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();
        noteOsc.type = cfg.motifWave;
        noteOsc.frequency.setValueAtTime(freq, now);
        noteGain.gain.setValueAtTime(0.0001, now);
        noteGain.gain.linearRampToValueAtTime(0.18, now + 0.04);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        noteOsc.connect(noteGain);
        noteGain.connect(session.gain);
        noteOsc.start(now);
        noteOsc.stop(now + 1.85);
      } catch {
        // Ignore
      }
    }, cfg.tempoMs);
  }

  private getContext(): AudioContext | null {
    if (this.getEffectiveSfxGain() <= 0.0001) {
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
    const sfxVol = this.getEffectiveSfxGain();

    try {
      const now = ctx.currentTime;

      const tapOsc = ctx.createOscillator();
      const tapGain = ctx.createGain();
      tapOsc.type = 'triangle';
      tapOsc.frequency.setValueAtTime(210, now);
      tapOsc.frequency.exponentialRampToValueAtTime(85, now + 0.045);

      tapGain.gain.setValueAtTime(0.18 * sfxVol, now);
      tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      tapOsc.connect(tapGain);
      tapGain.connect(ctx.destination);
      tapOsc.start(now);
      tapOsc.stop(now + 0.05);

      const chimeOsc = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chimeOsc.type = 'sine';
      chimeOsc.frequency.setValueAtTime(980, now);
      chimeOsc.frequency.exponentialRampToValueAtTime(1320, now + 0.06);

      chimeGain.gain.setValueAtTime(0.08 * sfxVol, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(ctx.destination);
      chimeOsc.start(now);
      chimeOsc.stop(now + 0.07);
    } catch {
      // Ignore Web Audio errors in headless environments
    }
  }

  private triggerStoneSlideAndThud(ctx: AudioContext, startTime: number, pitchScale = 1): void {
    const sfxVol = this.getEffectiveSfxGain();
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
      slideGain.gain.linearRampToValueAtTime(0.16 * sfxVol, startTime + 0.025);
      slideGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      noise.connect(filter);
      filter.connect(slideGain);
      slideGain.connect(ctx.destination);

      noise.start(startTime);
      noise.stop(startTime + 0.13);
    }

    const thudTime = startTime + 0.055;
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(145 * pitchScale, thudTime);
    thudOsc.frequency.exponentialRampToValueAtTime(42 * pitchScale, thudTime + 0.13);

    thudGain.gain.setValueAtTime(0.32 * sfxVol, thudTime);
    thudGain.gain.exponentialRampToValueAtTime(0.001, thudTime + 0.14);

    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(thudTime);
    thudOsc.stop(thudTime + 0.15);
  }

  public playMove(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      this.triggerStoneSlideAndThud(ctx, ctx.currentTime, 1.0);
    } catch {
      // Ignore Web Audio errors
    }
  }

  public playCapture(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const sfxVol = this.getEffectiveSfxGain();

    try {
      const now = ctx.currentTime;

      const clashFreqs = [1380, 2120, 2890];
      for (const freq of clashFreqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.84, now + 0.22);

        gain.gain.setValueAtTime(0.09 * sfxVol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      }

      const impactOsc = ctx.createOscillator();
      const impactGain = ctx.createGain();
      impactOsc.type = 'sawtooth';
      impactOsc.frequency.setValueAtTime(175, now);
      impactOsc.frequency.exponentialRampToValueAtTime(36, now + 0.22);

      impactGain.gain.setValueAtTime(0.36 * sfxVol, now);
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
        shatterGain.gain.setValueAtTime(0.28 * sfxVol, now + 0.015);
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

  public playCheck(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const sfxVol = this.getEffectiveSfxGain();

    try {
      const now = ctx.currentTime;
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
        gain.gain.linearRampToValueAtTime(p.amp * sfxVol, now + 0.015);
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

  public playPromote(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const sfxVol = this.getEffectiveSfxGain();

    try {
      const now = ctx.currentTime;
      const notes = [293.66, 369.99, 440.0, 587.33, 739.99];
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.065;
        const duration = 0.42;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.18 * sfxVol, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);

        const shimmer = ctx.createOscillator();
        const shimmerGain = ctx.createGain();
        shimmer.type = 'sine';
        shimmer.frequency.setValueAtTime(freq * 2, start);

        shimmerGain.gain.setValueAtTime(0.001, start);
        shimmerGain.gain.linearRampToValueAtTime(0.07 * sfxVol, start + 0.02);
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

  public playVictory(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const sfxVol = this.getEffectiveSfxGain();

    try {
      const now = ctx.currentTime;
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
        gain.gain.linearRampToValueAtTime(note.amp * sfxVol, start + 0.025);
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
    const sfxVol = this.getEffectiveSfxGain();

    try {
      const now = ctx.currentTime;
      if (pieceType === 'b' || pieceType === 'q') {
        const castOsc = ctx.createOscillator();
        const castGain = ctx.createGain();
        castOsc.type = 'sine';
        castOsc.frequency.setValueAtTime(520, now);
        castOsc.frequency.exponentialRampToValueAtTime(1480, now + 0.18);
        castGain.gain.setValueAtTime(0.22 * sfxVol, now);
        castGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        castOsc.connect(castGain);
        castGain.connect(ctx.destination);
        castOsc.start(now);
        castOsc.stop(now + 0.26);
      } else if (pieceType === 'r') {
        const slamOsc = ctx.createOscillator();
        const slamGain = ctx.createGain();
        slamOsc.type = 'triangle';
        slamOsc.frequency.setValueAtTime(98, now);
        slamOsc.frequency.exponentialRampToValueAtTime(28, now + 0.32);
        slamGain.gain.setValueAtTime(0.45 * sfxVol, now);
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

const MAP_MUSIC_MUSIC_FALLBACK = MAP_MUSIC_TRACKS.cathedral;

export const soundManager = SoundManager.getInstance();
