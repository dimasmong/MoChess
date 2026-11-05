import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { AIDifficulty } from '../engine/types';

export interface AIMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

export interface AIWorkerRequest {
  id: number;
  fen: string;
  difficulty: AIDifficulty;
}

export interface AIWorkerResponse {
  id: number;
  move: AIMove | null;
  error?: string;
}

const MATE_SCORE = 100000;
const MAX_QUIESCENCE_DEPTH = 4;

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
};

/**
 * Piece-Square Tables from White's perspective (index 0 = a8, index 63 = h1).
 * For Black, we mirror vertically using `index ^ 56`.
 */
const PAWN_PST_MG: readonly number[] = [
   0,   0,   0,   0,   0,   0,   0,   0,
  50,  50,  50,  50,  50,  50,  50,  50,
  10,  10,  20,  30,  30,  20,  10,  10,
   5,   5,  10,  25,  25,  10,   5,   5,
   0,   0,   0,  22,  22,   0,   0,   0,
   5,  -5, -10,   0,   0, -10,  -5,   5,
   5,  10,  10, -20, -20,  10,  10,   5,
   0,   0,   0,   0,   0,   0,   0,   0
];

const PAWN_PST_EG: readonly number[] = [
   0,   0,   0,   0,   0,   0,   0,   0,
  80,  80,  80,  80,  80,  80,  80,  80,
  50,  50,  50,  50,  50,  50,  50,  50,
  30,  30,  30,  30,  30,  30,  30,  30,
  15,  15,  15,  15,  15,  15,  15,  15,
   5,   5,   5,   5,   5,   5,   5,   5,
   0,   0,   0,   0,   0,   0,   0,   0,
   0,   0,   0,   0,   0,   0,   0,   0
];

const KNIGHT_PST: readonly number[] = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20,   0,   0,   0,   0, -20, -40,
  -30,   0,  10,  15,  15,  10,   0, -30,
  -30,   5,  15,  20,  20,  15,   5, -30,
  -30,   0,  15,  20,  20,  15,   0, -30,
  -30,   5,  10,  15,  15,  10,   5, -30,
  -40, -20,   0,   5,   5,   0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50
];

const BISHOP_PST: readonly number[] = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10,   0,   0,   0,   0,   0,   0, -10,
  -10,   0,   5,  10,  10,   5,   0, -10,
  -10,   5,   5,  10,  10,   5,   5, -10,
  -10,   0,  10,  10,  10,  10,   0, -10,
  -10,  10,  10,  10,  10,  10,  10, -10,
  -10,   5,   0,   0,   0,   0,   5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20
];

const ROOK_PST: readonly number[] = [
    0,   0,   0,   0,   0,   0,   0,   0,
    5,  10,  10,  10,  10,  10,  10,   5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
    0,   0,   0,   5,   5,   0,   0,   0
];

const QUEEN_PST: readonly number[] = [
  -20, -10, -10,  -5,  -5, -10, -10, -20,
  -10,   0,   0,   0,   0,   0,   0, -10,
  -10,   0,   5,   5,   5,   5,   0, -10,
   -5,   0,   5,   5,   5,   5,   0,  -5,
    0,   0,   5,   5,   5,   5,   0,  -5,
  -10,   5,   5,   5,   5,   5,   0, -10,
  -10,   0,   5,   0,   0,   0,   0, -10,
  -20, -10, -10,  -5,  -5, -10, -10, -20
];

const KING_PST_MG: readonly number[] = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
   20,  20,   0,   0,   0,   0,  20,  20,
   20,  30,  10,   0,   0,  10,  30,  20
];

const KING_PST_EG: readonly number[] = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10,   0,   0, -10, -20, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -30,   0,   0,   0,   0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50
];

function squareToIndex(square: string): number {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = 8 - parseInt(square[1], 10); // '8' -> 0, '1' -> 7
  return rank * 8 + file;
}

function getPieceSquareBonus(
  type: PieceSymbol,
  color: Color,
  sqIndex: number,
  isEndgame: boolean
): number {
  const tableIndex = color === 'w' ? sqIndex : sqIndex ^ 56;
  switch (type) {
    case 'p':
      return isEndgame ? PAWN_PST_EG[tableIndex] : PAWN_PST_MG[tableIndex];
    case 'n':
      return KNIGHT_PST[tableIndex];
    case 'b':
      return BISHOP_PST[tableIndex];
    case 'r':
      return ROOK_PST[tableIndex];
    case 'q':
      return QUEEN_PST[tableIndex];
    case 'k':
      return isEndgame ? KING_PST_EG[tableIndex] : KING_PST_MG[tableIndex];
  }
}

