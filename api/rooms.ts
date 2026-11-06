import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

export type MapId = 'cathedral' | 'warhall' | 'sanctum';
export type TimeControlMinutes = 0 | 3 | 5 | 10 | 15;
export type OnlineRoomStatus = 'waiting' | 'playing' | 'finished';

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

export const ROOM_TTL_SECONDS = 7200; // 2 hours
export const DISCONNECT_TIMEOUT_MS = 12_000; // 12 seconds without poll -> reconnecting state

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface InternalRoomState {
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
  whiteToken: string | null;
  blackToken: string | null;
  seats: {
    w: OnlineSeatPublicState;
    b: OnlineSeatPublicState;
  };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface RoomActionResponse {
  status: number;
  body: {
    ok: boolean;
    error?: string;
    code?: string;
    room?: PublicRoomView;
    playerColor?: Color | null;
    playerToken?: string;
    stateSeal?: string;
    reconnected?: boolean;
  };
}

interface StoredEntry {
  json: string;
  version: number;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __mochessRoomStore: Map<string, StoredEntry> | undefined;
}

const TMP_STORE_FILE = path.join(os.tmpdir(), 'mochess-online-rooms-v1.json');

const SEAL_KEY = crypto.scryptSync(
  process.env.MOCHESS_SERVER_SECRET ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    'mochess-arcane-kingdom-authoritative-seal-key-v1',
  'mochess-arcane-salt-v1',
  32
);

export function sealRoomState(room: InternalRoomState): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(room), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
}

export function unsealRoomState(
  seal?: string | null,
  expectedRoomCode?: string
): InternalRoomState | null {
  if (!seal || typeof seal !== 'string') return null;
  try {
    const raw = Buffer.from(seal, 'base64url');
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8'
    );
    const parsed = JSON.parse(decrypted) as InternalRoomState;
    if (!parsed || typeof parsed.roomCode !== 'string' || typeof parsed.version !== 'number') {
      return null;
    }
    if (expectedRoomCode && parsed.roomCode.toUpperCase() !== expectedRoomCode.toUpperCase()) {
      return null;
    }
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const REDIS_CAS_LUA = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '0' then
  if current ~= false then
    return 0
  end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
end
if current == false then
  return 0
end
local decoded = cjson.decode(current)
if tostring(decoded.version) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

export interface RoomStorageAdapter {
  readonly mode: 'redis' | 'memory';
  getRoom(roomCode: string): Promise<InternalRoomState | null>;
  saveRoomCAS(
    roomCode: string,
    expectedVersion: number,
    nextState: InternalRoomState
  ): Promise<boolean>;
  deleteRoom(roomCode: string): Promise<void>;
}

class UpstashRestStorageAdapter implements RoomStorageAdapter {
  public readonly mode = 'redis' as const;
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private key(roomCode: string): string {
    return `mochess:room:${roomCode.toUpperCase()}`;
  }

  private async command(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      throw new Error(`Upstash REST error HTTP ${res.status}`);
    }
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) {
      throw new Error(`Upstash Redis error: ${data.error}`);
    }
    return data.result;
  }

  public async getRoom(roomCode: string): Promise<InternalRoomState | null> {
    const raw = await this.command(['GET', this.key(roomCode)]);
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return JSON.parse(raw) as InternalRoomState;
    } catch {
      return null;
    }
  }

  public async saveRoomCAS(
    roomCode: string,
    expectedVersion: number,
    nextState: InternalRoomState
  ): Promise<boolean> {
    const payload = JSON.stringify(nextState);
    const result = await this.command([
      'EVAL',
      REDIS_CAS_LUA,
      1,
      this.key(roomCode),
      String(expectedVersion),
      payload,
      String(ROOM_TTL_SECONDS)
    ]);
    return Number(result) === 1;
  }

  public async deleteRoom(roomCode: string): Promise<void> {
    await this.command(['DEL', this.key(roomCode)]);
  }
}

class RedisTcpStorageAdapter implements RoomStorageAdapter {
  public readonly mode = 'redis' as const;
  constructor(private readonly redisUrl: string) {}

  private key(roomCode: string): string {
    return `mochess:room:${roomCode.toUpperCase()}`;
  }

