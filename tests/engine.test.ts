import { describe, it, expect, beforeEach } from 'vitest';
import { ChessGameEngine } from '../src/engine/ChessGameEngine';
import { TRANSLATIONS } from '../src/ui/i18n';

describe('ChessGameEngine — Authoritative Chess Rules & State Management', () => {
  let engine: ChessGameEngine;

  beforeEach(() => {
    window.localStorage.clear();
    engine = new ChessGameEngine({ mode: 'local', playerColor: 'w', timeControlMinutes: 10 });
  });

  it('initializes standard chess starting position with 32 pieces and White to move', () => {
    const snap = engine.getSnapshot();
    expect(snap.turn).toBe('w');
    expect(snap.inCheck).toBe(false);
    expect(snap.isGameOver).toBe(false);
    expect(engine.getAllPieces().length).toBe(32);
  });

  it('validates legal movements for every piece type (Pawn, Knight, Bishop, Rook, Queen, King)', () => {
    // 1. Pawn 1-square and 2-square opening moves
    const e2Dests = engine.getLegalDestinationsForSquare('e2').map((d) => d.square);
    expect(e2Dests).toContain('e3');
    expect(e2Dests).toContain('e4');
    expect(engine.executeMove('e2', 'e4').valid).toBe(true);
    expect(engine.executeMove('e7', 'e5').valid).toBe(true);

    // 2. Knight jumps over pieces in L-shape
    const g1Dests = engine.getLegalDestinationsForSquare('g1').map((d) => d.square);
    expect(g1Dests).toContain('f3');
    expect(g1Dests).toContain('h3');
    expect(engine.executeMove('g1', 'f3').valid).toBe(true);
    expect(engine.executeMove('b8', 'c6').valid).toBe(true);

    // 3. Bishop moves diagonally
    const f1Dests = engine.getLegalDestinationsForSquare('f1').map((d) => d.square);
    expect(f1Dests).toContain('c4');
    expect(f1Dests).toContain('b5');
    expect(engine.executeMove('f1', 'c4').valid).toBe(true);
    expect(engine.executeMove('g8', 'f6').valid).toBe(true);

    // 4. Queen moves diagonally, horizontally, or vertically
    const d1Dests = engine.getLegalDestinationsForSquare('d1').map((d) => d.square);
    expect(d1Dests).toContain('e2');
    expect(engine.executeMove('d1', 'e2').valid).toBe(true);
    expect(engine.executeMove('f8', 'e7').valid).toBe(true);

    // 5. Rook moves along files/ranks once unblocked
    expect(engine.executeMove('h1', 'g1').valid).toBe(true);
    expect(engine.executeMove('h8', 'f8').valid).toBe(true);

    // 6. King moves 1 square
    expect(engine.executeMove('e1', 'd1').valid).toBe(true);
    expect(engine.getPieceAt('d1')?.type).toBe('k');
  });

  it('rejects invalid moves without mutating game state', () => {
    const initialFen = engine.getFen();

    // Moving opponent piece on White's turn
    const wrongTurn = engine.executeMove('e7', 'e5');
    expect(wrongTurn.valid).toBe(false);
    expect(engine.getFen()).toBe(initialFen);

    // Moving empty square
    const emptyMove = engine.executeMove('e4', 'e5');
    expect(emptyMove.valid).toBe(false);
    expect(engine.getFen()).toBe(initialFen);

    // Moving pawn 3 squares
    const illegalPawn = engine.executeMove('e2', 'e5');
    expect(illegalPawn.valid).toBe(false);
    expect(engine.getFen()).toBe(initialFen);

    // Moving blocked rook through pawn
    const blockedRook = engine.executeMove('a1', 'a4');
    expect(blockedRook.valid).toBe(false);
    expect(engine.getFen()).toBe(initialFen);

    expect(engine.getSnapshot().moveHistory.length).toBe(0);
  });

  it('handles check and checkmate (Scholar’s Mate & Fool’s Mate) accurately', () => {
    // Fool's Mate
    expect(engine.executeMove('f2', 'f3').valid).toBe(true);
    expect(engine.executeMove('e7', 'e5').valid).toBe(true);
    expect(engine.executeMove('g2', 'g4').valid).toBe(true);
    const mateMove = engine.executeMove('d8', 'h4');
    expect(mateMove.valid).toBe(true);
    expect(mateMove.move?.isCheck).toBe(true);
    expect(mateMove.move?.isCheckmate).toBe(true);

    const snap = engine.getSnapshot();
    expect(snap.inCheck).toBe(true);
    expect(snap.kingInCheckSquare).toBe('e1');
    expect(snap.isGameOver).toBe(true);
    expect(snap.winner).toBe('b');
    expect(snap.resultReason).toBe('checkmate');

    // No further moves allowed after checkmate
    expect(engine.executeMove('e2', 'e4').valid).toBe(false);
  });

  it('supports kingside and queenside castling and reports rook movement coordinates', () => {
    // Load position ready for both White kingside and Black queenside castling
    engine.loadFen('r3kbnr/pppqpppp/2n5/3p1b2/3P1B2/5N2/PPPQPPPP/R3K2R w KQkq - 4 6');

    // White castles kingside (e1 -> g1, rook h1 -> f1)
    const castleK = engine.executeMove('e1', 'g1');
    expect(castleK.valid).toBe(true);
    expect(castleK.move?.castling).toEqual({
      side: 'k',
      rookFrom: 'h1',
      rookTo: 'f1'
    });
    expect(engine.getPieceAt('g1')?.type).toBe('k');
    expect(engine.getPieceAt('f1')?.type).toBe('r');

    // Black castles queenside (e8 -> c8, rook a8 -> d8)
    const castleQ = engine.executeMove('e8', 'c8');
    expect(castleQ.valid).toBe(true);
    expect(castleQ.move?.castling).toEqual({
      side: 'q',
      rookFrom: 'a8',
      rookTo: 'd8'
    });
    expect(engine.getPieceAt('c8')?.type).toBe('k');
    expect(engine.getPieceAt('d8')?.type).toBe('r');
  });

  it('supports en passant capture and identifies the exact captured pawn square', () => {
    expect(engine.executeMove('e2', 'e4').valid).toBe(true);
    expect(engine.executeMove('a7', 'a6').valid).toBe(true);
    expect(engine.executeMove('e4', 'e5').valid).toBe(true);
    expect(engine.executeMove('d7', 'd5').valid).toBe(true);

    // White pawn on e5 captures d5 pawn en passant by moving to d6
    const epDests = engine.getLegalDestinationsForSquare('e5');
    const d6Dest = epDests.find((d) => d.square === 'd6');
    expect(d6Dest).toBeDefined();
    expect(d6Dest?.isEnPassant).toBe(true);

    const epResult = engine.executeMove('e5', 'd6');
    expect(epResult.valid).toBe(true);
    expect(epResult.move?.captured).toBe('p');
    expect(epResult.move?.capturedSquare).toBe('d5');
    expect(engine.getPieceAt('d5')).toBeNull();
    expect(engine.getPieceAt('d6')).toEqual({ type: 'p', color: 'w' });
  });

  it('handles pawn promotion workflow (pending prompt + promotion to Q, R, B, N)', () => {
    engine.loadFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const fenBefore = engine.getFen();

    // Calling executeMove without promotion piece requests promotion UI without mutating state
    const pending = engine.executeMove('a7', 'a8');
    expect(pending.valid).toBe(false);
    expect(pending.requiresPromotion).toBe(true);
    expect(engine.getFen()).toBe(fenBefore);

    // Completing promotion to Queen updates state
    const completed = engine.completePromotion('q');
    expect(completed.valid).toBe(true);
    expect(completed.move?.promotion).toBe('q');
    expect(engine.getPieceAt('a8')).toEqual({ type: 'q', color: 'w' });
  });

  it('detects stalemate and insufficient material draws', () => {
    // Stalemate position where Black has no legal moves and is not in check
    engine.loadFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const snap = engine.getSnapshot();
    expect(snap.isGameOver).toBe(true);
    expect(snap.winner).toBe('draw');
    expect(snap.resultReason).toBe('stalemate');

    // Insufficient material (King vs King)
    engine.loadFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const insSnap = engine.getSnapshot();
    expect(insSnap.isGameOver).toBe(true);
    expect(insSnap.winner).toBe('draw');
    expect(insSnap.resultReason).toBe('insufficient_material');
  });

  it('supports Undo, Restart, New Game, and LocalStorage persistence', () => {
    expect(engine.executeMove('e2', 'e4').valid).toBe(true);
    const fenAfterE4 = engine.getFen();
    expect(engine.executeMove('e7', 'e5').valid).toBe(true);

    // Undo 1 ply in local mode
    expect(engine.undo()).toBe(true);
    expect(engine.getFen()).toBe(fenAfterE4);
    expect(engine.getSnapshot().moveHistory.length).toBe(1);

    // Restore from storage into a brand new engine instance (simulating page refresh)
    const restoredEngine = new ChessGameEngine();
    expect(restoredEngine.restoreFromStorage()).toBe(true);
    expect(restoredEngine.getFen()).toBe(fenAfterE4);
    expect(restoredEngine.getSnapshot().moveHistory.length).toBe(1);

    // Restart resets state
    engine.restart();
    expect(engine.getSnapshot().moveHistory.length).toBe(0);
    expect(engine.getAllPieces().length).toBe(32);
  });

  it('completes a full multi-move match (Scholar’s Mate) from start to finish and supports New Game reset', () => {
    const moves: Array<[any, any]> = [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['f1', 'c4'],
      ['b8', 'c6'],
      ['d1', 'h5'],
      ['g8', 'f6'],
      ['h5', 'f7']
    ];

    for (const [from, to] of moves) {
      const res = engine.executeMove(from, to);
      expect(res.valid).toBe(true);
    }

    const finalSnap = engine.getSnapshot();
    expect(finalSnap.isGameOver).toBe(true);
    expect(finalSnap.winner).toBe('w');
    expect(finalSnap.resultReason).toBe('checkmate');
    expect(finalSnap.moveHistory.length).toBe(7);

    // Start New Game resets all state
    engine.startNewGame({ mode: 'ai', playerColor: 'b' });
    const resetSnap = engine.getSnapshot();
    expect(resetSnap.isGameOver).toBe(false);
    expect(resetSnap.winner).toBeNull();
    expect(resetSnap.moveHistory.length).toBe(0);
    expect(resetSnap.config.playerColor).toBe('b');
  });

  it('undoes a full turn pair (2 plies) in Human vs AI mode when it is the human’s turn', () => {
    const aiEngine = new ChessGameEngine({ mode: 'ai', playerColor: 'w' });
    const startFen = aiEngine.getFen();

    expect(aiEngine.executeMove('e2', 'e4').valid).toBe(true);
    expect(aiEngine.executeMove('e7', 'e5').valid).toBe(true);
    expect(aiEngine.getSnapshot().moveHistory.length).toBe(2);

    // Human presses Undo on their turn -> reverts both AI reply and human move back to startFen
    expect(aiEngine.undo()).toBe(true);
    expect(aiEngine.getFen()).toBe(startFen);
    expect(aiEngine.getSnapshot().moveHistory.length).toBe(0);
  });

  it('persists map selection (cathedral, warhall, sanctum) and validates bilingual EN/ID translations', () => {
    expect(engine.getConfig().mapId).toBe('cathedral');
    engine.setMap('warhall');
    expect(engine.getConfig().mapId).toBe('warhall');
    engine.setMap('sanctum');
    expect(engine.getConfig().mapId).toBe('sanctum');

    const restored = new ChessGameEngine();
    expect(restored.restoreFromStorage()).toBe(true);
    expect(restored.getConfig().mapId).toBe('sanctum');

    const enKeys = Object.keys(TRANSLATIONS.en);
    const idKeys = Object.keys(TRANSLATIONS.id);
    expect(enKeys).toEqual(idKeys);
    for (const k of enKeys) {
      expect(TRANSLATIONS.en[k as keyof typeof TRANSLATIONS.en]).toBeTruthy();
      expect(TRANSLATIONS.id[k as keyof typeof TRANSLATIONS.id]).toBeTruthy();
    }
  });
});