/**
 * Evaluates the current board from the perspective of `chess.turn()`.
 * Positive values favor the side to move.
 */
export function evaluatePosition(chess: Chess, includeAdvanced = false): number {
  const board = chess.board();
  let whiteMaterial = 0;
  let blackMaterial = 0;
  let nonPawnMaterial = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  for (let r = 0; r < 8; r++) {
    const row = board[r];
    for (let c = 0; c < 8; c++) {
      const cell = row[c];
      if (!cell) continue;
      const val = PIECE_VALUES[cell.type];
      if (cell.color === 'w') {
        whiteMaterial += val;
        if (cell.type === 'b') whiteBishops++;
      } else {
        blackMaterial += val;
        if (cell.type === 'b') blackBishops++;
      }
      if (cell.type !== 'p' && cell.type !== 'k') {
        nonPawnMaterial += val;
      }
    }
  }

  const isEndgame = nonPawnMaterial <= 2600;
  let whitePositional = 0;
  let blackPositional = 0;
  let whiteKingRow = 7;
  let whiteKingCol = 4;
  let blackKingRow = 0;
  let blackKingCol = 4;

  for (let r = 0; r < 8; r++) {
    const row = board[r];
    for (let c = 0; c < 8; c++) {
      const cell = row[c];
      if (!cell) continue;
      const sqIndex = r * 8 + c;
      const bonus = getPieceSquareBonus(cell.type, cell.color, sqIndex, isEndgame);
      if (cell.color === 'w') {
        whitePositional += bonus;
        if (cell.type === 'k') {
          whiteKingRow = r;
          whiteKingCol = c;
        }
      } else {
        blackPositional += bonus;
        if (cell.type === 'k') {
          blackKingRow = r;
          blackKingCol = c;
        }
      }
    }
  }

  // Bishop pair bonus
  if (whiteBishops >= 2) whitePositional += 30;
  if (blackBishops >= 2) blackPositional += 30;

  if (includeAdvanced) {
    // Middlegame King Pawn Shield bonus
    if (!isEndgame) {
      if (whiteKingRow >= 6) {
        const shieldRow = whiteKingRow - 1;
        for (let dc = -1; dc <= 1; dc++) {
          const sc = whiteKingCol + dc;
          if (sc >= 0 && sc < 8) {
            const shieldPiece = board[shieldRow]?.[sc];
            if (shieldPiece && shieldPiece.color === 'w' && shieldPiece.type === 'p') {
              whitePositional += 12;
            }
          }
        }
      }
      if (blackKingRow <= 1) {
        const shieldRow = blackKingRow + 1;
        for (let dc = -1; dc <= 1; dc++) {
          const sc = blackKingCol + dc;
          if (sc >= 0 && sc < 8) {
            const shieldPiece = board[shieldRow]?.[sc];
            if (shieldPiece && shieldPiece.color === 'b' && shieldPiece.type === 'p') {
              blackPositional += 12;
            }
          }
        }
      }
    } else {
      // Endgame: reward pushing the enemy king toward the corner/edge when ahead in material
      const materialAdvantage = whiteMaterial - blackMaterial;
      if (materialAdvantage >= 300) {
        const enemyCenterDist = Math.abs(3.5 - blackKingRow) + Math.abs(3.5 - blackKingCol);
        const kingProximity =
          14 - (Math.abs(whiteKingRow - blackKingRow) + Math.abs(whiteKingCol - blackKingCol));
        whitePositional += Math.round(enemyCenterDist * 10 + kingProximity * 4);
      } else if (materialAdvantage <= -300) {
        const enemyCenterDist = Math.abs(3.5 - whiteKingRow) + Math.abs(3.5 - whiteKingCol);
        const kingProximity =
          14 - (Math.abs(whiteKingRow - blackKingRow) + Math.abs(whiteKingCol - blackKingCol));
        blackPositional += Math.round(enemyCenterDist * 10 + kingProximity * 4);
      }
    }
  }

  const whiteScore = whiteMaterial + whitePositional;
  const blackScore = blackMaterial + blackPositional;
  const diff = whiteScore - blackScore;

  return chess.turn() === 'w' ? diff : -diff;
}

/**
 * Scores a move for move ordering (MVV-LVA + promotions + checks + PST delta).
 */