  private execRespCommand(args: string[]): Promise<string | number | null> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.redisUrl);
      const isTls = parsed.protocol === 'rediss:';
      const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
      const host = parsed.hostname;
      const password = parsed.password ? decodeURIComponent(parsed.password) : '';
      const username = parsed.username ? decodeURIComponent(parsed.username) : '';

      const encodeCommand = (cmdArgs: string[]): Buffer => {
        const parts: Buffer[] = [Buffer.from(`*${cmdArgs.length}\r\n`, 'utf8')];
        for (const arg of cmdArgs) {
          const buf = Buffer.from(arg, 'utf8');
          parts.push(Buffer.from(`$${buf.length}\r\n`, 'utf8'), buf, Buffer.from('\r\n', 'utf8'));
        }
        return Buffer.concat(parts);
      };

      const commandsToSend: Buffer[] = [];
      let expectedReplies = 1;
      if (password) {
        expectedReplies = 2;
        commandsToSend.push(
          encodeCommand(username ? ['AUTH', username, password] : ['AUTH', password])
        );
      }
      commandsToSend.push(encodeCommand(args));

      const socket = isTls
        ? tls.connect({ host, port, servername: host })
        : net.createConnection({ host, port });

      socket.setTimeout(4000);
      let buffer: Buffer = Buffer.alloc(0);
      let repliesReceived = 0;

      const parseNextReply = (): { done: boolean; value?: string | number | null; rest?: Buffer } => {
        if (buffer.length < 3) return { done: false };
        const prefix = String.fromCharCode(buffer[0]);
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) return { done: false };

        const header = buffer.subarray(1, lineEnd).toString('utf8');
        if (prefix === '+') {
          return { done: true, value: header, rest: buffer.subarray(lineEnd + 2) };
        }
        if (prefix === '-') {
          throw new Error(`Redis error: ${header}`);
        }
        if (prefix === ':') {
          return { done: true, value: parseInt(header, 10), rest: buffer.subarray(lineEnd + 2) };
        }
        if (prefix === '$') {
          const len = parseInt(header, 10);
          if (len === -1) {
            return { done: true, value: null, rest: buffer.subarray(lineEnd + 2) };
          }
          const totalNeeded = lineEnd + 2 + len + 2;
          if (buffer.length < totalNeeded) return { done: false };
          const body = buffer.subarray(lineEnd + 2, lineEnd + 2 + len).toString('utf8');
          return { done: true, value: body, rest: buffer.subarray(totalNeeded) };
        }
        return { done: false };
      };

      socket.on('connect', () => {
        socket.write(Buffer.concat(commandsToSend));
      });

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          while (true) {
            const parsedReply = parseNextReply();
            if (!parsedReply.done) break;
            buffer = parsedReply.rest!;
            repliesReceived++;
            if (repliesReceived === expectedReplies) {
              socket.end();
              resolve(parsedReply.value ?? null);
              return;
            }
          }
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Redis TCP command timed out'));
      });

      socket.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async getRoom(roomCode: string): Promise<InternalRoomState | null> {
    const raw = await this.execRespCommand(['GET', this.key(roomCode)]);
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return JSON.parse(raw) as InternalRoomState;
    } catch {
      return null;
    }
  }

  public async saveRoomCAS(
    roomCode: string,
    expectedVersion: number,
    nextState: InternalRoomState
  ): Promise<boolean> {
    const payload = JSON.stringify(nextState);
    const res = await this.execRespCommand([
      'EVAL',
      REDIS_CAS_LUA,
      '1',
      this.key(roomCode),
      String(expectedVersion),
      payload,
      String(ROOM_TTL_SECONDS)
    ]);
    return Number(res) === 1;
  }

  public async deleteRoom(roomCode: string): Promise<void> {
    await this.execRespCommand(['DEL', this.key(roomCode)]);
  }
}

class MemoryRoomStorageAdapter implements RoomStorageAdapter {
  public readonly mode = 'memory' as const;

  private getMap(): Map<string, StoredEntry> {
    if (!globalThis.__mochessRoomStore) {
      globalThis.__mochessRoomStore = new Map<string, StoredEntry>();
      this.hydrateFromTmp(globalThis.__mochessRoomStore);
    } else {
      this.hydrateFromTmp(globalThis.__mochessRoomStore);
    }
    this.pruneExpired(globalThis.__mochessRoomStore);
    return globalThis.__mochessRoomStore;
  }

