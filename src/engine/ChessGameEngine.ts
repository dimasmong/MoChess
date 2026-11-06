import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type {
  BoardPiece,
  CapturedPiecesState,
  CastlingRookMove,
  ClockState,
  GameConfig,
  GameResultReason,
  GameStateSnapshot,
  LegalDestination,
  MapId,
  MoveExecutionResult,
  MoveRecord,
  PieceSkinId,
  PublicRoomView
} from './types';

const STORAGE_KEY = 'mochess_arcane_kingdom_state_v1';

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0
};

const CAPTURE_SORT_ORDER: Record<PieceSymbol, number> = {
  q: 5,
  r: 4,
  b: 3,
  n: 2,
  p: 1,
  k: 0
};

export type EngineListener = (snapshot: GameStateSnapshot, lastMove?: MoveRecord) => void;

export class ChessGameEngine {
  private chess: Chess;
  private moveHistory: MoveRecord[] = [];
  private selectedSquare: Square | null = null;
  private legalDestinations: LegalDestination[] = [];
  private pendingPromotion: { from: Square; to: Square; color: Color } | null = null;
  private config: GameConfig;
  private clock: ClockState;
  private customResult: { winner: Color | 'draw'; reason: GameResultReason } | null = null;
  private listeners: Set<EngineListener> = new Set();

  constructor(initialConfig?: Partial<GameConfig>) {
    this.chess = new Chess();
    this.config = {
      mode: initialConfig?.mode ?? 'ai',
      playerColor: initialConfig?.playerColor ?? 'w',
      aiDifficulty: initialConfig?.aiDifficulty ?? 'knight',
      timeControlMinutes: initialConfig?.timeControlMinutes ?? 10,
      mapId: initialConfig?.mapId ?? 'cathedral',
      skinId: initialConfig?.skinId ?? 'arcane_royalty'
    };
    const initialMs = this.config.timeControlMinutes * 60 * 1000;
    this.clock = {
      enabled: this.config.timeControlMinutes > 0,
      whiteMs: initialMs,
      blackMs: initialMs,
      activeColor: null
    };
  }

  public subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(lastMove?: MoveRecord): void {
    const snapshot = this.getSnapshot();
    this.saveToStorage();
    for (const listener of this.listeners) {
      listener(snapshot, lastMove);
    }
  }

  public getConfig(): GameConfig {
    return { ...this.config };
  }

  public setMap(mapId: MapId): void {
    this.config.mapId = mapId;
    this.emit();
  }

  public setSkin(skinId: PieceSkinId): void {
    this.config.skinId = skinId;
    this.emit();
  }

  public getFen(): string {
    return this.chess.fen();
  }

  public getTurn(): Color {
    return this.chess.turn();
  }

  public getPieceAt(square: Square): { type: PieceSymbol; color: Color } | null {
    const piece = this.chess.get(square);
    return piece ? { type: piece.type, color: piece.color } : null;
  }

  public getAllPieces(): BoardPiece[] {
    const pieces: BoardPiece[] = [];
    const board = this.chess.board();
    for (const row of board) {
      for (const cell of row) {
        if (cell) {
          pieces.push({
            square: cell.square as Square,
            type: cell.type,
            color: cell.color
          });
        }
      }
    }
    return pieces;
  }

