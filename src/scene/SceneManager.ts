import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Color, GameStateSnapshot, MapId, MoveRecord, PieceSymbol, Square } from '../engine/types';
import { PieceAssetManager } from '../assets/PieceAssetManager';
import type { QualityTier } from '../assets/ProceduralTextures';
import { buildCastleArena, type ArenaElements } from './CastleArenaBuilder';
import { ChessboardBuilder, squareToWorldPosition } from './ChessboardBuilder';
import { AnimationController } from './AnimationController';

export type CameraPreset = 'gameplay' | 'top' | 'cinematic' | 'white' | 'black';

export interface SceneSettings {
  quality: QualityTier;
  reducedMotion: boolean;
  magicalFx: boolean;
  showCoordinates: boolean;
  cameraSensitivity: number;
}

export class SceneManager {
  private readonly container: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;

  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private topFill!: THREE.DirectionalLight;

  private readonly assetManager: PieceAssetManager;
  private readonly chessboard: ChessboardBuilder;
  private arena: ArenaElements;
  private readonly animController: AnimationController;

  private readonly piecesGroup: THREE.Group;
  private readonly pieceObjects = new Map<Square, THREE.Group>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly clock = new THREE.Clock();

  private onSquareSelected: (square: Square) => void;
  private onCinematicStateChange?: (active: boolean) => void;
  private settings: SceneSettings;
  private isMobile: boolean;
  private currentMapId: MapId = 'cathedral';
  private activePlayerColor: Color = 'w';
  private currentPreset: CameraPreset = 'gameplay';
  private menuShowcaseActive = false;

  private cameraTween: {
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    elapsed: number;
    duration: number;
    onComplete?: () => void;
  } | null = null;

  private openingCinematic: {
    elapsed: number;
    duration: number;
    playerColor: Color;
    onComplete?: () => void;
  } | null = null;