  private hydrateFromTmp(map: Map<string, StoredEntry>): void {
    try {
      if (!fs.existsSync(TMP_STORE_FILE)) return;
      const raw = fs.readFileSync(TMP_STORE_FILE, 'utf8');
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, StoredEntry>;
      for (const [k, entry] of Object.entries(parsed)) {
        const existing = map.get(k);
        if (!existing || entry.version > existing.version) {
          map.set(k, entry);
        }
      }
    } catch {
      // Ignore temp file read issues
    }
  }

  private flushToTmp(map: Map<string, StoredEntry>): void {
    try {
      const obj: Record<string, StoredEntry> = {};
      for (const [k, v] of map.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(TMP_STORE_FILE, JSON.stringify(obj), 'utf8');
    } catch {
      // Ignore temp file write issues
    }
  }

  private pruneExpired(map: Map<string, StoredEntry>): void {
    const now = Date.now();
    let removed = false;
    for (const [key, entry] of map.entries()) {
      if (entry.expiresAt <= now) {
        map.delete(key);
        removed = true;
      }
    }
    if (removed) {
      this.flushToTmp(map);
    }
  }

  public async getRoom(roomCode: string): Promise<InternalRoomState | null> {
    const key = roomCode.toUpperCase();
    const map = this.getMap();
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      this.flushToTmp(map);
      return null;
    }
    try {
      return JSON.parse(entry.json) as InternalRoomState;
    } catch {
      return null;
    }
  }

  public async saveRoomCAS(
    roomCode: string,
    expectedVersion: number,
    nextState: InternalRoomState
  ): Promise<boolean> {
    const key = roomCode.toUpperCase();
    const map = this.getMap();
    const existing = map.get(key);

    if (expectedVersion === 0) {
      if (existing && existing.expiresAt > Date.now()) {
        return false;
      }
    } else {
      if (!existing || existing.version !== expectedVersion) {
        return false;
      }
    }

    const expiresAt = Date.now() + ROOM_TTL_SECONDS * 1000;
    nextState.expiresAt = expiresAt;
    map.set(key, {
      json: JSON.stringify(nextState),
      version: nextState.version,
      expiresAt
    });
    this.flushToTmp(map);
    return true;
  }

  public async deleteRoom(roomCode: string): Promise<void> {
    const key = roomCode.toUpperCase();
    const map = this.getMap();
    map.delete(key);
    this.flushToTmp(map);
  }
}

export function createStorageAdapter(): RoomStorageAdapter {
  const restUrl =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    '';
  const restToken =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    '';

  if (restUrl && restToken) {
    return new UpstashRestStorageAdapter(restUrl, restToken);
  }

  const redisUrl = process.env.REDIS_URL || process.env.KV_URL || '';
  if (redisUrl && (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))) {
    return new RedisTcpStorageAdapter(redisUrl);
  }

  return new MemoryRoomStorageAdapter();
}

function generateRoomCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function generateParticipantToken(): string {
  return crypto.randomBytes(18).toString('hex');
}

function findKingSquareOnBoard(chess: Chess, color: Color): Square | null {
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) {
        return cell.square as Square;
      }
    }
  }
  return null;
}

function evaluateGameOver(chess: Chess): {
  isGameOver: boolean;
  winner: Color | 'draw' | null;
  reason: GameResultReason;
} {
  if (!chess.isGameOver()) {
    return { isGameOver: false, winner: null, reason: null };
  }
  if (chess.isCheckmate()) {
    const winner: Color = chess.turn() === 'w' ? 'b' : 'w';
    return { isGameOver: true, winner, reason: 'checkmate' };
  }
  if (chess.isStalemate()) {
    return { isGameOver: true, winner: 'draw', reason: 'stalemate' };
  }
  if (chess.isThreefoldRepetition()) {
    return { isGameOver: true, winner: 'draw', reason: 'threefold_repetition' };
  }
  if (chess.isInsufficientMaterial()) {
    return { isGameOver: true, winner: 'draw', reason: 'insufficient_material' };
  }
  if (chess.isDraw()) {
    return { isGameOver: true, winner: 'draw', reason: 'fifty_move_rule' };
  }
  return { isGameOver: false, winner: null, reason: null };
}

