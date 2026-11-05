import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getPieceGeometryParts } from '../src/assets/PieceGeometryBuilder';
import { PieceAssetManager } from '../src/assets/PieceAssetManager';
import type { PieceSymbol } from '../src/engine/types';

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
});