  private pointerDownPos = { x: 0, y: 0, time: 0 };
  private isDraggingCamera = false;
  private activeTouchCount = 0;
  private animationFrameId: number | null = null;
  private contextLostBanner: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    onSquareSelected: (square: Square) => void,
    initialSettings?: Partial<SceneSettings>,
    initialMap: MapId = 'cathedral'
  ) {
    this.container = container;
    this.onSquareSelected = onSquareSelected;
    this.currentMapId = initialMap;
    this.isMobile =
      typeof window !== 'undefined' &&
      (window.innerWidth < 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

    this.settings = {
      quality: initialSettings?.quality ?? (this.isMobile ? 'medium' : 'high'),
      reducedMotion: initialSettings?.reducedMotion ?? false,
      magicalFx: initialSettings?.magicalFx ?? true,
      showCoordinates: initialSettings?.showCoordinates ?? false,
      cameraSensitivity: initialSettings?.cameraSensitivity ?? 1.0
    };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c0907');
    this.scene.fog = new THREE.FogExp2('#0c0907', 0.022);

    this.camera = new THREE.PerspectiveCamera(
      38,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      80
    );

    this.initRenderer();
    this.initLighting();
    this.initControls();

    this.assetManager = new PieceAssetManager(this.settings.quality, this.isMobile);
    this.assetManager.applyMapTheme(this.currentMapId);

    this.chessboard = new ChessboardBuilder(this.settings.quality, this.isMobile, this.currentMapId);
    this.chessboard.setCoordinatesVisible(this.settings.showCoordinates);
    this.scene.add(this.chessboard.group);

    this.arena = buildCastleArena(
      this.settings.quality,
      this.isMobile,
      !this.settings.reducedMotion && this.settings.magicalFx,
      this.settings.quality !== 'low',
      this.currentMapId
    );
    this.scene.add(this.arena.group);
    this.applyMapAtmosphere(this.currentMapId);

    this.piecesGroup = new THREE.Group();
    this.piecesGroup.name = 'ChessPiecesGroup';
    this.scene.add(this.piecesGroup);

    this.animController = new AnimationController(this.scene);
    this.animController.setSettings({
      reducedMotion: this.settings.reducedMotion,
      magicalFxEnabled: this.settings.magicalFx
    });

    // Default to centered strategic gameplay camera
    this.setCameraPreset('gameplay', true);

    this.bindEvents();

    // Load GLB assets asynchronously through Three.js GLTFLoader
    void this.assetManager.loadGLBAssets('./models/arcane_pieces.glb');

    this.startLoop();
  }

  public setOnCinematicStateChange(cb: (active: boolean) => void): void {
    this.onCinematicStateChange = cb;
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.settings.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false
    });

    const maxDpr = this.settings.quality === 'high' ? 2.0 : this.settings.quality === 'medium' ? 1.5 : 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight
    );
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Subtle physically based environment reflection (kept low at 0.36 to prevent harsh glare on the board)
    try {
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();
      const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = envTexture;
      this.scene.environmentIntensity = 0.36;
      pmremGenerator.dispose();
    } catch {
      // Fallback if PMREM fails on constrained drivers
    }

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);
  }

  private initLighting(): void {
    // Darker, high-contrast cathedral ambient hemisphere fill
    this.hemiLight = new THREE.HemisphereLight(0xffdcb0, 0x120d0a, 0.32);
    this.hemiLight.position.set(0, 14, 0);
    this.scene.add(this.hemiLight);

    // Dramatic directional key light casting crisp piece & column shadows
    this.keyLight = new THREE.DirectionalLight(0xffd89b, 2.45);
    this.keyLight.position.set(6.2, 11.2, -5.0);
    this.keyLight.castShadow = this.settings.quality !== 'low';

    const shadowMapSize = this.settings.quality === 'high' && !this.isMobile ? 2048 : 1024;
    this.keyLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.keyLight.shadow.camera.near = 2.0;
    this.keyLight.shadow.camera.far = 28.0;
    const d = 6.2;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    // Warm-gold rim light to sculpt dark obsidian armor silhouettes
    this.rimLight = new THREE.DirectionalLight(0xffb866, 0.92);
    this.rimLight.position.set(-7.5, 6.5, 6.5);
    this.scene.add(this.rimLight);

    // Cool moonlight / stained-glass top rim fill
    this.topFill = new THREE.DirectionalLight(0x88b8ff, 0.34);
    this.topFill.position.set(0, 12, -8);
    this.scene.add(this.topFill);
  }

  private applyMapAtmosphere(mapId: MapId): void {
    if (mapId === 'cathedral') {
      this.scene.background = new THREE.Color('#0f0b09');
      this.scene.fog = new THREE.FogExp2('#0f0b09', 0.011);
      this.hemiLight.color.set('#ffe2bc');
      this.hemiLight.groundColor.set('#1c140e');
      this.hemiLight.intensity = 0.50;
      this.keyLight.color.set('#ffd89b');
      this.keyLight.intensity = 2.45;
      this.rimLight.color.set('#ffb866');
      this.topFill.color.set('#88b8ff');
    } else if (mapId === 'warhall') {
      this.scene.background = new THREE.Color('#140908');
      this.scene.fog = new THREE.FogExp2('#140908', 0.011);
      this.hemiLight.color.set('#ffd2a6');
      this.hemiLight.groundColor.set('#22100c');
      this.hemiLight.intensity = 0.48;
      this.keyLight.color.set('#ffca80');
      this.keyLight.intensity = 2.55;
      this.rimLight.color.set('#ff8833');
      this.topFill.color.set('#ffaa66');
    } else if (mapId === 'sanctum') {
      this.scene.background = new THREE.Color('#080b1a');
      this.scene.fog = new THREE.FogExp2('#080b1a', 0.011);
      this.hemiLight.color.set('#b8e4ff');
      this.hemiLight.groundColor.set('#0e1228');
      this.hemiLight.intensity = 0.52;
      this.keyLight.color.set('#d4ecff');
      this.keyLight.intensity = 2.35;
      this.rimLight.color.set('#55ccff');
      this.topFill.color.set('#9966ff');
    }
  }

  /**
   * Switches the active 3D map (`cathedral`, `warhall`, `sanctum`) and updates board, piece, and lighting themes.
   */
  public setMap(mapId: MapId): void {
    if (this.currentMapId === mapId && this.arena) return;
    this.currentMapId = mapId;

    this.scene.remove(this.arena.group);
    this.arena = buildCastleArena(
      this.settings.quality,
      this.isMobile,
      !this.settings.reducedMotion && this.settings.magicalFx,
      this.settings.quality !== 'low',
      mapId
    );
    this.scene.add(this.arena.group);

    this.chessboard.setMapTheme(mapId);
    this.assetManager.applyMapTheme(mapId);
    this.applyMapAtmosphere(mapId);
  }

  public getMap(): MapId {
    return this.currentMapId;
  }

  private initControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55 * this.settings.cameraSensitivity;
    this.controls.zoomSpeed = 0.85 * this.settings.cameraSensitivity;
    this.applyGameplayControlBounds(this.currentPreset);
  }

  /**
   * Enforces strict camera bounds during gameplay so the board stays centered,
   * never becomes a disorienting free-orbit playground, and never clips into walls or pillars.
   */
  private applyGameplayControlBounds(preset: CameraPreset): void {
    if (!this.controls) return;

    // Safe zoom bounds: walls are at ±14.8 and pillars at ±13.6; maxDistance 13.8 keeps camera strictly inside pillars
    this.controls.minDistance = 6.8;
    this.controls.maxDistance = 14.2;

    if (preset === 'gameplay' || preset === 'top') {
      // High-angle / top-down strategic chess view bounds
      this.controls.minPolarAngle = 0.03; // ~2 deg (top-down)
      this.controls.maxPolarAngle = 0.72; // ~41 deg max tilt so board stays comfortable & centered

      // Lock horizontal rotation within ±18 degrees around the active player's side
      const baseAzimuth = this.activePlayerColor === 'w' ? 0 : Math.PI;
      const azimuthAllowance = 0.32;
      if (this.activePlayerColor === 'w') {
        this.controls.minAzimuthAngle = -azimuthAllowance;
        this.controls.maxAzimuthAngle = azimuthAllowance;
      } else {
        // Around Math.PI, OrbitControls wraps at ±Math.PI; keep a controlled window
        this.controls.minAzimuthAngle = Math.PI - azimuthAllowance;
        this.controls.maxAzimuthAngle = Math.PI + azimuthAllowance;
      }
    } else {
      // Restricted dramatic preview preset ('cinematic', 'white', 'black'): allow slightly lower angle but never clip walls
      this.controls.minPolarAngle = 0.05;
      this.controls.maxPolarAngle = Math.PI * 0.43;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      this.controls.maxDistance = 12.2;
    }
  }

  public setMenuShowcaseMode(enabled: boolean): void {
    this.menuShowcaseActive = enabled;
    if (enabled) {
      this.openingCinematic = null;
      this.cameraTween = null;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      this.controls.maxPolarAngle = Math.PI * 0.44;
    } else {
      this.applyGameplayControlBounds(this.currentPreset);
    }
  }

  /**
   * Mode 1: Opening Cinematic Camera.
   * Sweeps across the torches, sculpted armies, and castle hall for ~2.8s at match start,
   * then automatically transitions into the centered Mode 2 Gameplay Chess Camera.
   */
  public playOpeningCinematic(playerColor: Color = 'w', onComplete?: () => void): void {
    this.activePlayerColor = playerColor;
    this.menuShowcaseActive = false;

    if (this.settings.reducedMotion) {
      this.setCameraPreset('gameplay', true);
      onComplete?.();
      return;
    }

    this.cameraTween = null;
    this.controls.enabled = false;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.maxPolarAngle = Math.PI * 0.45;

    this.openingCinematic = {
      elapsed: 0,
      duration: 2.8,
      playerColor,
      onComplete
    };
    this.onCinematicStateChange?.(true);
  }

  /**
   * Immediately skips the Opening Cinematic Camera and snaps/transitions into the centered Gameplay Chess Camera.
   */
  public skipOpeningCinematic(): void {
    if (!this.openingCinematic) return;
    const cb = this.openingCinematic.onComplete;
    this.openingCinematic = null;
    this.controls.enabled = true;
    this.onCinematicStateChange?.(false);
    this.setCameraPreset('gameplay', false);
    cb?.();
  }

  public isOpeningCinematicPlaying(): boolean {
    return this.openingCinematic !== null;
  }

  /**
   * Moves the camera to one of the Wizard Chess camera presets:
   * - `gameplay`: Default centered high-angle strategic chess view (board centered, zero skew)
   * - `top`: Direct vertical overhead view showing full board and flanking fire braziers
   * - `cinematic`: Low three-quarter dramatic showcase perspective
   * - `white` / `black`: Low perspective behind White or Black army
   */
  public setCameraPreset(preset: CameraPreset, immediate = false, playerColor?: Color): void {
    if (playerColor) {
      this.activePlayerColor = playerColor;
    }
    if (this.openingCinematic) {
      this.openingCinematic = null;
      this.controls.enabled = true;
      this.onCinematicStateChange?.(false);
    }

    this.currentPreset = preset;
    let endPos: THREE.Vector3;
    let endTarget: THREE.Vector3;

    const zSign = this.activePlayerColor === 'w' ? 1 : -1;

    switch (preset) {
      case 'gameplay':
        // Centered high-angle strategic chess camera (~26° from vertical, board perfectly centered)
        endPos = new THREE.Vector3(0, 10.8, 5.4 * zSign);
        endTarget = new THREE.Vector3(0, 0, 0);
        break;
      case 'top':
        // Pure centered top-down view showing the full board frame and both fire braziers
        endPos = new THREE.Vector3(0, 14.0, 0.25 * zSign);
        endTarget = new THREE.Vector3(0, 0, 0);
        break;
      case 'cinematic':
        // Dramatic low three-quarter perspective across the board
        endPos = new THREE.Vector3(2.68, 2.24, -4.38);
        endTarget = new THREE.Vector3(-0.32, 0.52, 1.32);
        break;
      case 'black':
        endPos = new THREE.Vector3(-1.35, 2.15, -5.55);
        endTarget = new THREE.Vector3(0, 0.65, 1.2);
        break;
      case 'white':
        endPos = new THREE.Vector3(-2.45, 2.45, 5.35);
        endTarget = new THREE.Vector3(0, 0.52, -1.1);
        break;
    }

    if (immediate || this.settings.reducedMotion) {
      this.cameraTween = null;
      this.applyGameplayControlBounds(preset);
      this.camera.position.copy(endPos);
      this.controls.target.copy(endTarget);
      this.controls.update();
      return;
    }

    // Temporarily relax azimuth limits during tween so transition from cinematic to gameplay never snaps
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.maxPolarAngle = Math.PI * 0.45;

    this.cameraTween = {
      startPos: this.camera.position.clone(),
      endPos,
      startTarget: this.controls.target.clone(),
      endTarget,
      elapsed: 0,
      duration: 0.72,
      onComplete: () => {
        this.applyGameplayControlBounds(preset);
      }
    };
  }

  public getCameraPreset(): CameraPreset {
    return this.currentPreset;
  }

  public cycleCameraPreset(): CameraPreset {
    const order: CameraPreset[] = ['gameplay', 'top', 'cinematic'];
    const idx = order.indexOf(this.currentPreset);
    const next = order[(idx + 1) % order.length];
    this.setCameraPreset(next);
    return next;
  }

  /**
   * Synchronizes the 3D pieces and board highlights with the authoritative `GameStateSnapshot`.
   */
  public syncWithSnapshot(snapshot: GameStateSnapshot, lastMove?: MoveRecord): void {
    this.activePlayerColor = snapshot.config.playerColor;
    if (snapshot.config.mapId && snapshot.config.mapId !== this.currentMapId) {
      this.setMap(snapshot.config.mapId);
    }

    this.chessboard.updateHighlights(
      snapshot.selectedSquare,
      snapshot.legalDestinations,
      snapshot.lastMove,
      snapshot.kingInCheckSquare
    );

    if (lastMove) {
      this.applyAnimatedMove(snapshot, lastMove);
    } else {
      this.rebuildAllPieces(snapshot);
    }

    if (snapshot.isGameOver && snapshot.resultReason === 'checkmate') {
      const losingKingSq = snapshot.kingInCheckSquare;
      if (losingKingSq) {
        const kingObj = this.pieceObjects.get(losingKingSq) ?? null;
        this.animController.triggerCheckmateSequence(kingObj);
      }
    }
  }

  private applyAnimatedMove(snapshot: GameStateSnapshot, move: MoveRecord): void {
    this.animController.flushAllAnimations();

    const movingObj = this.pieceObjects.get(move.from);
    if (!movingObj) {
      this.rebuildAllPieces(snapshot);
      return;
    }

    let capturedObj: THREE.Group | null = null;
    if (move.captured && move.capturedSquare) {
      capturedObj = this.pieceObjects.get(move.capturedSquare) ?? null;
      if (capturedObj) {
        this.pieceObjects.delete(move.capturedSquare);
      }
    }

    let castlingRookObj: THREE.Group | null = null;
    if (move.castling) {
      castlingRookObj = this.pieceObjects.get(move.castling.rookFrom) ?? null;
      if (castlingRookObj) {
        this.pieceObjects.delete(move.castling.rookFrom);
        this.pieceObjects.set(move.castling.rookTo, castlingRookObj);
        this.assetManager.tagPieceMetadata(castlingRookObj, 'r', move.color, move.castling.rookTo);
      }
    }

    this.pieceObjects.delete(move.from);

    if (move.promotion) {
      this.piecesGroup.remove(movingObj);
      const promotedObj = this.assetManager.createPieceInstance(
        move.promotion,
        move.color,
        move.to,
        this.settings.quality !== 'low'
      );
      promotedObj.position.copy(squareToWorldPosition(move.from, 0));
      this.piecesGroup.add(promotedObj);
      this.pieceObjects.set(move.to, promotedObj);

      this.animController.animateMove(promotedObj, move, capturedObj, castlingRookObj);
    } else {
      this.pieceObjects.set(move.to, movingObj);
      this.assetManager.tagPieceMetadata(movingObj, move.piece, move.color, move.to);
      this.animController.animateMove(movingObj, move, capturedObj, castlingRookObj);
    }
  }

  public rebuildAllPieces(snapshot: GameStateSnapshot): void {
    this.animController.flushAllAnimations();

    for (const obj of this.pieceObjects.values()) {
      this.piecesGroup.remove(obj);
    }
    this.pieceObjects.clear();

    const fenBoard = snapshot.fen.split(' ')[0];
    const rows = fenBoard.split('/');
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    for (let r = 0; r < 8; r++) {
      const rankNum = 8 - r;
      let fileIdx = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          fileIdx += parseInt(ch, 10);
        } else {
          const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
          const type = ch.toLowerCase() as PieceSymbol;
          const square = `${files[fileIdx]}${rankNum}` as Square;

          const pieceObj = this.assetManager.createPieceInstance(
            type,
            color,
            square,
            this.settings.quality !== 'low'
          );
          pieceObj.position.copy(squareToWorldPosition(square, 0));
          this.piecesGroup.add(pieceObj);
          this.pieceObjects.set(square, pieceObj);
          fileIdx++;
        }
      }
    }
  }

  public updateSettings(partial: Partial<SceneSettings>): void {
    const prevQuality = this.settings.quality;
    this.settings = { ...this.settings, ...partial };
    this.chessboard.setCoordinatesVisible(this.settings.showCoordinates);
    this.animController.setSettings({
      reducedMotion: this.settings.reducedMotion,
      magicalFxEnabled: this.settings.magicalFx
    });
    if (this.controls) {
      this.controls.rotateSpeed = 0.55 * this.settings.cameraSensitivity;
      this.controls.zoomSpeed = 0.85 * this.settings.cameraSensitivity;
    }
    if (this.arena.embers) {
      this.arena.embers.visible = !this.settings.reducedMotion && this.settings.magicalFx;
    }
    if (partial.quality && partial.quality !== prevQuality) {
      const maxDpr = this.settings.quality === 'high' ? 2.0 : this.settings.quality === 'medium' ? 1.5 : 1.0;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
      this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
      this.keyLight.castShadow = this.settings.quality !== 'low';
    }
  }

  public getSettings(): SceneSettings {
    return { ...this.settings };
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener(
      'touchstart',
      (e) => {
        this.activeTouchCount = e.touches.length;
        if (this.activeTouchCount > 1) {
          this.isDraggingCamera = true;
        }
      },
      { passive: true }
    );

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
      this.isDraggingCamera = this.activeTouchCount > 1;
      if (this.openingCinematic) {
        this.skipOpeningCinematic();
        return;
      }
      if (this.cameraTween) {
        const done = this.cameraTween.onComplete;
        this.cameraTween = null;
        done?.();
      }
    });

    dom.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (dx * dx + dy * dy > 36) {
        this.isDraggingCamera = true;
      }
    });

    dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      const elapsed = performance.now() - this.pointerDownPos.time;

      if (!this.isDraggingCamera && dx * dx + dy * dy <= 36 && elapsed < 650) {
        this.handleCanvasTap(e.clientX, e.clientY);
      }
      this.activeTouchCount = 0;
    });

    window.addEventListener('resize', this.handleResize);

    dom.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.showContextLossBanner(true);
    });

    dom.addEventListener('webglcontextrestored', () => {
      this.showContextLossBanner(false);
      this.startLoop();
    });
  }

  private showContextLossBanner(visible: boolean): void {
    if (visible) {
      if (!this.contextLostBanner) {
        const div = document.createElement('div');
        div.className = 'webgl-context-banner';
        div.textContent = 'Restoring 3D Arcane Sanctuary graphics context...';
        this.container.appendChild(div);
        this.contextLostBanner = div;
      }
    } else if (this.contextLostBanner) {
      this.contextLostBanner.remove();
      this.contextLostBanner = null;
    }
  }

  private handleCanvasTap(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const targets: THREE.Object3D[] = [this.piecesGroup, this.chessboard.group];
    const hits = this.raycaster.intersectObjects(targets, true);

    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData?.square) {
          this.onSquareSelected(obj.userData.square as Square);
          return;
        }
        obj = obj.parent;
      }
    }
  }

  public handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1.0 ? Math.min(58, 38 / Math.pow(aspect, 0.48)) : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private startLoop(): void {
    if (this.animationFrameId !== null) return;
    this.clock.start();

    const tick = () => {
      this.animationFrameId = requestAnimationFrame(tick);
      const delta = Math.min(0.1, this.clock.getDelta());
      const elapsed = this.clock.elapsedTime;

      // 1. Update Main Menu slow background showcase camera
      if (this.menuShowcaseActive && !this.openingCinematic && !this.cameraTween) {
        const angle = elapsed * 0.14 + 0.55;
        const radius = 5.4;
        this.camera.position.set(
          Math.sin(angle) * radius,
          2.65 + Math.sin(elapsed * 0.28) * 0.35,
          Math.cos(angle) * radius
        );
        this.controls.target.set(0, 0.45, 0);
        this.controls.update();
      }
      // 2. Update Mode 1: Opening Cinematic Camera sequence
      else if (this.openingCinematic) {
        this.openingCinematic.elapsed += delta;
        const p = Math.min(1, this.openingCinematic.elapsed / this.openingCinematic.duration);
        const zSign = this.openingCinematic.playerColor === 'w' ? 1 : -1;

        if (p < 0.55) {
          // Shot 1: Wide orbital cinematic sweep around the outside of the board, framing both armies, fire braziers, and cathedral walls
          const s = p / 0.55;
          const easeS = s * s * (3 - 2 * s);
          const startAngle = zSign > 0 ? 2.58 : -0.56;
          const endAngle = zSign > 0 ? 0.52 : -2.62;
          const angle = startAngle + (endAngle - startAngle) * easeS;
          const radius = 5.35 + Math.sin(s * Math.PI) * 0.45;
          this.camera.position.set(
            Math.sin(angle) * radius,
            2.18 + easeS * 0.85,
            Math.cos(angle) * radius
          );

          const t0 = new THREE.Vector3(-0.25, 0.55, 0.85 * zSign);
          const t1 = new THREE.Vector3(0, 0.38, 0);
          this.controls.target.lerpVectors(t0, t1, easeS);
        } else {
          // Shot 2: Smooth ascent from orbital angle into the centered Mode 2 Gameplay Chess Camera
          const s = (p - 0.55) / 0.45;
          const easeS = 1 - Math.pow(1 - s, 3);
          const endAngle = zSign > 0 ? 0.52 : -2.62;
          const p1 = new THREE.Vector3(Math.sin(endAngle) * 5.35, 3.03, Math.cos(endAngle) * 5.35);
          const pEnd = new THREE.Vector3(0, 10.8, 5.4 * zSign);
          this.camera.position.lerpVectors(p1, pEnd, easeS);

          const t1 = new THREE.Vector3(0, 0.38, 0);
          const tEnd = new THREE.Vector3(0, 0, 0);
          this.controls.target.lerpVectors(t1, tEnd, easeS);
        }
        this.camera.lookAt(this.controls.target);

        if (p >= 1) {
          const cb = this.openingCinematic.onComplete;
          this.openingCinematic = null;
          this.controls.enabled = true;
          this.currentPreset = 'gameplay';
          this.applyGameplayControlBounds('gameplay');
          this.controls.update();
          this.onCinematicStateChange?.(false);
          cb?.();
        }
      }
      // 3. Update smooth camera preset transitions
      else if (this.cameraTween) {
        this.cameraTween.elapsed += delta;
        const rawT = Math.min(1, this.cameraTween.elapsed / this.cameraTween.duration);
        const ease = 1 - Math.pow(1 - rawT, 3);
        this.camera.position.lerpVectors(this.cameraTween.startPos, this.cameraTween.endPos, ease);
        this.controls.target.lerpVectors(this.cameraTween.startTarget, this.cameraTween.endTarget, ease);
        this.controls.update();
        if (rawT >= 1) {
          const done = this.cameraTween.onComplete;
          this.cameraTween = null;
          done?.();
          this.controls.update();
        }
      } else {
        this.controls.update();
      }

      // 4. Update piece animations, AnimationMixers, and capture effects
      this.animController.update(delta, this.pieceObjects.values());
      this.chessboard.animateHighlights(elapsed, delta);

      // 5. Animate realistic layered fire braziers, rising sparks, and Arcane Sanctum levitating crystals
      if (!this.settings.reducedMotion) {
        for (const b of this.arena.braziers) {
          const flicker =
            Math.sin(elapsed * 8.2 + b.phase) * 0.14 +
            Math.cos(elapsed * 14.5 + b.phase * 1.7) * 0.09;
          if (b.light) {
            b.light.intensity = b.baseIntensity * (1.0 + flicker);
          }

          b.coreGlow.scale.setScalar(1.0 + flicker * 0.35);

          for (const layer of b.flameLayers) {
            const idx = (layer.userData.layerIdx as number) ?? 0;
            const baseSX = (layer.userData.baseScaleX as number) ?? 1.0;
            const baseSY = (layer.userData.baseScaleY as number) ?? 1.0;
            const wave = Math.sin(elapsed * (9.5 + idx * 1.3) + b.phase + idx);
            const stretchY = 1.0 + wave * 0.22 + flicker * 0.35;
            const pinchX = 1.0 - wave * 0.12;
            layer.scale.set(baseSX * pinchX, baseSY * stretchY, 1.0);

            if (layer.userData.isTopPetal) {
              layer.rotation.z = (layer.userData.baseRotY as number) + elapsed * (idx % 2 === 0 ? 0.6 : -0.6);
            } else {
              layer.rotation.z = Math.sin(elapsed * 6.5 + idx * 1.4) * 0.11;
            }
          }

          if (b.sparks) {
            const posAttr = b.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
            for (let s = 0; s < posAttr.count; s++) {
              let py = posAttr.getY(s) + delta * (1.1 + (s % 4) * 0.25);
              if (py > 3.1) py = 0.85;
              posAttr.setY(s, py);
            }
            posAttr.needsUpdate = true;
            b.sparks.rotation.y = elapsed * 0.8;
          }
        }

        for (const c of this.arena.floatingCrystals) {
          c.mesh.position.y = c.baseY + Math.sin(elapsed * 1.8 + c.phase) * 0.28;
          c.mesh.rotation.y = elapsed * 0.45 + c.phase;
          const ring = c.mesh.getObjectByName('astrolabe_ring');
          if (ring) {
            ring.rotation.z = elapsed * 1.2;
          }
        }

        if (this.arena.embers && this.arena.embers.visible) {
          this.arena.embers.rotation.y = elapsed * 0.035;
        }
      }

      this.renderer.render(this.scene, this.camera);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