export function toPublicRoomView(
  room: InternalRoomState,
  storageMode: 'redis' | 'memory' = 'memory'
): PublicRoomView {
  const now = Date.now();
  const wConnected =
    room.seats.w.joined && now - room.seats.w.lastSeenAt < DISCONNECT_TIMEOUT_MS;
  const bConnected =
    room.seats.b.joined && now - room.seats.b.lastSeenAt < DISCONNECT_TIMEOUT_MS;

  return {
    roomCode: room.roomCode,
    version: room.version,
    status: room.status,
    mapId: room.mapId,
    timeControlMinutes: room.timeControlMinutes,
    fen: room.fen,
    turn: room.turn,
    moveHistory: room.moveHistory,
    lastMove: room.lastMove,
    inCheck: room.inCheck,
    kingInCheckSquare: room.kingInCheckSquare,
    isGameOver: room.isGameOver,
    winner: room.winner,
    resultReason: room.resultReason,
    seats: {
      w: {
        joined: room.seats.w.joined,
        connected: wConnected,
        lastSeenAt: room.seats.w.lastSeenAt,
        rematchRequested: room.seats.w.rematchRequested
      },
      b: {
        joined: room.seats.b.joined,
        connected: bConnected,
        lastSeenAt: room.seats.b.lastSeenAt,
        rematchRequested: room.seats.b.rematchRequested
      }
    },
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt,
    storageMode
  };
}

function getCallerSeat(room: InternalRoomState, token?: string | null): Color | null {
  if (!token) return null;
  if (room.whiteToken && token === room.whiteToken) return 'w';
  if (room.blackToken && token === room.blackToken) return 'b';
  return null;
}

export class OnlineRoomService {
  private readonly storage: RoomStorageAdapter;

  constructor(storage?: RoomStorageAdapter) {
    this.storage = storage ?? createStorageAdapter();
  }

  public getStorageMode(): 'redis' | 'memory' {
    return this.storage.mode;
  }

  private async getOrHydrateRoom(
    roomCode: string,
    stateSeal?: string | null
  ): Promise<InternalRoomState | null> {
    const code = roomCode.toUpperCase();
    const existing = await this.storage.getRoom(code);
    const sealed = unsealRoomState(stateSeal, code);

    if (!existing && sealed) {
      await this.storage.saveRoomCAS(code, 0, sealed);
      return sealed;
    }

    if (existing && sealed && sealed.version > existing.version) {
      await this.storage.saveRoomCAS(code, existing.version, sealed);
      return sealed;
    }

    return existing;
  }

  public async createRoom(params: {
    hostColor?: Color | 'random';
    mapId?: MapId;
    timeControlMinutes?: TimeControlMinutes;
  }): Promise<RoomActionResponse> {
    const chosenColor: Color =
      params.hostColor === 'w' || params.hostColor === 'b'
        ? params.hostColor
        : Math.random() < 0.5
          ? 'w'
          : 'b';

    const validMaps: MapId[] = ['cathedral', 'warhall', 'sanctum'];
    const mapId: MapId =
      params.mapId && validMaps.includes(params.mapId) ? params.mapId : 'cathedral';

    const validClocks: TimeControlMinutes[] = [0, 3, 5, 10, 15];
    const timeControlMinutes: TimeControlMinutes =
      params.timeControlMinutes !== undefined && validClocks.includes(params.timeControlMinutes)
        ? params.timeControlMinutes
        : 0;

    const chess = new Chess();
    const now = Date.now();
    const hostToken = generateParticipantToken();

    for (let attempt = 0; attempt < 8; attempt++) {
      const roomCode = generateRoomCode();
      const newRoom: InternalRoomState = {
        roomCode,
        version: 1,
        status: 'waiting',
        mapId,
        timeControlMinutes,
        fen: chess.fen(),
        turn: 'w',
        moveHistory: [],
        lastMove: null,
        inCheck: false,
        kingInCheckSquare: null,
        isGameOver: false,
        winner: null,
        resultReason: null,
        whiteToken: chosenColor === 'w' ? hostToken : null,
        blackToken: chosenColor === 'b' ? hostToken : null,
        seats: {
          w: {
            joined: chosenColor === 'w',
            connected: chosenColor === 'w',
            lastSeenAt: chosenColor === 'w' ? now : 0,
            rematchRequested: false
          },
          b: {
            joined: chosenColor === 'b',
            connected: chosenColor === 'b',
            lastSeenAt: chosenColor === 'b' ? now : 0,
            rematchRequested: false
          }
        },
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ROOM_TTL_SECONDS * 1000
      };

      const saved = await this.storage.saveRoomCAS(roomCode, 0, newRoom);
      if (saved) {
        return {
          status: 201,
          body: {
            ok: true,
            room: toPublicRoomView(newRoom, this.storage.mode),
            playerColor: chosenColor,
            playerToken: hostToken,
            stateSeal: sealRoomState(newRoom)
          }
        };
      }
    }

    return {
      status: 500,
      body: {
        ok: false,
        code: 'ROOM_CREATE_FAILED',
        error: 'Unable to allocate a unique room code. Please try again.'
      }
    };
  }

