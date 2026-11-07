import type { Color, PieceSymbol, Square } from 'chess.js';

export type { Color, PieceSymbol, Square };

export type GameMode = 'ai' | 'local' | 'online';
export type AIDifficulty = 'novice' | 'knight' | 'archmage' | 'grandmaster';
export type TimeControlMinutes = 0 | 3 | 5 | 10 | 15;
export type MapId = 'cathedral' | 'warhall' | 'sanctum' | 'classic';
export type PieceSkinId = 'arcane_royalty' | 'runic_warforged' | 'mystic_sanctum' | 'classic';
export type Language = 'en' | 'id';

export interface CastlingRookMove {
  side: 'k' | 'q';
  rookFrom: Square;
  rookTo: Square;
}

export interface MoveRecord {
  ply: number;
  moveNumber: number;
  color: Color;
  piece: PieceSymbol;
  from: Square;
  to: Square;
  san: string;
  lan: string;
  flags: string;
  captured?: PieceSymbol;
  capturedSquare?: Square;
  promotion?: PieceSymbol;
  castling?: CastlingRookMove;
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  fenBefore: string;
  fenAfter: string;
  timestamp: number;
}

export interface LegalDestination {
  square: Square;
  san: string;
  isCapture: boolean;
  isEnPassant: boolean;
  isCastling: boolean;
  isPromotion: boolean;
  promotionOptions?: PieceSymbol[];
  capturedPiece?: PieceSymbol;
}

export type GameResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold_repetition'
  | 'insufficient_material'
  | 'fifty_move_rule'
  | 'timeout'
  | 'resignation'
  | 'agreement'
  | null;

export interface CapturedPiecesState {
  /** White pieces captured by Black */
  w: PieceSymbol[];
  /** Black pieces captured by White */
  b: PieceSymbol[];
  /** Material balance from White's perspective (positive = White ahead) */
  materialDiff: number;
}

export interface BoardPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export interface GameConfig {
  mode: GameMode;
  playerColor: Color;
  aiDifficulty: AIDifficulty;
  timeControlMinutes: TimeControlMinutes;
  mapId?: MapId;
  skinId?: PieceSkinId;
  onlineRoomCode?: string;
  onlineStatus?: OnlineRoomStatus;
}

export type OnlineRoomStatus = 'waiting' | 'playing' | 'finished';

export interface OnlineSeatPublicState {
  joined: boolean;
  connected: boolean;
  lastSeenAt: number;
  rematchRequested: boolean;
}

export interface PublicRoomView {
  roomCode: string;
  version: number;
  status: OnlineRoomStatus;
  mapId: MapId;
  timeControlMinutes: TimeControlMinutes;
  fen: string;
  turn: Color;
  moveHistory: MoveRecord[];
  lastMove: { from: Square; to: Square } | null;
  inCheck: boolean;
  kingInCheckSquare: Square | null;
  isGameOver: boolean;
  winner: Color | 'draw' | null;
  resultReason: GameResultReason;
  seats: {
    w: OnlineSeatPublicState;
    b: OnlineSeatPublicState;
  };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  storageMode?: 'redis' | 'memory';
}

export interface ClockState {
  enabled: boolean;
  whiteMs: number;
  blackMs: number;
  activeColor: Color | null;
}

export interface GameStateSnapshot {
  fen: string;
  turn: Color;
  moveHistory: MoveRecord[];
  captured: CapturedPiecesState;
  inCheck: boolean;
  kingInCheckSquare: Square | null;
  isGameOver: boolean;
  winner: Color | 'draw' | null;
  resultReason: GameResultReason;
  selectedSquare: Square | null;
  legalDestinations: LegalDestination[];
  lastMove: { from: Square; to: Square } | null;
  config: GameConfig;
  clock: ClockState;
}

export interface MoveExecutionResult {
  valid: boolean;
  requiresPromotion?: boolean;
  pendingPromotion?: {
    from: Square;
    to: Square;
    color: Color;
  };
  move?: MoveRecord;
  error?: string;
}