function scoreMoveForOrdering(move: Move, pvMove?: AIMove | null): number {
  if (
    pvMove &&
    move.from === pvMove.from &&
    move.to === pvMove.to &&
    move.promotion === pvMove.promotion
  ) {
    return 100000;
  }

  let score = 0;

  if (move.san.endsWith('#')) {
    return 90000;
  }

  if (move.promotion) {
    score += 15000 + PIECE_VALUES[move.promotion as PieceSymbol];
  }

  if (move.captured) {
    const victim = PIECE_VALUES[move.captured as PieceSymbol] ?? 100;
    const attacker = PIECE_VALUES[move.piece as PieceSymbol] ?? 100;
    // MVV-LVA: prioritize high-value victims captured by low-value attackers
    score += 5000 + victim * 10 - Math.floor(attacker / 10);
  } else if (move.flags.includes('e')) {
    score += 5990;
  }

  if (move.san.endsWith('+')) {
    score += 900;
  }

  if (move.flags.includes('k') || move.flags.includes('q')) {
    score += 350;
  }

  const fromIdx = squareToIndex(move.from);
  const toIdx = squareToIndex(move.to);
  const pstGain =
    getPieceSquareBonus(move.piece as PieceSymbol, move.color, toIdx, false) -
    getPieceSquareBonus(move.piece as PieceSymbol, move.color, fromIdx, false);
  score += pstGain;

  return score;
}

function orderMoves(moves: Move[], pvMove?: AIMove | null): Move[] {
  if (moves.length <= 1) return moves;
  const decorated = moves.map((move) => ({
    move,
    orderScore: scoreMoveForOrdering(move, pvMove)
  }));
  decorated.sort((a, b) => b.orderScore - a.orderScore);
  return decorated.map((d) => d.move);
}

/**
 * Quiescence search on captures and promotions to prevent horizon-effect blunders.
 */
function quiescence(
  chess: Chess,
  alpha: number,
  beta: number,
  qDepth: number,
  includeAdvanced: boolean,
  deadline: number
): number {
  if (chess.isCheckmate()) {
    return -MATE_SCORE + 20 + qDepth;
  }
  if (chess.isDraw()) {
    return 0;
  }

  const standPat = evaluatePosition(chess, includeAdvanced);
  if (standPat >= beta) {
    return beta;
  }
  if (standPat > alpha) {
    alpha = standPat;
  }

  if (qDepth >= MAX_QUIESCENCE_DEPTH || (deadline > 0 && Date.now() >= deadline)) {
    return alpha;
  }

  const allMoves = chess.moves({ verbose: true }) as Move[];
  const tacticalMoves = allMoves.filter(
    (m) => m.captured !== undefined || m.promotion !== undefined || m.flags.includes('e')
  );

  if (tacticalMoves.length === 0) {
    return alpha;
  }

  const ordered = orderMoves(tacticalMoves);

  for (const move of ordered) {
    chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion
    });
    const score = -quiescence(chess, -beta, -alpha, qDepth + 1, includeAdvanced, deadline);
    chess.undo();

    if (score >= beta) {
      return beta;
    }
    if (score > alpha) {
      alpha = score;
    }
  }

  return alpha;
}

/**
 * Negamax search with Alpha-Beta pruning.
 */
function negamax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  useQuiescence: boolean,
  includeAdvanced: boolean,
  deadline: number
): number {
  if (chess.isCheckmate()) {
    return -MATE_SCORE + ply;
  }
  if (chess.isDraw()) {
    return 0;
  }

  if (depth <= 0) {
    if (useQuiescence) {
      return quiescence(chess, alpha, beta, 0, includeAdvanced, deadline);
    }
    return evaluatePosition(chess, includeAdvanced);
  }

  const rawMoves = chess.moves({ verbose: true }) as Move[];
  if (rawMoves.length === 0) {
    return chess.inCheck() ? -MATE_SCORE + ply : 0;
  }

  const orderedMoves = orderMoves(rawMoves);
  let bestScore = -Infinity;

  for (const move of orderedMoves) {
    chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion
    });

    const score = -negamax(
      chess,
      depth - 1,
      -beta,
      -alpha,
      ply + 1,
      useQuiescence,
      includeAdvanced,
      deadline
    );

    chess.undo();

    if (score > bestScore) {
      bestScore = score;
    }
    if (score > alpha) {
      alpha = score;
    }
    if (alpha >= beta) {
      break;
    }
    if (deadline > 0 && Date.now() >= deadline) {
      break;
    }
  }

  return bestScore;
}

function toAIMove(move: Move): AIMove {
  if (move.promotion) {
    return {
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion as PieceSymbol
    };
  }
  return {
    from: move.from as Square,
    to: move.to as Square
  };
}