  public async joinRoom(params: {
    roomCode: string;
    token?: string | null;
    stateSeal?: string | null;
  }): Promise<RoomActionResponse> {
    const code = (params.roomCode || '').trim().toUpperCase();
    if (!code || code.length < 4) {
      return {
        status: 400,
        body: { ok: false, code: 'INVALID_CODE', error: 'Please enter a valid room code.' }
      };
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const room = await this.getOrHydrateRoom(code, params.stateSeal);
      if (!room) {
        return {
          status: 404,
          body: {
            ok: false,
            code: 'ROOM_NOT_FOUND',
            error: `Room "${code}" was not found or has expired.`
          }
        };
      }

      const now = Date.now();
      const existingSeat = getCallerSeat(room, params.token);
      if (existingSeat) {
        const expectedVersion = room.version;
        room.seats[existingSeat].connected = true;
        room.seats[existingSeat].lastSeenAt = now;
        room.updatedAt = now;
        room.version += 1;
        const ok = await this.storage.saveRoomCAS(code, expectedVersion, room);
        if (!ok) continue;

        return {
          status: 200,
          body: {
            ok: true,
            room: toPublicRoomView(room, this.storage.mode),
            playerColor: existingSeat,
            playerToken: params.token!,
            stateSeal: sealRoomState(room),
            reconnected: true
          }
        };
      }

      let openColor: Color | null = null;
      if (!room.seats.w.joined) {
        openColor = 'w';
      } else if (!room.seats.b.joined) {
        openColor = 'b';
      }

      if (!openColor) {
        return {
          status: 409,
          body: {
            ok: false,
            code: 'ROOM_FULL',
            error: 'This private room is already full (2/2 players).'
          }
        };
      }

      const expectedVersion = room.version;
      const newToken = generateParticipantToken();
      if (openColor === 'w') {
        room.whiteToken = newToken;
      } else {
        room.blackToken = newToken;
      }

      room.seats[openColor] = {
        joined: true,
        connected: true,
        lastSeenAt: now,
        rematchRequested: false
      };

      if (room.seats.w.joined && room.seats.b.joined && room.status === 'waiting') {
        room.status = 'playing';
      }

      room.updatedAt = now;
      room.version += 1;

      const saved = await this.storage.saveRoomCAS(code, expectedVersion, room);
      if (saved) {
        return {
          status: 200,
          body: {
            ok: true,
            room: toPublicRoomView(room, this.storage.mode),
            playerColor: openColor,
            playerToken: newToken,
            stateSeal: sealRoomState(room)
          }
        };
      }
    }

    return {
      status: 409,
      body: { ok: false, code: 'CONFLICT', error: 'Concurrent room update conflict. Please retry.' }
    };
  }

  public async pollRoom(params: {
    roomCode: string;
    token?: string | null;
    stateSeal?: string | null;
  }): Promise<RoomActionResponse> {
    const code = (params.roomCode || '').trim().toUpperCase();
    if (!code) {
      return {
        status: 400,
        body: { ok: false, code: 'INVALID_CODE', error: 'Missing room code.' }
      };
    }

    const room = await this.getOrHydrateRoom(code, params.stateSeal);
    if (!room) {
      return {
        status: 404,
        body: { ok: false, code: 'ROOM_NOT_FOUND', error: `Room "${code}" not found or expired.` }
      };
    }

    const callerColor = getCallerSeat(room, params.token);
    if (callerColor) {
      const now = Date.now();
      if (now - room.seats[callerColor].lastSeenAt >= 1500) {
        const expectedVersion = room.version;
        room.seats[callerColor].lastSeenAt = now;
        room.seats[callerColor].connected = true;
        await this.storage.saveRoomCAS(code, expectedVersion, room);
      } else {
        room.seats[callerColor].lastSeenAt = now;
        room.seats[callerColor].connected = true;
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        room: toPublicRoomView(room, this.storage.mode),
        playerColor: callerColor,
        stateSeal: sealRoomState(room)
      }
    };
  }

