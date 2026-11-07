import * as THREE from 'three';
import type { LegalDestination, MapId, Square } from '../engine/types';
import {
  createArcaneSigilTexture,
  createCoordinateLabelTexture,
  createMarbleTextures,
  createRuneBoardFrameTexture,
  getAdaptiveTextureSize,
  type QualityTier
} from '../assets/ProceduralTextures';

export const TILE_SIZE = 1.0;

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export function squareToWorldPosition(square: Square, y = 0): THREE.Vector3 {
  const fileIdx = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rankIdx = RANKS.indexOf(square[1] as (typeof RANKS)[number]);
  const x = (fileIdx - 3.5) * TILE_SIZE;
  const z = (3.5 - rankIdx) * TILE_SIZE;
  return new THREE.Vector3(x, y, z);
}

export function worldPositionToSquare(x: number, z: number): Square | null {
  const fileIdx = Math.floor(x / TILE_SIZE + 4);
  const rankIdx = Math.floor(4 - z / TILE_SIZE);
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) {
    return null;
  }
  return `${FILES[fileIdx]}${RANKS[rankIdx]}` as Square;
}

export class ChessboardBuilder {
  public readonly group: THREE.Group;
  public readonly tileMeshes = new Map<Square, THREE.Mesh>();
  private readonly highlightGroup: THREE.Group;
  private readonly coordinatesGroup: THREE.Group;
  private readonly activeHighlights: THREE.Object3D[] = [];

  private readonly lightTileMat: THREE.MeshPhysicalMaterial;
  private readonly darkTileMat: THREE.MeshPhysicalMaterial;
  private readonly goldTrimMat: THREE.MeshStandardMaterial;
  private readonly runeFrameMat: THREE.MeshPhysicalMaterial;

  private readonly sigilQuietTex: THREE.Texture;
  private readonly sigilCaptureTex: THREE.Texture;
  private readonly sigilSelectedTex: THREE.Texture;
  private readonly sigilCheckTex: THREE.Texture;

  private texSize: number;
  private readonly isMobile: boolean;
  private quality: QualityTier;
  private currentMap: MapId;

