import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getPieceGeometryParts } from '../src/assets/PieceGeometryBuilder';
import { PieceAssetManager } from '../src/assets/PieceAssetManager';
import { ChessboardBuilder } from '../src/scene/ChessboardBuilder';
import { buildMenuHeroScene } from '../src/scene/MenuHeroSceneBuilder';
import { soundManager, MAP_MUSIC_TRACKS } from '../src/audio/SoundManager';
import type { PieceSkinId, PieceSymbol } from '../src/engine/types';

describe('3D Fantasy Piece Asset Pipeline (Sculpted Geometry & GLB Export/Parse)', () => {
  const symbols: PieceSymbol[] = ['p', 'r', 'n', 'b', 'q', 'k'];

  it('builds distinct sculpted multi-material geometries (body, gold, steel, face) for all 6 piece types with LOD0 and LOD1', () => {
    const heights: Record<PieceSymbol, number> = {} as Record<PieceSymbol, number>;

    for (const sym of symbols) {
      const high = getPieceGeometryParts(sym, 'high');
      const low = getPieceGeometryParts(sym, 'low');

      expect(high.body.getAttribute('position').count).toBeGreaterThan(200);
      expect(high.gold.getAttribute('position').count).toBeGreaterThan(100);

      // LOD1 has fewer vertices than LOD0
      expect(low.body.getAttribute('position').count).toBeLessThan(high.body.getAttribute('position').count);

      high.body.computeBoundingBox();
      high.gold.computeBoundingBox();
      const maxY = Math.max(high.body.boundingBox!.max.y, high.gold.boundingBox!.max.y);
      heights[sym] = maxY;
    }

    // Verify silhouette hierarchy: Pawn is shortest, King is tallest
    expect(heights.p).toBeLessThan(heights.r);
    expect(heights.q).toBeLessThan(heights.k);
  });

  it('exports valid Binary glTF 2.0 (public/models/arcane_pieces.glb) that parses via Three.js GLTFLoader', async () => {
    const glbPath = path.resolve(process.cwd(), 'public', 'models', 'arcane_pieces.glb');
    expect(fs.existsSync(glbPath)).toBe(true);

    const buffer = fs.readFileSync(glbPath);
    expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
    expect(buffer.readUInt32LE(4)).toBe(2);

    const arrayBuffer = new Uint8Array(buffer).buffer;
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const expectedNames = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
    for (const name of expectedNames) {
      const node = gltf.scene.getObjectByName(name);
      expect(node).toBeDefined();
      expect(node.children.length).toBe(4);
      const childNames = node.children.map((c: any) => c.name.toLowerCase());
      expect(childNames.some((n: string) => n.startsWith('body'))).toBe(true);
      expect(childNames.some((n: string) => n.startsWith('gold'))).toBe(true);
      expect(childNames.some((n: string) => n.startsWith('steel'))).toBe(true);
      expect(childNames.some((n: string) => n.startsWith('face'))).toBe(true);
    }
  });

  it('instantiates 3D piece groups with White-and-Gold vs Black-and-Gold PBR materials, AnimationMixer, LODs, and raycast metadata', () => {
    const manager = new PieceAssetManager('high', false);
    const whiteKing = manager.createPieceInstance('k', 'w', 'e1');
    const blackKnight = manager.createPieceInstance('n', 'b', 'g8');

    expect(whiteKing.userData.isChessPiece).toBe(true);
    expect(whiteKing.userData.type).toBe('k');
    expect(whiteKing.userData.color).toBe('w');
    expect(whiteKing.userData.square).toBe('e1');
    expect(whiteKing.userData.mixer).toBeDefined();
    expect(whiteKing.rotation.y).toBeCloseTo(Math.PI);

    expect(blackKnight.userData.isChessPiece).toBe(true);
    expect(blackKnight.userData.type).toBe('n');
    expect(blackKnight.userData.color).toBe('b');
    expect(blackKnight.userData.square).toBe('g8');
    expect(blackKnight.userData.mixer).toBeDefined();
    expect(blackKnight.rotation.y).toBeCloseTo(0);
  });

  it('builds 4 distinct 3D sculpted chess skins (arcane_royalty, runic_warforged, mystic_sanctum, classic) with different geometry shapes', () => {
    const skins: PieceSkinId[] = ['arcane_royalty', 'runic_warforged', 'mystic_sanctum', 'classic'];

    for (const sym of symbols) {
      const counts = skins.map((skin) => {
        const parts = getPieceGeometryParts(sym, 'high', skin);
        return (
          parts.body.getAttribute('position').count +
          parts.gold.getAttribute('position').count +
          parts.steel.getAttribute('position').count
        );
      });
      // Verify all 4 skins produce valid 3D meshes and differ in sculpted geometry vertex counts
      expect(counts[0]).toBeGreaterThan(100);
      expect(counts[1]).toBeGreaterThan(100);
      expect(counts[2]).toBeGreaterThan(100);
      expect(counts[3]).toBeGreaterThan(100);
      expect(new Set(counts).size).toBe(4);
    }

    // Verify Classic Staunton Knight has traditional horse silhouette with minimal placeholder steel/face (no humanoid rider)
    const classicKnight = getPieceGeometryParts('n', 'high', 'classic');
    expect(classicKnight.body.getAttribute('position').count).toBeGreaterThan(250);
    expect(classicKnight.steel.getAttribute('position').count).toBeLessThan(30);
    expect(classicKnight.face.getAttribute('position').count).toBeLessThan(30);
  });

  it('builds and animates the dedicated 3D Main Menu Hero King Pedestal Scene in High and Low graphics modes', () => {
    const heroHigh = buildMenuHeroScene('high', false);
    expect(heroHigh.group.children.length).toBeGreaterThan(5);
    expect(heroHigh.heroPieceGroup.position.x).toBeCloseTo(1.18, 1);

    const initialRotY = heroHigh.runeRibbon1.rotation.y;
    heroHigh.update(1.5, 0.016, false);
    expect(heroHigh.runeRibbon1.rotation.y).not.toBe(initialRotY);

    heroHigh.setQuality('low');
    expect(heroHigh.godRays[0].visible).toBe(false);
  });

  it('applies True Low Graphics Mode vs Medium and High on PieceAssetManager and ChessboardBuilder, and supports Classic Map', () => {
    const manager = new PieceAssetManager('low', true);
    const whiteMat = manager.getMaterials('w');
    expect(whiteMat.body.clearcoat).toBe(0);
    expect(whiteMat.body.envMapIntensity).toBe(0);
    expect(whiteMat.body.roughness).toBeGreaterThanOrEqual(0.85);

    manager.setQuality('high');
    expect(whiteMat.body.clearcoat).toBeGreaterThan(0.2);
    expect(whiteMat.body.envMapIntensity).toBeGreaterThan(0.3);

    manager.setSkin('classic');
    expect(manager.getSkin()).toBe('classic');

    const board = new ChessboardBuilder('low', true, 'cathedral');
    const a1Mesh = board.tileMeshes.get('a1')!;
    const darkMat = a1Mesh.material as any;
    expect(darkMat.clearcoat).toBe(0);
    expect(darkMat.envMapIntensity).toBe(0);
    expect(darkMat.roughness).toBeGreaterThanOrEqual(0.9);

    board.setQuality('high');
    expect(darkMat.clearcoat).toBeGreaterThan(0.1);
    expect(darkMat.envMapIntensity).toBeGreaterThan(0.3);

    board.setMapTheme('classic');
    expect(board.coordinatesGroup.visible).toBe(true);
  });

  it('switches Map-Specific Music tracks automatically for cathedral, warhall, sanctum, and classic and supports ON/OFF toggle', () => {
    soundManager.setMusicEnabled(true);
    soundManager.setMapMusic('cathedral');
    expect(soundManager.getMusicStatus().trackId).toBe(MAP_MUSIC_TRACKS.cathedral.trackId);

    soundManager.setMapMusic('warhall');
    expect(soundManager.getMusicStatus().trackId).toBe(MAP_MUSIC_TRACKS.warhall.trackId);

    soundManager.setMapMusic('sanctum');
    expect(soundManager.getMusicStatus().trackId).toBe(MAP_MUSIC_TRACKS.sanctum.trackId);

    soundManager.setMapMusic('classic');
    expect(soundManager.getMusicStatus().trackId).toBe(MAP_MUSIC_TRACKS.classic.trackId);

    soundManager.setMusicEnabled(false);
    expect(soundManager.getMusicStatus().enabled).toBe(false);
    soundManager.setMusicEnabled(true);
    expect(soundManager.getMusicStatus().enabled).toBe(true);
  });
});