/**
 * Core synchronous search routine used by both the Web Worker and direct fallback.
 * Guaranteed to return a strictly legal move for `fen`, or `null` if no legal moves exist.
 */
export function searchBestMove(fen: string, difficulty: AIDifficulty = 'knight'): AIMove | null {
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

  if (legalMoves.length === 1) {
    return toAIMove(legalMoves[0]);
  }

  // Immediate checkmate in 1 is always taken at all difficulties
  for (const m of legalMoves) {
    if (m.san.endsWith('#')) {
      return toAIMove(m);
    }
  }

  const config = {
    novice: {
      maxDepth: 1,
      useQuiescence: false,
      includeAdvanced: false,
      jitter: 45,
      timeBudgetMs: 0
    },
    knight: {
      maxDepth: 2,
      useQuiescence: true,
      includeAdvanced: false,
      jitter: 0,
      timeBudgetMs: 0
    },
    archmage: {
      maxDepth: 3,
      useQuiescence: true,
      includeAdvanced: true,
      jitter: 0,
      timeBudgetMs: 0
    },
    grandmaster: {
      maxDepth: 4,
      useQuiescence: true,
      includeAdvanced: true,
      jitter: 0,
      timeBudgetMs: 550
    }
  }[difficulty] ?? {
    maxDepth: 2,
    useQuiescence: true,
    includeAdvanced: false,
    jitter: 0,
    timeBudgetMs: 0
  };

  const startTime = Date.now();
  const deadline = config.timeBudgetMs > 0 ? startTime + config.timeBudgetMs : 0;

  let bestMove: AIMove = toAIMove(orderMoves(legalMoves)[0]);
  const startDepth = difficulty === 'grandmaster' ? 2 : config.maxDepth;

  for (let currentDepth = startDepth; currentDepth <= config.maxDepth; currentDepth++) {
    const orderedRootMoves = orderMoves(legalMoves, bestMove);
    let alpha = -Infinity;
    const beta = Infinity;
    let iterationBestMove: AIMove = toAIMove(orderedRootMoves[0]);
    let iterationBestScore = -Infinity;
    let aborted = false;

    for (const move of orderedRootMoves) {
      chess.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion
      });

      let score = -negamax(
        chess,
        currentDepth - 1,
        -beta,
        -alpha,
        1,
        config.useQuiescence,
        config.includeAdvanced,
        deadline
      );

      chess.undo();

      if (config.jitter > 0) {
        score += (Math.random() * 2 - 1) * config.jitter;
      }

      if (score > iterationBestScore) {
        iterationBestScore = score;
        iterationBestMove = toAIMove(move);
      }

      if (score > alpha) {
        alpha = score;
      }

      if (deadline > 0 && currentDepth > startDepth && Date.now() >= deadline) {
        aborted = true;
        break;
      }
    }

    if (!aborted || iterationBestScore > MATE_SCORE - 100) {
      bestMove = iterationBestMove;
    }

    // Stop deepening early if forced checkmate is already found or time budget reached
    if (
      iterationBestScore >= MATE_SCORE - 50 ||
      (deadline > 0 && Date.now() >= deadline)
    ) {
      break;
    }
  }

  // Final safety verification: confirm bestMove is strictly in legalMoves
  const verified = legalMoves.find(
    (m) =>
      m.from === bestMove.from &&
      m.to === bestMove.to &&
      (m.promotion ?? undefined) === (bestMove.promotion ?? undefined)
  );

  return verified ? toAIMove(verified) : toAIMove(legalMoves[0]);
}

interface WorkerScopeLike {
  onmessage: ((event: MessageEvent<AIWorkerRequest>) => void) | null;
  postMessage: (message: AIWorkerResponse) => void;
}

// Register Web Worker message handler only when running in a Worker context
const isWorkerEnvironment =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as WorkerScopeLike).postMessage === 'function';

if (isWorkerEnvironment) {
  const workerScope = self as unknown as WorkerScopeLike;
  workerScope.onmessage = (event: MessageEvent<AIWorkerRequest>) => {
    const { id, fen, difficulty } = event.data ?? {};
    try {
      const move = searchBestMove(fen, difficulty);
      const response: AIWorkerResponse = { id, move };
      workerScope.postMessage(response);
    } catch (err) {
      const response: AIWorkerResponse = {
        id,
        move: null,
        error: err instanceof Error ? err.message : String(err)
      };
      workerScope.postMessage(response);
    }
  };
}