  constructor(quality: QualityTier = 'high', isMobile = false, initialMap: MapId = 'cathedral') {
    this.group = new THREE.Group();
    this.group.name = 'WizardChessBoard';
    this.isMobile = isMobile;
    this.quality = quality;
    this.currentMap = initialMap;
    this.texSize = getAdaptiveTextureSize(quality, isMobile);

    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'BoardHighlights';

    this.coordinatesGroup = new THREE.Group();
    this.coordinatesGroup.name = 'BoardCoordinates';

    const whiteMarble = createMarbleTextures('white', Math.min(512, this.texSize), initialMap);
    const blackMarble = createMarbleTextures('black', Math.min(512, this.texSize), initialMap);

    // Satin-matte board surface (roughness ~0.46, minimal clearcoat ~0.06) to prevent harsh specular glare
    this.lightTileMat = new THREE.MeshPhysicalMaterial({
      name: 'LightSquareMarble',
      color: new THREE.Color('#dfd7c8'),
      map: whiteMarble.map,
      roughnessMap: whiteMarble.roughnessMap,
      roughness: 0.46,
      metalness: 0.02,
      clearcoat: 0.06,
      clearcoatRoughness: 0.42
    });

    this.darkTileMat = new THREE.MeshPhysicalMaterial({
      name: 'DarkSquareObsidian',
      color: new THREE.Color('#161922'),
      map: blackMarble.map,
      roughnessMap: blackMarble.roughnessMap,
      roughness: 0.44,
      metalness: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.38
    });

    this.goldTrimMat = new THREE.MeshStandardMaterial({
      name: 'BoardGoldFrame',
      color: new THREE.Color('#d29a30'),
      roughness: 0.32,
      metalness: 0.86
    });

    const runeFrameTex = createRuneBoardFrameTexture(this.isMobile ? 1024 : 2048, initialMap);
    this.runeFrameMat = new THREE.MeshPhysicalMaterial({
      name: 'RuneVeinedBlackMarbleFrame',
      map: runeFrameTex,
      roughness: 0.38,
      metalness: 0.10,
      clearcoat: 0.14,
      clearcoatRoughness: 0.32
    });

    const darkBaseMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#090a0e'),
      roughness: 0.45,
      metalness: 0.35
    });

    // 1. Wide Veined-Stone & Golden Elder-Futhark / War-Table / Sanctum Outer Frame Slab
    const runeSlab = new THREE.Mesh(new THREE.BoxGeometry(11.1, 0.22, 11.1), [
      darkBaseMat,
      darkBaseMat,
      this.runeFrameMat,
      darkBaseMat,
      darkBaseMat,
      darkBaseMat
    ]);
    runeSlab.position.y = -0.118;
    runeSlab.receiveShadow = true;
    runeSlab.castShadow = true;
    this.group.add(runeSlab);

    // 2. Inner Solid Metallic Gold Frame Collar immediately surrounding the 8x8 squares
    const goldInnerBed = new THREE.Mesh(new THREE.BoxGeometry(8.28, 0.22, 8.28), this.goldTrimMat);
    goldInnerBed.position.y = -0.116;
    goldInnerBed.receiveShadow = true;
    this.group.add(goldInnerBed);

    // Dark recessed seam bed beneath the 64 tiles so each tile has a crisp physical groove around it
    const seamBed = new THREE.Mesh(new THREE.BoxGeometry(8.02, 0.22, 8.02), darkBaseMat);
    seamBed.position.y = -0.115;
    this.group.add(seamBed);

    // 3. 64 Individual Satin-Matte Marble Squares (`a1`..`h8`) whose top surface sits at y = 0.000
    const tileGeo = new THREE.BoxGeometry(TILE_SIZE * 0.988, 0.05, TILE_SIZE * 0.988);

    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const square = `${FILES[f]}${RANKS[r]}` as Square;
        const isLight = (f + r) % 2 === 1;
        const tileMesh = new THREE.Mesh(tileGeo, isLight ? this.lightTileMat : this.darkTileMat);

        const pos = squareToWorldPosition(square, -0.025);
        tileMesh.position.copy(pos);
        tileMesh.receiveShadow = true;
        tileMesh.name = `tile_${square}`;
        tileMesh.userData = {
          isBoardSquare: true,
          square,
          isLight
        };

        this.tileMeshes.set(square, tileMesh);
        this.group.add(tileMesh);
      }
    }

    // 4. Algebraic Coordinate Plaques (toggleable via settings)
    this.buildCoordinateLabels();
    this.coordinatesGroup.visible = false;
    this.group.add(this.coordinatesGroup);

    this.sigilQuietTex = createArcaneSigilTexture('quiet');
    this.sigilCaptureTex = createArcaneSigilTexture('capture');
    this.sigilSelectedTex = createArcaneSigilTexture('selected');
    this.sigilCheckTex = createArcaneSigilTexture('check');

    this.group.add(this.highlightGroup);
    this.applyQualityMaterialSettings();
  }

  public setQuality(quality: QualityTier): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.texSize = getAdaptiveTextureSize(quality, this.isMobile);
    this.setMapTheme(this.currentMap);
    this.applyQualityMaterialSettings();
  }

  private applyQualityMaterialSettings(): void {
    if (this.quality === 'low') {
      // True Low Graphics Mode: completely non-reflective matte board & frame, zero clearcoat, zero envMap
      this.lightTileMat.roughness = 0.96;
      this.lightTileMat.metalness = 0.0;
      this.lightTileMat.clearcoat = 0.0;
      this.lightTileMat.envMapIntensity = 0.0;

      this.darkTileMat.roughness = 0.94;
      this.darkTileMat.metalness = 0.0;
      this.darkTileMat.clearcoat = 0.0;
      this.darkTileMat.envMapIntensity = 0.0;

      this.runeFrameMat.roughness = 0.95;
      this.runeFrameMat.metalness = 0.0;
      this.runeFrameMat.clearcoat = 0.0;
      this.runeFrameMat.envMapIntensity = 0.0;

      this.goldTrimMat.roughness = 0.65;
      this.goldTrimMat.metalness = 0.35;
      this.goldTrimMat.envMapIntensity = 0.0;
    } else if (this.quality === 'medium') {
      this.lightTileMat.roughness = 0.54;
      this.lightTileMat.metalness = 0.02;
      this.lightTileMat.clearcoat = 0.05;
      this.lightTileMat.envMapIntensity = 0.22;

      this.darkTileMat.roughness = 0.50;
      this.darkTileMat.metalness = 0.06;
      this.darkTileMat.clearcoat = 0.06;
      this.darkTileMat.envMapIntensity = 0.22;

      this.runeFrameMat.roughness = 0.48;
      this.runeFrameMat.metalness = 0.08;
      this.runeFrameMat.clearcoat = 0.08;
      this.runeFrameMat.envMapIntensity = 0.22;

      this.goldTrimMat.roughness = 0.36;
      this.goldTrimMat.metalness = 0.80;
      this.goldTrimMat.envMapIntensity = 0.24;
    } else {
      // High Graphics Mode: rich polished stone with subtle reflections
      this.lightTileMat.roughness = 0.38;
      this.lightTileMat.metalness = 0.03;
      this.lightTileMat.clearcoat = 0.14;
      this.lightTileMat.envMapIntensity = 0.38;

      this.darkTileMat.roughness = 0.34;
      this.darkTileMat.metalness = 0.10;
      this.darkTileMat.clearcoat = 0.18;
      this.darkTileMat.envMapIntensity = 0.42;

      this.runeFrameMat.roughness = 0.32;
      this.runeFrameMat.metalness = 0.12;
      this.runeFrameMat.clearcoat = 0.18;
      this.runeFrameMat.envMapIntensity = 0.38;

      this.goldTrimMat.roughness = 0.28;
      this.goldTrimMat.metalness = 0.88;
      this.goldTrimMat.envMapIntensity = 0.40;
    }

    this.lightTileMat.needsUpdate = true;
    this.darkTileMat.needsUpdate = true;
    this.runeFrameMat.needsUpdate = true;
    this.goldTrimMat.needsUpdate = true;
  }

  /**
   * Updates the chessboard's marble tiles, metallic trim, and outer frame texture for the selected map.
   */
  public setMapTheme(mapId: MapId): void {
    this.currentMap = mapId;
    const res = this.quality === 'low' ? 128 : Math.min(512, this.texSize);
    const whiteMarble = createMarbleTextures('white', res, mapId);
    const blackMarble = createMarbleTextures('black', res, mapId);

    this.lightTileMat.map = whiteMarble.map;
    this.lightTileMat.roughnessMap = this.quality === 'low' ? null : whiteMarble.roughnessMap;
    this.darkTileMat.map = blackMarble.map;
    this.darkTileMat.roughnessMap = this.quality === 'low' ? null : blackMarble.roughnessMap;

    if (mapId === 'classic') {
      this.lightTileMat.color.set('#f2ece0');
      this.darkTileMat.color.set('#221c18');
      this.goldTrimMat.color.set('#c49a45');
      this.coordinatesGroup.visible = true;
    } else if (mapId === 'cathedral') {
      this.lightTileMat.color.set('#dfd7c8');
      this.darkTileMat.color.set('#161922');
      this.goldTrimMat.color.set('#d29a30');
    } else if (mapId === 'warhall') {
      this.lightTileMat.color.set('#d8c8ae');
      this.darkTileMat.color.set('#1d1614');
      this.goldTrimMat.color.set('#c48428');
    } else if (mapId === 'sanctum') {
      this.lightTileMat.color.set('#d2dced');
      this.darkTileMat.color.set('#121526');
      this.goldTrimMat.color.set('#cfa842');
    }

    const frameRes = this.quality === 'low' ? 512 : this.isMobile || this.quality === 'medium' ? 1024 : 2048;
    const frameTex = createRuneBoardFrameTexture(frameRes, mapId);
    this.runeFrameMat.map = frameTex;

    this.lightTileMat.needsUpdate = true;
    this.darkTileMat.needsUpdate = true;
    this.runeFrameMat.needsUpdate = true;
  }

  private buildCoordinateLabels(): void {
    const labelGeo = new THREE.PlaneGeometry(0.32, 0.32);
    labelGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 8; i++) {
      const fileChar = FILES[i];
      const fileTex = createCoordinateLabelTexture(fileChar);
      const fileMat = new THREE.MeshBasicMaterial({ map: fileTex, transparent: true, depthWrite: false });

      const frontLabel = new THREE.Mesh(labelGeo, fileMat);
      frontLabel.position.set((i - 3.5) * TILE_SIZE, 0.008, 4.32 * TILE_SIZE);
      this.coordinatesGroup.add(frontLabel);

      const rankChar = RANKS[i];
      const rankTex = createCoordinateLabelTexture(rankChar);
      const rankMat = new THREE.MeshBasicMaterial({ map: rankTex, transparent: true, depthWrite: false });

      const leftLabel = new THREE.Mesh(labelGeo, rankMat);
      leftLabel.position.set(-4.32 * TILE_SIZE, 0.008, (3.5 - i) * TILE_SIZE);
      this.coordinatesGroup.add(leftLabel);
    }
  }

  public setCoordinatesVisible(visible: boolean): void {
    this.coordinatesGroup.visible = visible;
  }

  /**
   * Synchronizes board square highlights (selected piece, legal quiet moves, legal captures, last move, and King in check).
   */
  public updateHighlights(
    selectedSquare: Square | null,
    legalDestinations: LegalDestination[],
    lastMove: { from: Square; to: Square } | null,
    kingInCheckSquare: Square | null
  ): void {
    while (this.highlightGroup.children.length > 0) {
      const child = this.highlightGroup.children[0];
      this.highlightGroup.remove(child);
    }
    this.activeHighlights.length = 0;

    // 1. Last move subtle golden border squares
    if (lastMove) {
      for (const sq of [lastMove.from, lastMove.to]) {
        const ringGeo = new THREE.RingGeometry(0.38, 0.46, 4);
        ringGeo.rotateX(-Math.PI / 2);
        ringGeo.rotateY(Math.PI / 4);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf5c249,
          transparent: true,
          opacity: 0.45,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(ringGeo, ringMat);
        mesh.position.copy(squareToWorldPosition(sq, 0.007));
        this.highlightGroup.add(mesh);
      }
    }

    // 2. Selected square golden arcane sigil
    if (selectedSquare) {
      const planeGeo = new THREE.PlaneGeometry(0.94, 0.94);
      planeGeo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: this.sigilSelectedTex,
        transparent: true,
        opacity: 0.92,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.copy(squareToWorldPosition(selectedSquare, 0.009));
      mesh.userData = { spinSpeed: 0.6 };
      this.highlightGroup.add(mesh);
      this.activeHighlights.push(mesh);
    }

    // 3. Legal destinations (quiet moves vs captures)
    for (const dest of legalDestinations) {
      const isCap = dest.isCapture;
      const size = isCap ? 0.96 : 0.72;
      const planeGeo = new THREE.PlaneGeometry(size, size);
      planeGeo.rotateX(-Math.PI / 2);

      const mat = new THREE.MeshBasicMaterial({
        map: isCap ? this.sigilCaptureTex : this.sigilQuietTex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      });

      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.copy(squareToWorldPosition(dest.square, 0.011));
      mesh.userData = {
        isBoardSquare: true,
        square: dest.square,
        spinSpeed: isCap ? -1.4 : 0.9,
        pulse: true
      };
      this.highlightGroup.add(mesh);
      this.activeHighlights.push(mesh);
    }

    // 4. King in Check crimson danger sigil
    if (kingInCheckSquare) {
      const planeGeo = new THREE.PlaneGeometry(1.02, 1.02);
      planeGeo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: this.sigilCheckTex,
        transparent: true,
        opacity: 0.96,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.copy(squareToWorldPosition(kingInCheckSquare, 0.012));
      mesh.userData = { spinSpeed: 2.0, pulse: true };
      this.highlightGroup.add(mesh);
      this.activeHighlights.push(mesh);
    }
  }

  public animateHighlights(elapsedTime: number, delta: number): void {
    for (const obj of this.activeHighlights) {
      const spin = obj.userData.spinSpeed ?? 0;
      if (spin !== 0) {
        obj.rotation.y += spin * delta;
      }
      if (obj.userData.pulse) {
        const s = 1.0 + Math.sin(elapsedTime * 4.2) * 0.06;
        obj.scale.set(s, 1, s);
      }
    }
  }
}