  public findKingSquare(color: Color): Square | null {
    const board = this.chess.board();
    for (const row of board) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === color) {
          return cell.square as Square;
        }
      }
    }
    return null;
  }

  public isHumanTurn(): boolean {
    if (this.isGameOver()) return false;
    if (this.config.mode === 'local') return true;
    return this.chess.turn() === this.config.playerColor;
  }

  public isAITurn(): boolean {
    if (this.isGameOver()) return false;
    return this.config.mode === 'ai' && this.chess.turn() !== this.config.playerColor;
  }

  public isGameOver(): boolean {
    return this.customResult !== null || this.chess.isGameOver();
  }

  public getGameResult(): { isGameOver: boolean; winner: Color | 'draw' | null; reason: GameResultReason } {
    if (this.customResult) {
      return {
        isGameOver: true,
        winner: this.customResult.winner,
        reason: this.customResult.reason
      };
    }

    if (!this.chess.isGameOver()) {
      return { isGameOver: false, winner: null, reason: null };
    }

    if (this.chess.isCheckmate()) {
      const winner: Color = this.chess.turn() === 'w' ? 'b' : 'w';
      return { isGameOver: true, winner, reason: 'checkmate' };
    }

    if (this.chess.isStalemate()) {
      return { isGameOver: true, winner: 'draw', reason: 'stalemate' };
    }

    if (this.chess.isThreefoldRepetition()) {
      return { isGameOver: true, winner: 'draw', reason: 'threefold_repetition' };
    }

    if (this.chess.isInsufficientMaterial()) {
      return { isGameOver: true, winner: 'draw', reason: 'insufficient_material' };
    }

    if (this.chess.isDraw()) {
      return { isGameOver: true, winner: 'draw', reason: 'fifty_move_rule' };
    }

    return { isGameOver: false, winner: null, reason: null };
  }

  public getCapturedPieces(): CapturedPiecesState {
    const wCaptured: PieceSymbol[] = [];
    const bCaptured: PieceSymbol[] = [];

    for (const record of this.moveHistory) {
      if (record.captured) {
        if (record.color === 'w') {
          bCaptured.push(record.captured);
        } else {
          wCaptured.push(record.captured);
        }
      }
    }

    wCaptured.sort((a, b) => CAPTURE_SORT_ORDER[b] - CAPTURE_SORT_ORDER[a]);
    bCaptured.sort((a, b) => CAPTURE_SORT_ORDER[b] - CAPTURE_SORT_ORDER[a]);

    let whiteTotal = 0;
    let blackTotal = 0;
    for (const p of this.getAllPieces()) {
      if (p.color === 'w') whiteTotal += PIECE_VALUES[p.type];
      else blackTotal += PIECE_VALUES[p.type];
    }

    return {
      w: wCaptured,
      b: bCaptured,
      materialDiff: whiteTotal - blackTotal
    };
  }

  public getLegalDestinationsForSquare(square: Square): LegalDestination[] {
    if (this.isGameOver()) return [];
    const piece = this.chess.get(square);
    if (!piece || piece.color !== this.chess.turn()) {
      return [];
    }

    const verboseMoves = this.chess.moves({ square, verbose: true }) as Move[];
    const byTarget = new Map<Square, Move[]>();

    for (const m of verboseMoves) {
      const target = m.to as Square;
      const list = byTarget.get(target) ?? [];
      list.push(m);
      byTarget.set(target, list);
    }

    const destinations: LegalDestination[] = [];
    for (const [targetSquare, moves] of byTarget.entries()) {
      const first = moves[0];
      const isPromotion = moves.some((m) => Boolean(m.promotion));
      const isEnPassant = first.flags.includes('e');
      const isCastling = first.flags.includes('k') || first.flags.includes('q');
      const isCapture = first.flags.includes('c') || isEnPassant;

      destinations.push({
        square: targetSquare,
        san: first.san,
        isCapture,
        isEnPassant,
        isCastling,
        isPromotion,
        promotionOptions: isPromotion
          ? (moves.map((m) => m.promotion).filter(Boolean) as PieceSymbol[])
          : undefined,
        capturedPiece: first.captured as PieceSymbol | undefined
      });
    }

    return destinations;
  }

  public selectSquare(square: Square | null): LegalDestination[] {
    if (!square || this.isGameOver() || (this.config.mode === 'online' && !this.isHumanTurn())) {
      this.selectedSquare = null;
      this.legalDestinations = [];
      this.emit();
      return [];
    }

    const piece = this.chess.get(square);
    if (!piece || piece.color !== this.chess.turn()) {
      this.selectedSquare = null;
      this.legalDestinations = [];
      this.emit();
      return [];
    }

    this.selectedSquare = square;
    this.legalDestinations = this.getLegalDestinationsForSquare(square);
    this.emit();
    return this.legalDestinations;
  }

  /**
   * High-level square interaction handler used by the 3D board & UI:
   * - If a friendly piece is already selected and `square` is a legal destination, executes the move (or requests promotion).
   * - If `square` contains a friendly piece of the side to move, selects that piece.
   * - Otherwise clears selection without mutating game state.
   */
  public handleSquareInteraction(square: Square): MoveExecutionResult | { action: 'selected' | 'deselected'; destinations: LegalDestination[] } {
    if (this.isGameOver() || (this.config.mode === 'online' && !this.isHumanTurn())) {
      return { action: 'deselected', destinations: [] };
    }

    if (this.selectedSquare) {
      const isDestination = this.legalDestinations.some((d) => d.square === square);
      if (isDestination) {
        return this.executeMove(this.selectedSquare, square);
      }
    }

    const piece = this.chess.get(square);
    if (piece && piece.color === this.chess.turn()) {
      if (this.selectedSquare === square) {
        this.selectSquare(null);
        return { action: 'deselected', destinations: [] };
      }
      const destinations = this.selectSquare(square);
      return { action: 'selected', destinations };
    }

    this.selectSquare(null);
    return { action: 'deselected', destinations: [] };
  }

  /**
   * Executes a move from `from` to `to`.
   * Invalid moves NEVER mutate game state.
   * If a pawn reaches promotion rank without `promotion` parameter, returns `requiresPromotion: true` without mutating state.
   */
  public executeMove(from: Square, to: Square, promotion?: PieceSymbol): MoveExecutionResult {
    if (this.isGameOver()) {
      return { valid: false, error: 'Game is already over.' };
    }

    const movingPiece = this.chess.get(from);
    if (!movingPiece) {
      return { valid: false, error: `No piece at square ${from}.` };
    }

    if (movingPiece.color !== this.chess.turn()) {
      return { valid: false, error: `It is not ${movingPiece.color === 'w' ? 'White' : 'Black'}'s turn.` };
    }

    // Check legal moves from this square first so we never mutate state on invalid moves
    const legalFromSquare = (this.chess.moves({ square: from, verbose: true }) as Move[]).filter(
      (m) => m.to === to
    );

    if (legalFromSquare.length === 0) {
      return { valid: false, error: `Illegal move from ${from} to ${to}.` };
    }

    const needsPromotion = legalFromSquare.some((m) => Boolean(m.promotion));
    if (needsPromotion && !promotion) {
      this.pendingPromotion = { from, to, color: movingPiece.color };
      return {
        valid: false,
        requiresPromotion: true,
        pendingPromotion: { from, to, color: movingPiece.color }
      };
    }

    if (needsPromotion && promotion && !['q', 'r', 'b', 'n'].includes(promotion)) {
      return { valid: false, error: `Invalid promotion piece: ${promotion}` };
    }

    const fenBefore = this.chess.fen();
    let executed: Move;
    try {
      executed = this.chess.move({
        from,
        to,
        promotion: needsPromotion ? promotion : undefined
      });
    } catch {
      return { valid: false, error: `Move rejected by rules engine: ${from}->${to}` };
    }

    this.pendingPromotion = null;
    this.selectedSquare = null;
    this.legalDestinations = [];

    const record = this.buildMoveRecord(executed, fenBefore, this.chess.fen());
    this.moveHistory.push(record);

    if (this.clock.enabled) {
      this.clock.activeColor = this.isGameOver() ? null : this.chess.turn();
    }

    this.emit(record);
    return { valid: true, move: record };
  }

  public completePromotion(promotionPiece: PieceSymbol): MoveExecutionResult {
    if (!this.pendingPromotion) {
      return { valid: false, error: 'No pending promotion.' };
    }
    const { from, to } = this.pendingPromotion;
    return this.executeMove(from, to, promotionPiece);
  }

  public cancelPendingPromotion(): void {
    this.pendingPromotion = null;
    this.emit();
  }

  private buildMoveRecord(move: Move, fenBefore: string, fenAfter: string): MoveRecord {
    const ply = this.moveHistory.length + 1;
    const moveNumber = Math.ceil(ply / 2);

    let capturedSquare: Square | undefined;
    if (move.captured) {
      if (move.flags.includes('e')) {
        // En passant: captured pawn was on target file and starting rank
        const file = move.to[0];
        const rank = move.from[1];
        capturedSquare = `${file}${rank}` as Square;
      } else {
        capturedSquare = move.to as Square;
      }
    }

    let castling: CastlingRookMove | undefined;
    if (move.flags.includes('k')) {
      const rank = move.color === 'w' ? '1' : '8';
      castling = {
        side: 'k',
        rookFrom: `h${rank}` as Square,
        rookTo: `f${rank}` as Square
      };
    } else if (move.flags.includes('q')) {
      const rank = move.color === 'w' ? '1' : '8';
      castling = {
        side: 'q',
        rookFrom: `a${rank}` as Square,
        rookTo: `d${rank}` as Square
      };
    }

    return {
      ply,
      moveNumber,
      color: move.color,
      piece: move.piece,
      from: move.from as Square,
      to: move.to as Square,
      san: move.san,
      lan: move.lan,
      flags: move.flags,
      captured: move.captured as PieceSymbol | undefined,
      capturedSquare,
      promotion: move.promotion as PieceSymbol | undefined,
      castling,
      isCheck: this.chess.inCheck(),
      isCheckmate: this.chess.isCheckmate(),
      isDraw: this.chess.isDraw(),
      fenBefore,
      fenAfter,
      timestamp: Date.now()
    };
  }

  /**
   * Undoes the last move (or last 2 plies in Human vs AI mode if it is currently the human's turn,
   * so the human reverts back to their own decision point).
   * Pass `singlePly = true` to strictly undo exactly one ply.
   */
  public undo(singlePly = false): boolean {
    if (this.moveHistory.length === 0) {
      return false;
    }

    this.customResult = null;
    this.pendingPromotion = null;
    this.selectedSquare = null;
    this.legalDestinations = [];

    let pliesToUndo = 1;
    if (!singlePly && this.config.mode === 'ai') {
      // If it's the human's turn and at least 2 plies exist, undo both AI's reply and human's move
      if (this.chess.turn() === this.config.playerColor && this.moveHistory.length >= 2) {
        pliesToUndo = 2;
      } else {
        pliesToUndo = 1;
      }
    }

    for (let i = 0; i < pliesToUndo; i++) {
      const undone = this.chess.undo();
      if (!undone) break;
      this.moveHistory.pop();
    }

    if (this.clock.enabled) {
      this.clock.activeColor = this.moveHistory.length > 0 ? this.chess.turn() : null;
    }

    this.emit();
    return true;
  }

  /**
   * Restarts the current match with the exact same configuration.
   */
  public restart(): void {
    this.startNewGame(this.config);
  }

  /**
   * Starts a brand new match with optional updated configuration.
   */
  public startNewGame(newConfig?: Partial<GameConfig>): void {
    if (newConfig) {
      this.config = {
        ...this.config,
        ...newConfig
      };
    }

    this.chess.reset();
    this.moveHistory = [];
    this.selectedSquare = null;
    this.legalDestinations = [];
    this.pendingPromotion = null;
    this.customResult = null;

    const initialMs = this.config.timeControlMinutes * 60 * 1000;
    this.clock = {
      enabled: this.config.timeControlMinutes > 0,
      whiteMs: initialMs,
      blackMs: initialMs,
      activeColor: null
    };

    this.emit();
  }

  /**
   * Loads an arbitrary FEN position (useful for testing check, checkmate, castling, en passant, promotion).
   */
  public loadFen(fen: string): boolean {
    try {
      this.chess.load(fen);
      this.moveHistory = [];
      this.selectedSquare = null;
      this.legalDestinations = [];
      this.pendingPromotion = null;
      this.customResult = null;
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Advances the active player's clock by `deltaMs`.
   */
  public tickClock(deltaMs: number): void {
    if (!this.clock.enabled || !this.clock.activeColor || this.isGameOver()) {
      return;
    }

    if (this.clock.activeColor === 'w') {
      this.clock.whiteMs = Math.max(0, this.clock.whiteMs - deltaMs);
      if (this.clock.whiteMs === 0) {
        this.customResult = { winner: 'b', reason: 'timeout' };
        this.clock.activeColor = null;
        this.emit();
      }
    } else {
      this.clock.blackMs = Math.max(0, this.clock.blackMs - deltaMs);
      if (this.clock.blackMs === 0) {
        this.customResult = { winner: 'w', reason: 'timeout' };
        this.clock.activeColor = null;
        this.emit();
      }
    }
  }

  public getSnapshot(): GameStateSnapshot {
    const result = this.getGameResult();
    const inCheck = this.chess.inCheck();
    const turn = this.chess.turn();
    const lastMoveRecord = this.moveHistory[this.moveHistory.length - 1];

    return {
      fen: this.chess.fen(),
      turn,
      moveHistory: [...this.moveHistory],
      captured: this.getCapturedPieces(),
      inCheck,
      kingInCheckSquare: inCheck ? this.findKingSquare(turn) : null,
      isGameOver: result.isGameOver,
      winner: result.winner,
      resultReason: result.reason,
      selectedSquare: this.selectedSquare,
      legalDestinations: [...this.legalDestinations],
      lastMove: lastMoveRecord ? { from: lastMoveRecord.from, to: lastMoveRecord.to } : null,
      config: { ...this.config },
      clock: { ...this.clock }
    };
  }

  /**
   * Synchronizes the local rules engine with an authoritative Online PvP room state.
   * Returns any newly applied MoveRecord so the caller can play sound effects / animations.
   */
  public syncFromOnlineRoom(room: PublicRoomView, playerColor: Color): MoveRecord | undefined {
    const prevMode = this.config.mode;
    const prevColor = this.config.playerColor;
    const prevRoomCode = this.config.onlineRoomCode;
    const prevMap = this.config.mapId;

    this.config = {
      ...this.config,
      mode: 'online',
      playerColor,
      mapId: room.mapId,
      timeControlMinutes: room.timeControlMinutes,
      onlineRoomCode: room.roomCode
    };

    const configChanged =
      prevMode !== 'online' ||
      prevColor !== playerColor ||
      prevRoomCode !== room.roomCode ||
      prevMap !== room.mapId;

    // 1. Check if the server room was reset for a rematch
    if (room.moveHistory.length === 0 && (this.moveHistory.length > 0 || this.customResult !== null)) {
      this.chess.reset();
      this.moveHistory = [];
      this.selectedSquare = null;
      this.legalDestinations = [];
      this.pendingPromotion = null;
      this.customResult = null;
      this.emit();
      return undefined;
    }

    let animatedMove: MoveRecord | undefined;
    let boardChanged = false;
    const prevHistoryLen = this.moveHistory.length;

    // 2. Check if 1 new move was played on top of our current state
    if (
      room.moveHistory.length === prevHistoryLen + 1 &&
      room.moveHistory[room.moveHistory.length - 1].fenBefore === this.chess.fen()
    ) {
      const latest = room.moveHistory[room.moveHistory.length - 1];
      try {
        this.chess.move({
          from: latest.from,
          to: latest.to,
          promotion: latest.promotion
        });
        this.moveHistory.push(latest);
        this.selectedSquare = null;
        this.legalDestinations = [];
        this.pendingPromotion = null;
        animatedMove = latest;
        boardChanged = true;
      } catch {
        this.chess.load(room.fen);
        this.moveHistory = [...room.moveHistory];
        boardChanged = true;
      }
    } else if (
      room.fen !== this.chess.fen() ||
      room.moveHistory.length !== prevHistoryLen
    ) {
      // Full replay on reconnect / mid-game join / multi-ply catchup
      this.chess.reset();
      let replayed = true;
      for (const rec of room.moveHistory) {
        try {
          this.chess.move({
            from: rec.from,
            to: rec.to,
            promotion: rec.promotion
          });
        } catch {
          replayed = false;
          break;
        }
      }
      if (!replayed || this.chess.fen() !== room.fen) {
        this.chess.load(room.fen);
      }
      this.moveHistory = [...room.moveHistory];
      this.selectedSquare = null;
      this.legalDestinations = [];
      this.pendingPromotion = null;
      boardChanged = true;
      if (room.moveHistory.length > prevHistoryLen) {
        animatedMove = room.moveHistory[room.moveHistory.length - 1];
      }
    }

    // 3. Synchronize custom result (e.g. resignation or timeout)
    let resultChanged = false;
    if (room.isGameOver && room.winner && (room.resultReason === 'resignation' || room.resultReason === 'timeout')) {
      if (
        !this.customResult ||
        this.customResult.winner !== room.winner ||
        this.customResult.reason !== room.resultReason
      ) {
        this.customResult = { winner: room.winner, reason: room.resultReason };
        resultChanged = true;
      }
    } else if (!room.isGameOver && this.customResult !== null) {
      this.customResult = null;
      resultChanged = true;
    }

    if (boardChanged || animatedMove || configChanged || resultChanged) {
      this.emit(animatedMove);
    }

    return animatedMove;
  }

  public saveToStorage(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      if (this.config.mode === 'online') return;
      const payload = {
        fen: this.chess.fen(),
        moveHistory: this.moveHistory,
        config: this.config,
        clock: this.clock,
        customResult: this.customResult
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota or private browsing errors
    }
  }

  public restoreFromStorage(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.fen !== 'string') return false;

      // Replay moves from initial position if history is from standard start, so chess.js internal history for undo & repetition is preserved
      this.chess.reset();
      let replayed = true;
      if (Array.isArray(parsed.moveHistory) && parsed.moveHistory.length > 0) {
        for (const rec of parsed.moveHistory) {
          try {
            this.chess.move({
              from: rec.from,
              to: rec.to,
              promotion: rec.promotion
            });
          } catch {
            replayed = false;
            break;
          }
        }
      }

      if (!replayed || this.chess.fen() !== parsed.fen) {
        this.chess.load(parsed.fen);
      }

      this.moveHistory = Array.isArray(parsed.moveHistory) ? parsed.moveHistory : [];
      if (parsed.config) {
        this.config = { ...this.config, ...parsed.config };
      }
      if (parsed.clock) {
        this.clock = { ...this.clock, ...parsed.clock };
      }
      this.customResult = parsed.customResult ?? null;
      this.selectedSquare = null;
      this.legalDestinations = [];
      this.pendingPromotion = null;
      this.emit();
      return true;
    } catch {
      return false;
    }
  }
}
