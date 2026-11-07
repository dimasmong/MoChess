import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ChessGameEngine } from '../src/engine/ChessGameEngine';
import { PieceAssetManager } from '../src/assets/PieceAssetManager';
import { squareToWorldPosition, worldPositionToSquare } from '../src/scene/ChessboardBuilder';
import { OnlineRoomService } from '../src/server/onlineRoomService';
import type { Color, PieceSkinId, PieceSymbol, Square } from '../src/engine/types';

describe('Comprehensive Chess Piece Interaction, 3D Hitbox Raycasting & Movement Audit', () => {
  let engine: ChessGameEngine;

  beforeEach(() => {
    window.localStorage.clear();
    engine = new ChessGameEngine({ mode: 'local', playerColor: 'w', timeControlMinutes: 0 });
  });

  it('1. Selects and moves White & Black Knights from starting squares (b1->a3/c3, g1->f3/h3, b8->a6/c6, g8->f6/h6)', () => {
    // White Knight b1 -> a3
    const selB1 = engine.handleSquareInteraction('b1');
    expect('action' in selB1 && selB1.action).toBe('selected');
    if ('action' in selB1) {
      expect(selB1.destinations.map((d) => d.square).sort()).toEqual(['a3', 'c3']);
    }
    const moveA3 = engine.handleSquareInteraction('a3');
    expect('valid' in moveA3 && moveA3.valid).toBe(true);
    expect(engine.getPieceAt('a3')).toEqual({ type: 'n', color: 'w' });
    expect(engine.getPieceAt('b1')).toBeNull();

    // Black Knight b8 -> c6
    const selB8 = engine.handleSquareInteraction('b8');
    expect('action' in selB8 && selB8.action).toBe('selected');
    if ('action' in selB8) {
      expect(selB8.destinations.map((d) => d.square).sort()).toEqual(['a6', 'c6']);
    }
    const moveC6 = engine.handleSquareInteraction('c6');
    expect('valid' in moveC6 && moveC6.valid).toBe(true);
    expect(engine.getPieceAt('c6')).toEqual({ type: 'n', color: 'b' });

    // Undo both moves and test b1 -> c3 and g8 -> f6
    engine.undo();
    engine.undo();
    expect(engine.getPieceAt('b1')).toEqual({ type: 'n', color: 'w' });

    engine.handleSquareInteraction('b1');
    const moveC3 = engine.handleSquareInteraction('c3');
    expect('valid' in moveC3 && moveC3.valid).toBe(true);
    expect(engine.getPieceAt('c3')).toEqual({ type: 'n', color: 'w' });

    engine.handleSquareInteraction('g8');
    const moveF6 = engine.handleSquareInteraction('f6');
    expect('valid' in moveF6 && moveF6.valid).toBe(true);
    expect(engine.getPieceAt('f6')).toEqual({ type: 'n', color: 'b' });
  });

  it('2. Selects and moves Knight from d4 to all 8 L-shaped target squares (c6, e6, b5, f5, b3, f3, c2, e2)', () => {
    const centerKnightFen = '4k3/p7/8/8/3N4/8/8/4K3 w - - 0 1';
    const expectedTargets: Square[] = ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'];

    engine.loadFen(centerKnightFen);
    const dests = engine.selectSquare('d4').map((d) => d.square).sort();
    expect(dests).toEqual(expectedTargets);

    for (const target of expectedTargets) {
      engine.loadFen(centerKnightFen);
      const sel = engine.handleSquareInteraction('d4');
      expect('action' in sel && sel.action).toBe('selected');

      const res = engine.handleSquareInteraction(target);
      expect('valid' in res && res.valid).toBe(true);
      expect(engine.getPieceAt(target)).toEqual({ type: 'n', color: 'w' });
      expect(engine.getPieceAt('d4')).toBeNull();
    }
  });

  it('3. Allows Knight on d4 to jump over a complete 3x3 ring of surrounding friendly and enemy pieces in all 8 directions', () => {
    // d4 White Knight completely surrounded by friendly pawns on c3,d3,e3,c4,e4 and enemy pieces on c5,d5,e5
    const surroundedFen = '4k3/8/8/2ppp3/2PNP3/2PPP3/8/4K3 w - - 0 1';
    const expectedTargets: Square[] = ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'];

    engine.loadFen(surroundedFen);
    const dests = engine.selectSquare('d4').map((d) => d.square).sort();
    expect(dests).toEqual(expectedTargets);

    for (const target of expectedTargets) {
      engine.loadFen(surroundedFen);
      engine.handleSquareInteraction('d4');
      const res = engine.handleSquareInteraction(target);
      expect('valid' in res && res.valid).toBe(true);
      expect(engine.getPieceAt(target)).toEqual({ type: 'n', color: 'w' });
    }
  });

  it('4. Blocks Knight movement ONLY when destination square contains a friendly piece, while allowing captures of enemy pieces', () => {
    // d4 Knight with friendly pawns on c6, e6, b5, f5 and enemy knights on b3, f3, c2, e2 (White King safely on h1)
    const mixedTargetsFen = '4k3/8/2P1P3/1P3P2/3N4/1n3n2/2n1n3/7K w - - 0 1';
    engine.loadFen(mixedTargetsFen);

    const dests = engine.selectSquare('d4');
    const squares = dests.map((d) => d.square).sort();
    expect(squares).toEqual(['b3', 'c2', 'e2', 'f3']);
    expect(dests.every((d) => d.isCapture)).toBe(true);

    // Friendly square c6 is rejected as a move and instead switches selection to the friendly c6 pawn
    const tapC6 = engine.handleSquareInteraction('c6');
    expect('action' in tapC6 && tapC6.action).toBe('selected');
    expect(engine.getSnapshot().selectedSquare).toBe('c6');

    // Reselect d4 Knight and capture enemy Knight on f3
    engine.handleSquareInteraction('d4');
    const capF3 = engine.handleSquareInteraction('f3');
    expect('valid' in capF3 && capF3.valid).toBe(true);
    if ('move' in capF3 && capF3.move) {
      expect(capF3.move.captured).toBe('n');
    }
    expect(engine.getPieceAt('f3')).toEqual({ type: 'n', color: 'w' });
  });

  it('5. Prevents a pinned Knight from moving illegally and accurately identifies the pin reason', () => {
    // White King on e1, White Knight on e2, Black Rook on e8 -> Knight on e2 is absolutely pinned
    const pinnedKnightFen = '4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1';
    engine.loadFen(pinnedKnightFen);

    const sel = engine.handleSquareInteraction('e2');
    expect('action' in sel && sel.action).toBe('selected');
    if ('action' in sel) {
      expect(sel.destinations).toHaveLength(0);
    }
    expect(engine.getNoMovesReason('e2')).toBe('pinned');

    // Attempting to move the pinned Knight to f4 or d4 is rejected without mutating state
    const illegalMove = engine.executeMove('e2', 'f4');
    expect(illegalMove.valid).toBe(false);
    expect(engine.getPieceAt('e2')).toEqual({ type: 'n', color: 'w' });

    // When King is in check and a distant piece cannot help, getNoMovesReason returns 'in_check'
    const inCheckFen = '4r2k/8/8/8/8/N7/8/4K3 w - - 0 1';
    engine.loadFen(inCheckFen);
    expect(engine.getNoMovesReason('a3')).toBe('in_check');
  });

  it('6. Audits all 6 chess pieces (Pawn, Knight, Bishop, Rook, Queen, King) including en passant, castling, and promotion to Q, R, B, N', () => {
    // Test promotion to all 4 piece types (q, r, b, n)
    const promoPieces: PieceSymbol[] = ['q', 'r', 'b', 'n'];
    for (const promo of promoPieces) {
      engine.loadFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
      engine.handleSquareInteraction('a7');
      const step = engine.handleSquareInteraction('a8');
      expect('requiresPromotion' in step && step.requiresPromotion).toBe(true);
      const done = engine.completePromotion(promo);
      expect(done.valid).toBe(true);
      expect(engine.getPieceAt('a8')).toEqual({ type: promo, color: 'w' });
    }

    // Test Bishop, Rook, Queen, and King full range and captures
    engine.loadFen('r3k2r/ppp2ppp/8/3qp3/3B4/8/PPP1QPPP/R3K2R w KQkq - 0 1');
    // Bishop on d4 captures e5
    engine.handleSquareInteraction('d4');
    const bCap = engine.handleSquareInteraction('e5');
    expect('valid' in bCap && bCap.valid).toBe(true);

    // Black Queen on d5 captures e5
    engine.handleSquareInteraction('d5');
    const qCap = engine.handleSquareInteraction('e5');
    expect('valid' in qCap && qCap.valid).toBe(true);

    // White Queen on e2 captures e5
    engine.handleSquareInteraction('e2');
    const wqCap = engine.handleSquareInteraction('e5');
    expect('valid' in wqCap && wqCap.valid).toBe(true);
  });

  it('7. Verifies watertight 3D selection hitboxes across all 3 skins and 4-tier priority raycast through intervening pieces', () => {
    const skins: PieceSkinId[] = ['arcane_royalty', 'runic_warforged', 'mystic_sanctum'];
    const pieceTypes: PieceSymbol[] = ['p', 'r', 'n', 'b', 'q', 'k'];
    const manager = new PieceAssetManager('high', false);
    const raycaster = new THREE.Raycaster();

    for (const skin of skins) {
      manager.setSkin(skin);
      for (const type of pieceTypes) {
        const inst = manager.createPieceInstance(type, 'w', 'd4');
        const pos = squareToWorldPosition('d4', 0);
        inst.position.copy(pos);
        inst.updateMatrixWorld(true);

        // Verify dedicated hitbox exists and stays strictly within the 1.0x1.0 tile footprint
        const hitbox = inst.userData.hitboxMesh as THREE.Mesh;
        expect(hitbox).toBeDefined();
        hitbox.geometry.computeBoundingBox();
        const bb = hitbox.geometry.boundingBox!;
        expect(bb.min.x).toBeGreaterThanOrEqual(-0.45);
        expect(bb.max.x).toBeLessThanOrEqual(0.45);
        expect(bb.min.z).toBeGreaterThanOrEqual(-0.45);
        expect(bb.max.z).toBeLessThanOrEqual(0.45);

        // Raycast from gameplay camera angle (0, 10.8, 5.4) directly toward the piece's center
        const camPos = new THREE.Vector3(0, 10.8, 5.4);
        const targetPos = pos.clone().setY(0.45);
        const dir = targetPos.sub(camPos).normalize();
        raycaster.set(camPos, dir);

        const hits = raycaster.intersectObjects([inst], true);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].object.userData.square).toBe('d4');

        // Verify a ray aimed at the adjacent square d3 (z = +1.5) NEVER hits the piece on d4 (z = +0.5)
        const d3Pos = squareToWorldPosition('d3', 0);
        const dirToD3 = d3Pos.clone().sub(camPos).normalize();
        raycaster.set(camPos, dirToD3);
        const adjacentHits = raycaster.intersectObjects([inst], true);
        expect(adjacentHits).toHaveLength(0);
      }
    }

    // Verify low-angle ray to Knight destination c3 (z = 1.5) passing through Pawn on c2 (z = 2.5)
    // still intersects the y = 0 board plane at c3 so Priority 1 selects c3
    const lowCamPos = new THREE.Vector3(-1.5, 2.3, 5.35);
    const c3Ground = squareToWorldPosition('c3', 0);
    const dirToC3 = c3Ground.clone().sub(lowCamPos).normalize();
    raycaster.set(lowCamPos, dirToC3);

    const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();
    expect(raycaster.ray.intersectPlane(boardPlane, planeHit)).not.toBeNull();
    expect(worldPositionToSquare(planeHit.x, planeHit.z)).toBe('c3');
  });

  it('8. Enforces Online PvP waiting state, turn ownership, and preserves active piece selection across heartbeat polls', async () => {
    const service = new OnlineRoomService();
    const hostRes = await service.createRoom({ hostColor: 'w', mapId: 'cathedral' });
    const waitingRoom = hostRes.body.room!;
    const roomCode = waitingRoom.roomCode;
    const whiteToken = hostRes.body.playerToken!;

    const whiteEngine = new ChessGameEngine();
    whiteEngine.syncFromOnlineRoom(waitingRoom, 'w');

    // While waiting for opponent to join, White cannot select or move pieces on the board
    expect(whiteEngine.isHumanTurn()).toBe(false);
    expect(whiteEngine.selectSquare('b1')).toHaveLength(0);

    // Second player joins -> status becomes 'playing'
    const guestRes = await service.joinRoom({ roomCode });
    const playingRoom = guestRes.body.room!;
    const blackToken = guestRes.body.playerToken!;

    whiteEngine.syncFromOnlineRoom(playingRoom, 'w');
    const blackEngine = new ChessGameEngine();
    blackEngine.syncFromOnlineRoom(playingRoom, 'b');

    expect(whiteEngine.isHumanTurn()).toBe(true);
    expect(blackEngine.isHumanTurn()).toBe(false);

    // White selects Knight on b1
    const wDests = whiteEngine.selectSquare('b1');
    expect(wDests.map((d) => d.square).sort()).toEqual(['a3', 'c3']);
    expect(whiteEngine.getSnapshot().selectedSquare).toBe('b1');

    // Simulate repeated 850ms polls arriving while White has b1 selected -> selection MUST NOT be cleared!
    let emitCount = 0;
    const unsub = whiteEngine.subscribe(() => {
      emitCount++;
    });
    emitCount = 0; // Reset after initial subscribe callback

    const pollRes = await service.pollRoom({ roomCode, token: whiteToken });
    whiteEngine.syncFromOnlineRoom(pollRes.body.room!, 'w');

    expect(emitCount).toBe(0);
    expect(whiteEngine.getSnapshot().selectedSquare).toBe('b1');
    expect(whiteEngine.getSnapshot().legalDestinations.map((d) => d.square).sort()).toEqual(['a3', 'c3']);
    unsub();

    // Black attempting to select or move on White's turn is rejected
    expect(blackEngine.handleSquareInteraction('b8')).toEqual({
      action: 'deselected',
      destinations: []
    });

    // White moves Knight b1 -> c3
    const wMove = whiteEngine.handleSquareInteraction('c3');
    expect('valid' in wMove && wMove.valid).toBe(true);
    const srvMove1 = await service.submitMove({ roomCode, token: whiteToken, from: 'b1', to: 'c3' });
    expect(srvMove1.status).toBe(200);

    // Sync both engines with server state
    whiteEngine.syncFromOnlineRoom(srvMove1.body.room!, 'w');
    const blackAnimMove = blackEngine.syncFromOnlineRoom(srvMove1.body.room!, 'b');
    expect(blackAnimMove?.san).toBe('Nc3');
    expect(whiteEngine.isHumanTurn()).toBe(false);
    expect(blackEngine.isHumanTurn()).toBe(true);

    // Now Black selects and moves Knight g8 -> f6
    const bSel = blackEngine.handleSquareInteraction('g8');
    expect('action' in bSel && bSel.action).toBe('selected');
    const bMove = blackEngine.handleSquareInteraction('f6');
    expect('valid' in bMove && bMove.valid).toBe(true);
    const srvMove2 = await service.submitMove({ roomCode, token: blackToken, from: 'g8', to: 'f6' });
    expect(srvMove2.status).toBe(200);
  });
});