  public async submitMove(params: {
    roomCode: string;
    token?: string | null;
    from: string;
    to: string;
    promotion?: string;
    stateSeal?: string | null;
  }): Promise<RoomActionResponse> {
    const code = (params.roomCode || '').trim().toUpperCase();
    if (!code) {
      return {
        status: 400,
        body: { ok: false, code: 'INVALID_CODE', error: 'Missing room code.' }
      };
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const room = await this.getOrHydrateRoom(code, params.stateSeal);
      if (!room) {
        return {
          status: 404,
          body: { ok: false, code: 'ROOM_NOT_FOUND', error: 'Room not found or expired.' }
        };
      }

      const callerColor = getCallerSeat(room, params.token);
      if (!callerColor) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'UNAUTHORIZED_SEAT',
            error: 'Invalid or missing player seat token.'
          }
        };
      }

      if (!room.seats.w.joined || !room.seats.b.joined || room.status === 'waiting') {
        return {
          status: 409,
          body: {
            ok: false,
            code: 'WAITING_FOR_OPPONENT',
            error: 'Cannot make a move until both players have joined the room.'
          }
        };
      }

      if (room.isGameOver || room.status === 'finished') {
        return {
          status: 409,
          body: {
            ok: false,
            code: 'GAME_ALREADY_OVER',
            error: 'This match has already concluded.'
          }
        };
      }

      if (room.turn !== callerColor) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'OUT_OF_TURN',
            error: `It is currently ${room.turn === 'w' ? 'White' : 'Black'}'s turn.`
          }
        };
      }

      const chess = new Chess(room.fen);
      const fromSq = params.from as Square;
      const toSq = params.to as Square;
      const movingPiece = chess.get(fromSq);

      if (!movingPiece || movingPiece.color !== callerColor) {
        return {
          status: 400,
          body: {
            ok: false,
            code: 'ILLEGAL_MOVE',
            error: `No friendly piece on square ${fromSq}.`
          }
        };
      }

      const promo =
        params.promotion && ['q', 'r', 'b', 'n'].includes(params.promotion)
          ? (params.promotion as PieceSymbol)
          : undefined;

      const fenBefore = chess.fen();
      let executed;
      try {
        executed = chess.move({
          from: fromSq,
          to: toSq,
          promotion: promo
        });
      } catch {
        return {
          status: 400,
          body: {
            ok: false,
            code: 'ILLEGAL_MOVE',
            error: `Illegal chess move from ${fromSq} to ${toSq}.`
          }
        };
      }

      const now = Date.now();
      const ply = room.moveHistory.length + 1;
      const moveNumber = Math.ceil(ply / 2);

      let capturedSquare: Square | undefined;
      if (executed.captured) {
        if (executed.flags.includes('e')) {
          const file = executed.to[0];
          const rank = executed.from[1];
          capturedSquare = `${file}${rank}` as Square;
        } else {
          capturedSquare = executed.to as Square;
        }
      }

      let castling: CastlingRookMove | undefined;
      if (executed.flags.includes('k')) {
        const rank = executed.color === 'w' ? '1' : '8';
        castling = {
          side: 'k',
          rookFrom: `h${rank}` as Square,
          rookTo: `f${rank}` as Square
        };
      } else if (executed.flags.includes('q')) {
        const rank = executed.color === 'w' ? '1' : '8';
        castling = {
          side: 'q',
          rookFrom: `a${rank}` as Square,
          rookTo: `d${rank}` as Square
        };
      }

      const moveRecord: MoveRecord = {
        ply,
        moveNumber,
        color: executed.color,
        piece: executed.piece,
        from: executed.from as Square,
        to: executed.to as Square,
        san: executed.san,
        lan: executed.lan,
        flags: executed.flags,
        captured: executed.captured as PieceSymbol | undefined,
        capturedSquare,
        promotion: executed.promotion as PieceSymbol | undefined,
        castling,
        isCheck: chess.inCheck(),
        isCheckmate: chess.isCheckmate(),
        isDraw: chess.isDraw(),
        fenBefore,
        fenAfter: chess.fen(),
        timestamp: now
      };

      const gameOverState = evaluateGameOver(chess);
      const expectedVersion = room.version;

      room.fen = chess.fen();
      room.turn = chess.turn();
      room.moveHistory.push(moveRecord);
      room.lastMove = { from: moveRecord.from, to: moveRecord.to };
      room.inCheck = chess.inCheck();
      room.kingInCheckSquare = room.inCheck ? findKingSquareOnBoard(chess, room.turn) : null;
      room.isGameOver = gameOverState.isGameOver;
      room.winner = gameOverState.winner;
      room.resultReason = gameOverState.reason;
      if (room.isGameOver) {
        room.status = 'finished';
      }

      room.seats[callerColor].lastSeenAt = now;
      room.seats[callerColor].connected = true;
      room.updatedAt = now;
      room.version += 1;

      const saved = await this.storage.saveRoomCAS(code, expectedVersion, room);
      if (saved) {
        return {
          status: 200,
          body: {
            ok: true,
            room: toPublicRoomView(room, this.storage.mode),
            playerColor: callerColor,
            stateSeal: sealRoomState(room)
          }
        };
      }
    }

    return {
      status: 409,
      body: {
        ok: false,
        code: 'MOVE_CONFLICT',
        error: 'Simultaneous update detected; please retry your move.'
      }
    };
  }

  public async resignRoom(params: {
    roomCode: string;
    token?: string | null;
    stateSeal?: string | null;
  }): Promise<RoomActionResponse> {
    const code = (params.roomCode || '').trim().toUpperCase();
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = await this.getOrHydrateRoom(code, params.stateSeal);
      if (!room) {
        return {
          status: 404,
          body: { ok: false, code: 'ROOM_NOT_FOUND', error: 'Room not found.' }
        };
      }

      const callerColor = getCallerSeat(room, params.token);
      if (!callerColor) {
        return {
          status: 403,
          body: { ok: false, code: 'UNAUTHORIZED_SEAT', error: 'Unauthorized seat token.' }
        };
      }

      if (!room.isGameOver) {
        const expectedVersion = room.version;
        const now = Date.now();
        room.isGameOver = true;
        room.status = 'finished';
        room.winner = callerColor === 'w' ? 'b' : 'w';
        room.resultReason = 'resignation';
        room.seats[callerColor].lastSeenAt = now;
        room.updatedAt = now;
        room.version += 1;

        const saved = await this.storage.saveRoomCAS(code, expectedVersion, room);
        if (!saved) continue;
      }

      return {
        status: 200,
        body: {
          ok: true,
          room: toPublicRoomView(room, this.storage.mode),
          playerColor: callerColor,
          stateSeal: sealRoomState(room)
        }
      };
    }

    return {
      status: 409,
      body: { ok: false, code: 'CONFLICT', error: 'Could not process resignation.' }
    };
  }

  public async requestRematch(params: {
    roomCode: string;
    token?: string | null;
    stateSeal?: string | null;
  }): Promise<RoomActionResponse> {
    const code = (params.roomCode || '').trim().toUpperCase();
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = await this.getOrHydrateRoom(code, params.stateSeal);
      if (!room) {
        return {
          status: 404,
          body: { ok: false, code: 'ROOM_NOT_FOUND', error: 'Room not found.' }
        };
      }

      const callerColor = getCallerSeat(room, params.token);
      if (!callerColor) {
        return {
          status: 403,
          body: { ok: false, code: 'UNAUTHORIZED_SEAT', error: 'Unauthorized seat token.' }
        };
      }

      const expectedVersion = room.version;
      const now = Date.now();
      room.seats[callerColor].rematchRequested = true;
      room.seats[callerColor].lastSeenAt = now;
      room.seats[callerColor].connected = true;

      if (room.seats.w.rematchRequested && room.seats.b.rematchRequested) {
        const freshChess = new Chess();
        room.status = 'playing';
        room.fen = freshChess.fen();
        room.turn = 'w';
        room.moveHistory = [];
        room.lastMove = null;
        room.inCheck = false;
        room.kingInCheckSquare = null;
        room.isGameOver = false;
        room.winner = null;
        room.resultReason = null;
        room.seats.w.rematchRequested = false;
        room.seats.b.rematchRequested = false;
      }

      room.updatedAt = now;
      room.version += 1;

      const saved = await this.storage.saveRoomCAS(code, expectedVersion, room);
      if (saved) {
        return {
          status: 200,
          body: {
            ok: true,
            room: toPublicRoomView(room, this.storage.mode),
            playerColor: callerColor,
            stateSeal: sealRoomState(room)
          }
        };
      }
    }

    return {
      status: 409,
      body: { ok: false, code: 'CONFLICT', error: 'Could not process rematch request.' }
    };
  }
}

