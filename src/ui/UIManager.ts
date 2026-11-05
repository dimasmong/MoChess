import type { ChessGameEngine } from '../engine/ChessGameEngine';
import type {
  AIDifficulty,
  Color,
  GameConfig,
  GameMode,
  GameStateSnapshot,
  Language,
  MapId,
  MoveRecord,
  PieceSymbol,
  TimeControlMinutes
} from '../engine/types';
import type { QualityTier } from '../assets/ProceduralTextures';
import type { CameraPreset, SceneManager } from '../scene/SceneManager';
import { soundManager } from '../audio/SoundManager';
import { getSavedLanguage, saveLanguage, TRANSLATIONS } from './i18n';

function formatClockMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class UIManager {
  private readonly engine: ChessGameEngine;
  private readonly scene: SceneManager;
  private readonly onTriggerAIMove: () => void;

  private lang: Language;

  private mainMenuScreen = document.getElementById('main-menu-screen')!;
  private cinematicSkipBar = document.getElementById('cinematic-skip-bar')!;
  private cinematicMapLabel = document.getElementById('cinematic-map-label')!;

  private turnDotEl = document.getElementById('turn-dot')!;
  private turnTextEl = document.getElementById('turn-text')!;
  private modeBadgeEl = document.getElementById('mode-badge')!;
  private mapBadgeEl = document.getElementById('map-badge')!;
  private clockBadgeEl = document.getElementById('clock-badge')!;
  private capturedSummaryEl = document.getElementById('captured-summary')!;
  private switchSideBtn = document.getElementById('btn-switch-side') as HTMLButtonElement;
  private aiMoveBtn = document.getElementById('btn-ai-move') as HTMLButtonElement;
  private undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
  private cameraBtn = document.getElementById('btn-camera') as HTMLButtonElement;

  private historyDrawer = document.getElementById('history-drawer')!;
  private moveListEl = document.getElementById('move-list')!;
  private capturedByWhiteEl = document.getElementById('captured-by-white')!;
  private capturedByBlackEl = document.getElementById('captured-by-black')!;

  private mapSelectModal = document.getElementById('map-select-modal')!;
  private lobbyModal = document.getElementById('lobby-modal')!;
  private settingsModal = document.getElementById('settings-modal')!;
  private creditsModal = document.getElementById('credits-modal')!;
  private promotionModal = document.getElementById('promotion-modal')!;
  private gameoverModal = document.getElementById('gameover-modal')!;
  private gameoverTitleEl = document.getElementById('gameover-title')!;
  private gameoverWinnerPillEl = document.getElementById('gameover-winner-pill')!;
  private gameoverSubtitleEl = document.getElementById('gameover-subtitle')!;

  private draftConfig: GameConfig;
  private aiThinking = false;
  private lastGameOverShownFen: string | null = null;

  constructor(
    engine: ChessGameEngine,
    scene: SceneManager,
    onTriggerAIMove: () => void
  ) {
    this.engine = engine;
    this.scene = scene;
    this.onTriggerAIMove = onTriggerAIMove;
    this.draftConfig = this.engine.getConfig();
    this.lang = getSavedLanguage();

    this.scene.setOnCinematicStateChange((active) => {
      this.cinematicSkipBar.classList.toggle('hidden', !active);
      if (active) {
        const mapId = this.engine.getConfig().mapId ?? 'cathedral';
        this.cinematicMapLabel.textContent = this.getMapDisplayName(mapId);
      }
    });

    this.bindUIEvents();
    this.applyTranslations();
  }

  public getLanguage(): Language {
    return this.lang;
  }

  public setLanguage(lang: Language): void {
    this.lang = lang;
    saveLanguage(lang);
    document.documentElement.lang = lang;
    this.applyTranslations();
    this.updateFromSnapshot(this.engine.getSnapshot());
    this.syncLobbyControlsWithDraft();
    this.syncMapCards();
  }

  public showMainMenu(visible: boolean): void {
    this.mainMenuScreen.classList.toggle('hidden', !visible);
    this.scene.setMenuShowcaseMode(visible);
  }

  public isMainMenuVisible(): boolean {
    return !this.mainMenuScreen.classList.contains('hidden');
  }

  private getMapDisplayName(mapId: MapId): string {
    const t = TRANSLATIONS[this.lang];
    if (mapId === 'warhall') return t.mapWarHall;
    if (mapId === 'sanctum') return t.mapSanctum;
    return t.mapCathedral;
  }

  private getCameraDisplayLabel(preset: CameraPreset): string {
    const t = TRANSLATIONS[this.lang];
    switch (preset) {
      case 'gameplay':
        return t.viewGameplay;
      case 'top':
        return t.viewOverhead;
      case 'cinematic':
        return t.viewCinematic;
      case 'white':
        return t.viewWhite;
      case 'black':
        return t.viewBlack;
    }
  }

  private applyTranslations(): void {
    const t = TRANSLATIONS[this.lang];

    const setText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    // Main Menu
    setText('menu-title', t.brandTitle);
    setText('menu-subtitle', t.menuSubtitle);
    setText('menu-tagline', t.menuTagline);
    setText('btn-menu-play', t.btnPlay);
    setText('btn-menu-maps', t.btnMapSelect);
    setText('btn-menu-settings', t.btnSettings);
    setText('btn-menu-lang', `${t.btnLanguage}: ${this.lang.toUpperCase()}`);
    setText('btn-menu-credits', t.btnCredits);
    setText('btn-skip-intro', t.btnSkipIntro);

    // Top & Bottom HUD
    setText('hud-brand-title', t.brandTitle);
    setText('btn-main-menu', t.btnMainMenu);
    setText('btn-lobby', t.btnLobby);
    setText('btn-maps', t.btnMapSelect.split(' ')[0]);
    setText('btn-ai-move', t.btnAIMove);
    setText('btn-new-game', t.btnNewGame);
    setText('hud-hint-text', t.hintText);
    setText('btn-undo', t.btnUndo);
    setText('btn-restart', t.btnRestart);
    setText('btn-history', t.btnHistory);
    setText('btn-settings', t.btnSettings);
    this.cameraBtn.textContent = this.getCameraDisplayLabel(this.scene.getCameraPreset());

    // History Drawer
    setText('history-title', t.historyTitle);
    setText('label-white-captured', t.whiteCapturedLabel);
    setText('label-black-captured', t.blackCapturedLabel);
    setText('empty-history-text', t.noMovesYet);

    // Map Selection Modal
    setText('map-modal-title', t.mapSelectTitle);
    setText('map-modal-subtitle', t.mapSelectSubtitle);
    setText('map-title-cathedral', t.mapCathedral);
    setText('map-desc-cathedral', t.mapCathedralDesc);
    setText('map-title-warhall', t.mapWarHall);
    setText('map-desc-warhall', t.mapWarHallDesc);
    setText('map-title-sanctum', t.mapSanctum);
    setText('map-desc-sanctum', t.mapSanctumDesc);
    setText('btn-maps-confirm', t.btnSelectMap);

    // Lobby Modal
    setText('lobby-title', t.lobbyTitle);
    setText('label-game-mode', t.labelGameMode);
    setText('btn-mode-ai', t.modeVsAI);
    setText('btn-mode-local', t.modeLocal2P);
    setText('label-your-faction', t.labelYourFaction);
    setText('btn-color-w', t.factionWhite);
    setText('btn-color-b', t.factionBlack);
    setText('label-ai-rank', t.labelAIRank);
    setText('btn-diff-novice', t.diffNovice);
    setText('btn-diff-knight', t.diffKnight);
    setText('btn-diff-archmage', t.diffArchmage);
    setText('btn-diff-grandmaster', t.diffGrandmaster);
    setText('label-time-control', t.labelTimeControl);
    setText('btn-clock-0', t.clockUnlimited);
    setText('btn-clock-3', t.clock3m);
    setText('btn-clock-5', t.clock5m);
    setText('btn-clock-10', t.clock10m);
    setText('label-arena-map', t.labelArenaMap);
    setText('btn-lobby-map-cathedral', t.mapCathedral);
    setText('btn-lobby-map-warhall', t.mapWarHall);
    setText('btn-lobby-map-sanctum', t.mapSanctum);
    setText('label-camera-preset', t.labelCameraPreset);
    setText('btn-cam-gameplay', t.camGameplay);
    setText('btn-cam-top', t.camOverhead);
    setText('btn-cam-cinematic', t.camCinematic);
    setText('btn-lobby-mainmenu', t.btnMainMenu);
    setText('btn-lobby-resume', t.btnResumeMatch);
    setText('btn-lobby-start', t.btnStartMatch);

    // Settings Modal
    setText('settings-title', t.settingsTitle);
    setText('label-setting-lang', t.settingLanguage);
    setText('label-setting-quality', t.settingGraphicsQuality);
    setText('btn-quality-low', t.qualityLow);
    setText('btn-quality-medium', t.qualityMedium);
    setText('btn-quality-high', t.qualityHigh);
    setText('label-setting-volume', t.settingVolume);
    setText('label-setting-music', t.settingMusic);
    setText('label-setting-sfx', t.settingSfx);
    setText('label-setting-camsens', t.settingCamSensitivity);
    setText('label-setting-fx', t.settingMagicalFx);
    setText('label-setting-motion', t.settingReducedMotion);
    setText('label-setting-coords', t.settingShowCoords);
    setText('btn-settings-done', t.btnDone);

    // Credits Modal & Main Menu Developer Footer
    setText('menu-footer-signature', t.creditsSignature);
    setText('menu-footer-copyright', t.creditsCopyright);
    setText('credits-title', t.creditsTitle);
    setText('credits-creator-label', t.creditsCreatorLabel);
    setText('credits-creator-role', t.creditsCreatorRole);
    setText('credits-github-text', t.creditsGithubBtn);
    setText('credits-body', t.creditsBody);
    setText('credits-tech-title', t.creditsTechTitle);
    setText('credits-license-notice', t.creditsLicenseNotice);
    setText('credits-signature', t.creditsSignature);
    setText('credits-copyright', t.creditsCopyright);
    setText('btn-credits-close', t.btnClose);

    // Promotion Modal
    setText('promo-title', t.promoTitle);
    setText('promo-name-q', t.pieceNames.q);
    setText('promo-sub-q', t.promoQueenSub);
    setText('promo-name-r', t.pieceNames.r);
    setText('promo-sub-r', t.promoRookSub);
    setText('promo-name-b', t.pieceNames.b);
    setText('promo-sub-b', t.promoBishopSub);
    setText('promo-name-n', t.pieceNames.n);
    setText('promo-sub-n', t.promoKnightSub);

    // Game Over Modal Buttons
    setText('btn-gameover-rematch', t.btnRematch);
    setText('btn-gameover-new', t.btnNewGame);
    setText('btn-gameover-lobby', t.btnReturnLobby);
    setText('btn-gameover-review', t.btnReviewBoard);

    document.querySelectorAll('#select-language .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.lang === this.lang);
    });
  }

  public setAIThinking(thinking: boolean): void {
    this.aiThinking = thinking;
    this.updateStatusHeader(this.engine.getSnapshot());
  }

  public showPromotionModal(show: boolean): void {
    this.promotionModal.classList.toggle('hidden', !show);
  }

  public updateFromSnapshot(snapshot: GameStateSnapshot, _lastMove?: MoveRecord): void {
    const t = TRANSLATIONS[this.lang];
    this.updateStatusHeader(snapshot);
    this.updateCapturedAndHistory(snapshot);

    this.switchSideBtn.textContent =
      snapshot.config.playerColor === 'w' ? t.btnPlayAsBlack : t.btnPlayAsWhite;

    const mapId = snapshot.config.mapId ?? 'cathedral';
    this.mapBadgeEl.textContent = this.getMapDisplayName(mapId);

    this.undoBtn.disabled = snapshot.moveHistory.length === 0 || this.aiThinking;
    this.aiMoveBtn.disabled = snapshot.isGameOver || this.aiThinking;

    if (snapshot.isGameOver) {
      if (this.lastGameOverShownFen !== snapshot.fen) {
        this.lastGameOverShownFen = snapshot.fen;
        this.presentGameOverModal(snapshot);
      }
    } else {
      this.lastGameOverShownFen = null;
      this.gameoverModal.classList.add('hidden');
    }
  }

  private updateStatusHeader(snapshot: GameStateSnapshot): void {
    const t = TRANSLATIONS[this.lang];

    this.turnDotEl.className = 'turn-dot';
    if (snapshot.inCheck && !snapshot.isGameOver) {
      this.turnDotEl.classList.add('check');
    } else {
      this.turnDotEl.classList.add(snapshot.turn === 'w' ? 'white' : 'black');
    }

    if (snapshot.isGameOver) {
      if (snapshot.winner === 'draw') {
        const reason = snapshot.resultReason === 'stalemate' ? t.stalemateBanner : t.drawBanner;
        this.turnTextEl.textContent = reason;
      } else {
        const winText = snapshot.winner === 'w' ? t.whiteWins : t.blackWins;
        this.turnTextEl.textContent = `${t.checkmateBanner} • ${winText}`;
      }
    } else {
      const isWhite = snapshot.turn === 'w';
      const isAISide = snapshot.config.mode === 'ai' && snapshot.turn !== snapshot.config.playerColor;
      if (this.aiThinking || isAISide) {
        this.turnTextEl.textContent = isWhite ? t.whiteToMoveAI : t.blackToMoveAI;
      } else if (snapshot.inCheck) {
        this.turnTextEl.textContent = isWhite ? t.whiteInCheck : t.blackInCheck;
      } else {
        this.turnTextEl.textContent = isWhite ? t.whiteToMove : t.blackToMove;
      }
    }

    if (snapshot.config.mode === 'ai') {
      this.modeBadgeEl.textContent =
        snapshot.config.playerColor === 'w' ? t.singlePlayerYouWhite : t.singlePlayerYouBlack;
    } else {
      this.modeBadgeEl.textContent = t.twoPlayerLocal;
    }

    if (snapshot.clock.enabled) {
      this.clockBadgeEl.classList.remove('hidden');
      this.clockBadgeEl.textContent = `W ${formatClockMs(snapshot.clock.whiteMs)} | B ${formatClockMs(snapshot.clock.blackMs)}`;
    } else {
      this.clockBadgeEl.classList.add('hidden');
    }
  }

  private updateCapturedAndHistory(snapshot: GameStateSnapshot): void {
    const t = TRANSLATIONS[this.lang];
    const whiteLostCount = snapshot.captured.w.length;
    const blackLostCount = snapshot.captured.b.length;

    if (whiteLostCount > 0 || blackLostCount > 0) {
      this.capturedSummaryEl.textContent = `${t.capturedSummaryPrefix} — W: ${blackLostCount} | B: ${whiteLostCount}`;
    } else {
      this.capturedSummaryEl.textContent = '';
    }

    this.capturedByWhiteEl.textContent =
      snapshot.captured.b.length > 0
        ? snapshot.captured.b.map((p) => t.pieceNames[p]).join(', ')
        : '—';
    this.capturedByBlackEl.textContent =
      snapshot.captured.w.length > 0
        ? snapshot.captured.w.map((p) => t.pieceNames[p]).join(', ')
        : '—';

    if (snapshot.moveHistory.length === 0) {
      this.moveListEl.innerHTML = `<div class="empty-history" id="empty-history-text">${t.noMovesYet}</div>`;
      return;
    }

    let html = '';
    for (let i = 0; i < snapshot.moveHistory.length; i += 2) {
      const wMove = snapshot.moveHistory[i];
      const bMove = snapshot.moveHistory[i + 1];
      const moveNum = Math.floor(i / 2) + 1;
      html += `<div class="move-pair-row">
        <span class="move-num">${moveNum}.</span>
        <span class="move-san">${wMove.san}</span>
        <span class="move-san">${bMove ? bMove.san : ''}</span>
      </div>`;
    }
    this.moveListEl.innerHTML = html;
    this.moveListEl.scrollTop = this.moveListEl.scrollHeight;
  }

  private presentGameOverModal(snapshot: GameStateSnapshot): void {
    const t = TRANSLATIONS[this.lang];
    if (snapshot.winner === 'draw') {
      this.gameoverTitleEl.textContent =
        snapshot.resultReason === 'stalemate' ? t.stalemateTitle : t.drawTitle;
      this.gameoverWinnerPillEl.textContent = t.drawBanner;
      const reason = snapshot.resultReason?.replace(/_/g, ' ') ?? 'stalemate';
      this.gameoverSubtitleEl.textContent = `${t.drawSubtitlePrefix} ${reason}.`;
    } else {
      const isWhiteWin = snapshot.winner === 'w';
      this.gameoverTitleEl.textContent =
        snapshot.resultReason === 'timeout' ? t.timeoutTitle : t.checkmateTitle;
      this.gameoverWinnerPillEl.textContent = isWhiteWin ? t.whiteWins : t.blackWins;
      this.gameoverSubtitleEl.textContent = isWhiteWin ? t.whiteWinsSubtitle : t.blackWinsSubtitle;
    }
    this.gameoverModal.classList.remove('hidden');
  }

  /**
   * Starts a match with the current or specified configuration and plays the Opening Cinematic Camera
   * followed automatically by the centered Gameplay Chess Camera.
   */
  public startMatchWithIntro(config?: Partial<GameConfig>): void {
    this.showMainMenu(false);
    this.lobbyModal.classList.add('hidden');
    this.mapSelectModal.classList.add('hidden');
    this.gameoverModal.classList.add('hidden');

    this.engine.startNewGame(config);
    const activeCfg = this.engine.getConfig();
    if (activeCfg.mapId) {
      this.scene.setMap(activeCfg.mapId);
    }

    this.scene.playOpeningCinematic(activeCfg.playerColor, () => {
      this.cameraBtn.textContent = this.getCameraDisplayLabel(this.scene.getCameraPreset());
      if (this.engine.isAITurn()) {
        this.onTriggerAIMove();
      }
    });
  }

  private bindUIEvents(): void {
    // 0. Main Menu Screen Buttons
    document.getElementById('btn-menu-play')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.draftConfig = this.engine.getConfig();
      this.syncLobbyControlsWithDraft();
      this.lobbyModal.classList.remove('hidden');
    });

    document.getElementById('btn-menu-maps')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.syncMapCards();
      this.mapSelectModal.classList.remove('hidden');
    });

    document.getElementById('btn-menu-settings')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.settingsModal.classList.remove('hidden');
    });

    document.getElementById('btn-menu-lang')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.setLanguage(this.lang === 'en' ? 'id' : 'en');
    });

    document.getElementById('btn-menu-credits')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.creditsModal.classList.remove('hidden');
    });

    document.getElementById('btn-skip-intro')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.scene.skipOpeningCinematic();
      this.cameraBtn.textContent = this.getCameraDisplayLabel(this.scene.getCameraPreset());
    });

    // 1. Top-Right HUD Bar: Main Menu, Lobby, Maps, Switch Side, AI Move, New Game
    document.getElementById('btn-main-menu')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.showMainMenu(true);
    });

    document.getElementById('btn-lobby')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.draftConfig = this.engine.getConfig();
      this.syncLobbyControlsWithDraft();
      this.lobbyModal.classList.remove('hidden');
    });

    document.getElementById('btn-maps')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.syncMapCards();
      this.mapSelectModal.classList.remove('hidden');
    });

    this.switchSideBtn.addEventListener('click', () => {
      soundManager.playSelect();
      const current = this.engine.getConfig();
      const nextColor: Color = current.playerColor === 'w' ? 'b' : 'w';
      this.engine.startNewGame({ ...current, playerColor: nextColor });
      this.scene.setCameraPreset('gameplay', false, nextColor);
      this.cameraBtn.textContent = this.getCameraDisplayLabel(this.scene.getCameraPreset());
      if (this.engine.isAITurn()) {
        this.onTriggerAIMove();
      }
    });

    this.aiMoveBtn.addEventListener('click', () => {
      soundManager.playSelect();
      this.onTriggerAIMove();
    });

    document.getElementById('btn-new-game')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.engine.restart();
      this.scene.setCameraPreset('gameplay', false, this.engine.getConfig().playerColor);
      if (this.engine.isAITurn()) {
        this.onTriggerAIMove();
      }
    });

    // 2. Bottom Micro Action Bar: Undo, Restart, Camera, History, Settings
    this.undoBtn.addEventListener('click', () => {
      if (this.aiThinking) return;
      soundManager.playSelect();
      this.engine.undo();
    });

    document.getElementById('btn-restart')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.engine.restart();
      if (this.engine.isAITurn()) {
        this.onTriggerAIMove();
      }
    });

    this.cameraBtn.addEventListener('click', () => {
      soundManager.playSelect();
      const nextPreset = this.scene.cycleCameraPreset();
      this.cameraBtn.textContent = this.getCameraDisplayLabel(nextPreset);
    });

    document.getElementById('btn-history')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.historyDrawer.classList.toggle('hidden');
    });

    document.getElementById('btn-close-history')?.addEventListener('click', () => {
      this.historyDrawer.classList.add('hidden');
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.settingsModal.classList.remove('hidden');
    });

    // 3. Dedicated Map Selection Modal Interactions
    document.getElementById('btn-close-maps')?.addEventListener('click', () => {
      this.mapSelectModal.classList.add('hidden');
    });

    document.querySelectorAll('#map-cards-grid .map-card').forEach((card) => {
      card.addEventListener('click', () => {
        soundManager.playSelect();
        const mapId = (card as HTMLElement).dataset.map as MapId;
        this.draftConfig.mapId = mapId;
        this.engine.setMap(mapId);
        this.scene.setMap(mapId);
        this.syncMapCards();
        this.syncLobbyControlsWithDraft();
      });
    });

    document.getElementById('btn-maps-confirm')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.mapSelectModal.classList.add('hidden');
      if (this.isMainMenuVisible()) {
        this.draftConfig = this.engine.getConfig();
        this.syncLobbyControlsWithDraft();
        this.lobbyModal.classList.remove('hidden');
      }
    });

    // 4. Lobby Modal Interactions
    document.getElementById('btn-close-lobby')?.addEventListener('click', () => {
      this.lobbyModal.classList.add('hidden');
    });
    document.getElementById('btn-lobby-resume')?.addEventListener('click', () => {
      this.lobbyModal.classList.add('hidden');
    });
    document.getElementById('btn-lobby-mainmenu')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.lobbyModal.classList.add('hidden');
      this.showMainMenu(true);
    });

    document.querySelectorAll('#select-mode .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as GameMode;
        this.draftConfig.mode = mode;
        this.syncLobbyControlsWithDraft();
      });
    });

    document.querySelectorAll('#select-color .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = (btn as HTMLElement).dataset.color as Color;
        this.draftConfig.playerColor = color;
        this.syncLobbyControlsWithDraft();
      });
    });

    document.querySelectorAll('#select-difficulty .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const diff = (btn as HTMLElement).dataset.diff as AIDifficulty;
        this.draftConfig.aiDifficulty = diff;
        this.syncLobbyControlsWithDraft();
      });
    });

    document.querySelectorAll('#select-clock .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mins = parseInt((btn as HTMLElement).dataset.clock ?? '0', 10) as TimeControlMinutes;
        this.draftConfig.timeControlMinutes = mins;
        this.syncLobbyControlsWithDraft();
      });
    });

    document.querySelectorAll('#select-lobby-map .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mapId = (btn as HTMLElement).dataset.map as MapId;
        this.draftConfig.mapId = mapId;
        this.scene.setMap(mapId);
        this.syncLobbyControlsWithDraft();
        this.syncMapCards();
      });
    });

    document.querySelectorAll('#select-camera-preset .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cam = (btn as HTMLElement).dataset.cam as CameraPreset;
        this.scene.setCameraPreset(cam);
        this.cameraBtn.textContent = this.getCameraDisplayLabel(cam);
        this.syncLobbyControlsWithDraft();
      });
    });

    document.getElementById('btn-lobby-start')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.startMatchWithIntro(this.draftConfig);
    });

    // 5. Settings Modal Interactions
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.settingsModal.classList.add('hidden');
    });
    document.getElementById('btn-settings-done')?.addEventListener('click', () => {
      this.settingsModal.classList.add('hidden');
    });

    document.querySelectorAll('#select-language .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundManager.playSelect();
        const nextLang = (btn as HTMLElement).dataset.lang as Language;
        this.setLanguage(nextLang);
      });
    });

    document.querySelectorAll('#select-quality .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundManager.playSelect();
        const q = (btn as HTMLElement).dataset.quality as QualityTier;
        this.scene.updateSettings({ quality: q });
        document.querySelectorAll('#select-quality .seg-btn').forEach((b) => {
          b.classList.toggle('active', (b as HTMLElement).dataset.quality === q);
        });
      });
    });

    const volSlider = document.getElementById('slider-volume') as HTMLInputElement;
    volSlider?.addEventListener('input', () => {
      soundManager.setVolume(parseInt(volSlider.value, 10) / 100);
    });

    const musicToggle = document.getElementById('toggle-music') as HTMLInputElement;
    musicToggle?.addEventListener('change', () => {
      soundManager.setMusicEnabled(musicToggle.checked);
    });

    const soundToggle = document.getElementById('toggle-sound') as HTMLInputElement;
    soundToggle?.addEventListener('change', () => {
      soundManager.setSfxEnabled(soundToggle.checked);
    });

    const camSensSlider = document.getElementById('slider-cam-sens') as HTMLInputElement;
    camSensSlider?.addEventListener('input', () => {
      this.scene.updateSettings({ cameraSensitivity: parseInt(camSensSlider.value, 10) / 100 });
    });

    const fxToggle = document.getElementById('toggle-fx') as HTMLInputElement;
    fxToggle?.addEventListener('change', () => {
      this.scene.updateSettings({ magicalFx: fxToggle.checked });
    });

    const motionToggle = document.getElementById('toggle-reduced-motion') as HTMLInputElement;
    motionToggle?.addEventListener('change', () => {
      this.scene.updateSettings({ reducedMotion: motionToggle.checked });
    });

    const coordsToggle = document.getElementById('toggle-coords') as HTMLInputElement;
    coordsToggle?.addEventListener('change', () => {
      this.scene.updateSettings({ showCoordinates: coordsToggle.checked });
    });

    // 6. Credits Modal
    document.getElementById('btn-close-credits')?.addEventListener('click', () => {
      this.creditsModal.classList.add('hidden');
    });
    document.getElementById('btn-credits-close')?.addEventListener('click', () => {
      this.creditsModal.classList.add('hidden');
    });

    // 7. Promotion Modal Buttons
    document.querySelectorAll('#promotion-modal .promo-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const piece = (btn as HTMLElement).dataset.promo as PieceSymbol;
        this.showPromotionModal(false);
        const res = this.engine.completePromotion(piece);
        if (res.valid && res.move) {
          soundManager.playPromote();
          if (this.engine.isAITurn()) {
            this.onTriggerAIMove();
          }
        }
      });
    });

    // 8. Checkmate / Game Over Modal Buttons (Rematch, New Game, Return to Lobby, Review Board)
    document.getElementById('btn-gameover-rematch')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.gameoverModal.classList.add('hidden');
      this.engine.restart();
      this.scene.setCameraPreset('gameplay', false, this.engine.getConfig().playerColor);
      if (this.engine.isAITurn()) {
        this.onTriggerAIMove();
      }
    });

    document.getElementById('btn-gameover-new')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.gameoverModal.classList.add('hidden');
      this.startMatchWithIntro(this.engine.getConfig());
    });

    document.getElementById('btn-gameover-lobby')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.gameoverModal.classList.add('hidden');
      this.draftConfig = this.engine.getConfig();
      this.syncLobbyControlsWithDraft();
      this.lobbyModal.classList.remove('hidden');
    });

    document.getElementById('btn-gameover-review')?.addEventListener('click', () => {
      soundManager.playSelect();
      this.gameoverModal.classList.add('hidden');
    });
  }

  private syncMapCards(): void {
    const activeMap = this.draftConfig.mapId ?? this.engine.getConfig().mapId ?? 'cathedral';
    document.querySelectorAll('#map-cards-grid .map-card').forEach((card) => {
      card.classList.toggle('active', (card as HTMLElement).dataset.map === activeMap);
    });
  }

  private syncLobbyControlsWithDraft(): void {
    document.querySelectorAll('#select-mode .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === this.draftConfig.mode);
    });
    document.querySelectorAll('#select-color .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.color === this.draftConfig.playerColor);
    });
    document.querySelectorAll('#select-difficulty .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.diff === this.draftConfig.aiDifficulty);
    });
    document.querySelectorAll('#select-clock .seg-btn').forEach((b) => {
      b.classList.toggle(
        'active',
        parseInt((b as HTMLElement).dataset.clock ?? '0', 10) === this.draftConfig.timeControlMinutes
      );
    });
    const draftMap = this.draftConfig.mapId ?? 'cathedral';
    document.querySelectorAll('#select-lobby-map .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.map === draftMap);
    });
    document.querySelectorAll('#select-camera-preset .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.cam === this.scene.getCameraPreset());
    });
  }
}
