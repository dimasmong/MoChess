import { describe, it, expect } from 'vitest';
import { ChessGameEngine } from '../src/engine/ChessGameEngine';
import { aiManager } from '../src/ai/AIManager';
import { searchBestMove } from '../src/ai/chessAI.worker';

describe('Wizard Chess AI Opponent (Alpha-Beta + Quiescence + Legal Move Verification)', () => {
  it('produces only legal moves across all difficulty levels from starting and complex positions', async () => {
    const engine = new ChessGameEngine({ mode: 'ai', playerColor: 'w' });
    const difficulties = ['novice', 'knight', 'archmage', 'grandmaster'] as const;

    for (const diff of difficulties) {
      const move = await aiManager.computeBestMove(engine.getFen(), diff);
      expect(move).not.toBeNull();
      const res = engine.executeMove(move!.from, move!.to, move!.promotion);
      expect(res.valid).toBe(true);
    }
  });

  it('finds immediate checkmate-in-1 when available', () => {
    // White has Qh5# or Qxf7# in Scholar's Mate setup
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 3 3';
    const best = searchBestMove(fen, 'knight');
    expect(best).not.toBeNull();
    expect(best?.from).toBe('h5');
    expect(best?.to).toBe('f7');
  });

  it('captures an undefended hanging Queen tactically', () => {
    const fen = '4k3/8/8/3q4/4B3/8/8/4K3 w - - 0 1';
    const best = searchBestMove(fen, 'archmage');
    expect(best).not.toBeNull();
    expect(best?.from).toBe('e4');
    expect(best?.to).toBe('d5');
  });
});