export const defaultOnlineRoomService = new OnlineRoomService();

type VercelRequest = IncomingMessage & {
  body?: Record<string, unknown> | string;
  query?: Record<string, string | string[]>;
};

type VercelResponse = ServerResponse & {
  status?: (code: number) => VercelResponse;
  json?: (data: unknown) => void;
};

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim().length > 0) {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', () => {
      resolve({});
    });
  });
}

function sendJson(res: VercelResponse, statusCode: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET') {
      const urlObj = new URL(req.url || '/api/rooms', 'http://localhost');
      const roomCode =
        (typeof req.query?.roomCode === 'string' ? req.query.roomCode : null) ||
        urlObj.searchParams.get('roomCode') ||
        '';
      const token =
        (typeof req.query?.token === 'string' ? req.query.token : null) ||
        urlObj.searchParams.get('token') ||
        undefined;

      const result = await defaultOnlineRoomService.pollRoom({ roomCode, token });
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const action = typeof body.action === 'string' ? body.action : '';

      switch (action) {
        case 'create': {
          const hostColor =
            body.hostColor === 'w' || body.hostColor === 'b' || body.hostColor === 'random'
              ? (body.hostColor as Color | 'random')
              : 'w';
          const mapId =
            typeof body.mapId === 'string' ? (body.mapId as MapId) : 'cathedral';
          const timeControlMinutes =
            typeof body.timeControlMinutes === 'number'
              ? (body.timeControlMinutes as TimeControlMinutes)
              : 0;

          const result = await defaultOnlineRoomService.createRoom({
            hostColor,
            mapId,
            timeControlMinutes
          });
          sendJson(res, result.status, result.body);
          return;
        }

        case 'join': {
          const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
          const token = typeof body.token === 'string' ? body.token : null;
          const stateSeal = typeof body.stateSeal === 'string' ? body.stateSeal : null;
          const result = await defaultOnlineRoomService.joinRoom({ roomCode, token, stateSeal });
          sendJson(res, result.status, result.body);
          return;
        }

        case 'poll': {
          const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
          const token = typeof body.token === 'string' ? body.token : null;
          const stateSeal = typeof body.stateSeal === 'string' ? body.stateSeal : null;
          const result = await defaultOnlineRoomService.pollRoom({ roomCode, token, stateSeal });
          sendJson(res, result.status, result.body);
          return;
        }

        case 'move': {
          const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
          const token = typeof body.token === 'string' ? body.token : null;
          const from = typeof body.from === 'string' ? body.from : '';
          const to = typeof body.to === 'string' ? body.to : '';
          const promotion = typeof body.promotion === 'string' ? body.promotion : undefined;
          const stateSeal = typeof body.stateSeal === 'string' ? body.stateSeal : null;

          const result = await defaultOnlineRoomService.submitMove({
            roomCode,
            token,
            from,
            to,
            promotion,
            stateSeal
          });
          sendJson(res, result.status, result.body);
          return;
        }

        case 'resign': {
          const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
          const token = typeof body.token === 'string' ? body.token : null;
          const stateSeal = typeof body.stateSeal === 'string' ? body.stateSeal : null;
          const result = await defaultOnlineRoomService.resignRoom({ roomCode, token, stateSeal });
          sendJson(res, result.status, result.body);
          return;
        }

        case 'rematch': {
          const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
          const token = typeof body.token === 'string' ? body.token : null;
          const stateSeal = typeof body.stateSeal === 'string' ? body.stateSeal : null;
          const result = await defaultOnlineRoomService.requestRematch({
            roomCode,
            token,
            stateSeal
          });
          sendJson(res, result.status, result.body);
          return;
        }

        default: {
          sendJson(res, 400, {
            ok: false,
            code: 'INVALID_ACTION',
            error: `Unsupported room action: "${action}"`
          });
          return;
        }
      }
    }

    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    sendJson(res, 500, { ok: false, code: 'SERVER_ERROR', error: message });
  }
}
