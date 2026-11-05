import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { AIDifficulty } from '../engine/types';
import {
  evaluatePosition,
  searchBestMove,
  type AIMove,
  type AIWorkerRequest,
  type AIWorkerResponse
} from './chessAI.worker';

export type { AIMove };

interface PendingRequest {
  id: number;
  fen: string;
  difficulty: AIDifficulty;
  resolve: (move: AIMove | null) => void;
}

/**
 * Strictly validates that `candidate` is a legal move in `fen`.
 * If `candidate` is missing or illegal, falls back to the first legal move (or `null` if game over).
 */
function ensureLegalMove(fen: string, candidate: AIMove | null): AIMove | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }

  if (chess.isGameOver()) {
    return null;
  }

  const legalMoves = chess.moves({ verbose: true }) as Move[];
  if (legalMoves.length === 0) {
    return null;
  }

  if (candidate) {
    const matching = legalMoves.find((m) => {
      if (m.from !== candidate.from || m.to !== candidate.to) return false;
      if (m.promotion) {
        const promo = candidate.promotion ?? 'q';
        return m.promotion === promo;
      }
      return true;
    });

    if (matching) {
      if (matching.promotion) {
        return {
          from: matching.from as Square,
          to: matching.to as Square,
          promotion: matching.promotion as PieceSymbol
        };
      }
      return {
        from: matching.from as Square,
        to: matching.to as Square
      };
    }
  }

  // Fallback to searchBestMove or first legal move if worker returned an unexpected move
  const fallback = searchBestMove(fen, 'knight');
  if (fallback) {
    const verified = legalMoves.find(
      (m) =>
        m.from === fallback.from &&
        m.to === fallback.to &&
        (m.promotion ?? undefined) === (fallback.promotion ?? undefined)
    );
    if (verified) {
      return verified.promotion
        ? {
            from: verified.from as Square,
            to: verified.to as Square,
            promotion: verified.promotion as PieceSymbol
          }
        : {
            from: verified.from as Square,
            to: verified.to as Square
          };
    }
  }

  const first = legalMoves[0];
  return first.promotion
    ? {
        from: first.from as Square,
        to: first.to as Square,
        promotion: first.promotion as PieceSymbol
      }
    : {
        from: first.from as Square,
        to: first.to as Square
      };
}

function canUseWebWorker(): boolean {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return false;
  }
  // In Vitest / Node test runners, use the direct non-blocking async fallback
  const globalAny = globalThis as Record<string, unknown>;
  if (
    typeof globalAny.process !== 'undefined' &&
    (globalAny.process as { env?: Record<string, string> })?.env?.VITEST
  ) {
    return false;
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
    return false;
  }
  return true;
}

export class AIManager {
  private static defaultInstance: AIManager | null = null;

  private worker: Worker | null = null;
  private workerDisabled = false;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private thinkingCount = 0;

  public static getInstance(): AIManager {
    if (!AIManager.defaultInstance) {
      AIManager.defaultInstance = new AIManager();
    }
    return AIManager.defaultInstance;
  }

  /**
   * Static convenience wrapper so callers can invoke `AIManager.computeBestMove(fen, difficulty)`
   * or instantiate `new AIManager().computeBestMove(fen, difficulty)`.
   */
  public static computeBestMove(
    fen: string,
    difficulty: AIDifficulty = 'knight'
  ): Promise<{ from: Square; to: Square; promotion?: PieceSymbol } | null> {
    return AIManager.getInstance().computeBestMove(fen, difficulty);
  }

  public static cancel(): void {
    AIManager.getInstance().cancel();
  }

  public static isThinking(): boolean {
    return AIManager.getInstance().isThinking();
  }

  public static evaluateFen(fen: string): number {
    try {
      const chess = new Chess(fen);
      return evaluatePosition(chess, true);
    } catch {
      return 0;
    }
  }

  private getOrCreateWorker(): Worker | null {
    if (this.workerDisabled || !canUseWebWorker()) {
      return null;
    }
    if (this.worker) {
      return this.worker;
    }

    try {
      const worker = new Worker(new URL('./chessAI.worker.ts', import.meta.url), {
        type: 'module'
      });

      worker.onmessage = (event: MessageEvent<AIWorkerResponse>) => {
        const data = event.data;
        if (!data || typeof data.id !== 'number') return;
        const req = this.pending.get(data.id);
        if (!req) return;
        this.pending.delete(data.id);
        this.thinkingCount = Math.max(0, this.thinkingCount - 1);

        const validated = ensureLegalMove(req.fen, data.move);
        req.resolve(validated);
      };

      worker.onerror = () => {
        // Fallback all pending requests to direct async computation if worker fails to load
        this.workerDisabled = true;
        const currentPending = Array.from(this.pending.values());
        this.pending.clear();
        try {
          worker.terminate();
        } catch {
          // ignore
        }
        this.worker = null;

        for (const req of currentPending) {
          setTimeout(() => {
            this.thinkingCount = Math.max(0, this.thinkingCount - 1);
            const raw = searchBestMove(req.fen, req.difficulty);
            req.resolve(ensureLegalMove(req.fen, raw));
          }, 0);
        }
      };

      this.worker = worker;
      return worker;
    } catch {
      this.workerDisabled = true;
      this.worker = null;
      return null;
    }
  }

  /**
   * Computes the best legal move for the active side in `fen` at `difficulty`.
   * Never blocks the UI thread and never returns an illegal move.
   */
  public async computeBestMove(
    fen: string,
    difficulty: AIDifficulty = 'knight'
  ): Promise<{ from: Square; to: Square; promotion?: PieceSymbol } | null> {
    // Fast pre-check for invalid FEN or game-over state
    try {
      const checkChess = new Chess(fen);
      if (checkChess.isGameOver()) {
        return null;
      }
    } catch {
      return null;
    }

    const worker = this.getOrCreateWorker();
    if (worker) {
      const id = this.nextRequestId++;
      this.thinkingCount++;
      return new Promise<AIMove | null>((resolve) => {
        this.pending.set(id, { id, fen, difficulty, resolve });
        const payload: AIWorkerRequest = { id, fen, difficulty };
        try {
          worker.postMessage(payload);
        } catch {
          this.pending.delete(id);
          this.thinkingCount = Math.max(0, this.thinkingCount - 1);
          this.workerDisabled = true;
          setTimeout(() => {
            const raw = searchBestMove(fen, difficulty);
            resolve(ensureLegalMove(fen, raw));
          }, 0);
        }
      });
    }

    // Non-blocking async fallback (yields to macrotask queue first)
    this.thinkingCount++;
    return new Promise<AIMove | null>((resolve) => {
      setTimeout(() => {
        try {
          const raw = searchBestMove(fen, difficulty);
          resolve(ensureLegalMove(fen, raw));
        } finally {
          this.thinkingCount = Math.max(0, this.thinkingCount - 1);
        }
      }, 0);
    });
  }

  public isThinking(): boolean {
    return this.thinkingCount > 0;
  }

  /**
   * Cancels any in-flight AI search requests and resets the worker.
   */
  public cancel(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }

    if (this.pending.size > 0) {
      for (const req of this.pending.values()) {
        req.resolve(null);
      }
      this.pending.clear();
    }
    this.thinkingCount = 0;
  }

  public terminate(): void {
    this.cancel();
  }

  public dispose(): void {
    this.cancel();
  }
}

export const aiManager = AIManager.getInstance();

export function computeBestMove(
  fen: string,
  difficulty: AIDifficulty = 'knight'
): Promise<{ from: Square; to: Square; promotion?: PieceSymbol } | null> {
  return AIManager.computeBestMove(fen, difficulty);
}
