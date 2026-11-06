import type {
  Color,
  MapId,
  PieceSymbol,
  PublicRoomView,
  Square,
  TimeControlMinutes
} from '../engine/types';

export type OnlineConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'opponent_reconnecting'
  | 'reconnecting'
  | 'error';

export interface OnlineClientSnapshot {
  active: boolean;
  connectionStatus: OnlineConnectionStatus;
  roomCode: string | null;
  playerColor: Color | null;
  playerToken: string | null;
  room: PublicRoomView | null;
  error: string | null;
}

export type OnlineClientListener = (snapshot: OnlineClientSnapshot) => void;

const SESSION_PREFIX = 'mochess_tab_session_v1_';
const LOCAL_TOKEN_PREFIX = 'mochess_saved_token_v1_';
const ACTIVE_ROOM_SESSION_KEY = 'mochess_active_room_v1';

export class OnlineMultiplayerClient {
  private roomCode: string | null = null;
  private playerColor: Color | null = null;
  private playerToken: string | null = null;
  private stateSeal: string | null = null;
  private room: PublicRoomView | null = null;
  private connectionStatus: OnlineConnectionStatus = 'idle';
  private error: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private moveInFlight = false;
  private consecutivePollFailures = 0;
  private listeners: Set<OnlineClientListener> = new Set();

  public subscribe(listener: OnlineClientListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): OnlineClientSnapshot {
    return {
      active: Boolean(this.roomCode && this.room),
      connectionStatus: this.connectionStatus,
      roomCode: this.roomCode,
      playerColor: this.playerColor,
      playerToken: this.playerToken,
      room: this.room,
      error: this.error
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  private saveCredentials(
    roomCode: string,
    playerColor: Color,
    playerToken: string,
    stateSeal?: string | null
  ): void {
    const normalized = roomCode.toUpperCase();
    try {
      const payload = JSON.stringify({
        roomCode: normalized,
        playerColor,
        playerToken,
        stateSeal: stateSeal ?? this.stateSeal,
        savedAt: Date.now()
      });
      window.sessionStorage.setItem(`${SESSION_PREFIX}${normalized}`, payload);
      window.sessionStorage.setItem(ACTIVE_ROOM_SESSION_KEY, normalized);
      window.localStorage.setItem(`${LOCAL_TOKEN_PREFIX}${normalized}`, payload);
    } catch {
      // Ignore storage errors
    }
  }

  private getTabSession(roomCode: string): { playerToken?: string; stateSeal?: string } | null {
    try {
      const raw = window.sessionStorage.getItem(`${SESSION_PREFIX}${roomCode.toUpperCase()}`);
      if (!raw) return null;
      return JSON.parse(raw) as { playerToken?: string; stateSeal?: string };
    } catch {
      return null;
    }
  }

  private getFallbackLocalSession(
    roomCode: string
  ): { playerToken?: string; stateSeal?: string } | null {
    try {
      const raw = window.localStorage.getItem(`${LOCAL_TOKEN_PREFIX}${roomCode.toUpperCase()}`);
      if (!raw) return null;
      return JSON.parse(raw) as { playerToken?: string; stateSeal?: string };
    } catch {
      return null;
    }
  }

  public getSavedActiveRoomCode(): string | null {
    try {
      return window.sessionStorage.getItem(ACTIVE_ROOM_SESSION_KEY);
    } catch {
      return null;
    }
  }

  public getInviteUrl(roomCode?: string | null): string {
    const code = (roomCode ?? this.roomCode ?? '').toUpperCase();
    const url = new URL(window.location.href);
    url.searchParams.delete('autostart');
    url.searchParams.delete('seal');
    if (code) {
      url.searchParams.set('room', code);
    }
    return url.toString();
  }

  private computeConnectionStatus(
    room: PublicRoomView,
    myColor: Color | null
  ): OnlineConnectionStatus {
    if (room.status === 'waiting' || !room.seats.w.joined || !room.seats.b.joined) {
      return 'waiting';
    }
    if (myColor) {
      const oppColor: Color = myColor === 'w' ? 'b' : 'w';
      const oppSeat = room.seats[oppColor];
      if (oppSeat.joined && !oppSeat.connected) {
        return 'opponent_reconnecting';
      }
    }
    return 'connected';
  }

  private async apiPost(body: Record<string, unknown>): Promise<{
    status: number;
    data: {
      ok: boolean;
      error?: string;
      code?: string;
      room?: PublicRoomView;
      playerColor?: Color | null;
      playerToken?: string;
      stateSeal?: string;
      reconnected?: boolean;
    };
  }> {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  public async createRoom(params: {
    hostColor: Color | 'random';
    mapId: MapId;
    timeControlMinutes: TimeControlMinutes;
  }): Promise<{ ok: boolean; error?: string; room?: PublicRoomView }> {
    this.stopPolling();
    this.connectionStatus = 'connecting';
    this.error = null;
    this.emit();

    try {
      const { data } = await this.apiPost({
        action: 'create',
        hostColor: params.hostColor,
        mapId: params.mapId,
        timeControlMinutes: params.timeControlMinutes
      });

      if (!data.ok || !data.room || !data.playerColor || !data.playerToken) {
        this.connectionStatus = 'error';
        this.error = data.error || 'Failed to create room.';
        this.emit();
        return { ok: false, error: this.error };
      }

      this.roomCode = data.room.roomCode;
      this.playerColor = data.playerColor;
      this.playerToken = data.playerToken;
      this.stateSeal = data.stateSeal ?? null;
      this.room = data.room;
      this.connectionStatus = this.computeConnectionStatus(data.room, data.playerColor);
      this.error = null;

      this.saveCredentials(this.roomCode, this.playerColor, this.playerToken, this.stateSeal);
      this.updateUrlRoomParam(this.roomCode);
      this.startPolling();
      this.emit();
      return { ok: true, room: data.room };
    } catch (err) {
      this.connectionStatus = 'error';
      this.error = err instanceof Error ? err.message : 'Network error creating room.';
      this.emit();
      return { ok: false, error: this.error };
    }
  }

  public async joinRoom(
    rawRoomCode: string
  ): Promise<{ ok: boolean; error?: string; room?: PublicRoomView; reconnected?: boolean }> {
    const code = rawRoomCode.trim().toUpperCase();
    if (!code) {
      return { ok: false, error: 'Please enter a valid room code.' };
    }

    this.stopPolling();
    this.connectionStatus = 'connecting';
    this.error = null;
    this.emit();

    try {
      const tabSession = this.getTabSession(code);
      const tabToken = tabSession?.playerToken ?? null;
      const sealHint = tabSession?.stateSeal ?? this.stateSeal ?? null;

      let res = await this.apiPost({
        action: 'join',
        roomCode: code,
        token: tabToken,
        stateSeal: sealHint
      });

      if (!res.data.ok && res.data.code === 'ROOM_FULL' && !tabToken) {
        const fallback = this.getFallbackLocalSession(code);
        if (fallback?.playerToken) {
          res = await this.apiPost({
            action: 'join',
            roomCode: code,
            token: fallback.playerToken,
            stateSeal: fallback.stateSeal ?? sealHint
          });
        }
      }

      const { data } = res;
      if (!data.ok || !data.room || !data.playerColor || !data.playerToken) {
        this.connectionStatus = 'error';
        this.error = data.error || 'Unable to join room.';
        this.emit();
        return { ok: false, error: this.error };
      }

      this.roomCode = data.room.roomCode;
      this.playerColor = data.playerColor;
      this.playerToken = data.playerToken;
      this.stateSeal = data.stateSeal ?? this.stateSeal;
      this.room = data.room;
      this.connectionStatus = this.computeConnectionStatus(data.room, data.playerColor);
      this.error = null;

      this.saveCredentials(this.roomCode, this.playerColor, this.playerToken, this.stateSeal);
      this.updateUrlRoomParam(this.roomCode);
      this.startPolling();
      this.emit();
      return { ok: true, room: data.room, reconnected: data.reconnected };
    } catch (err) {
      this.connectionStatus = 'error';
      this.error = err instanceof Error ? err.message : 'Network error joining room.';
      this.emit();
      return { ok: false, error: this.error };
    }
  }

  public async submitMove(
    from: Square,
    to: Square,
    promotion?: PieceSymbol
  ): Promise<{ ok: boolean; error?: string; room?: PublicRoomView }> {
    if (!this.roomCode || !this.playerToken) {
      return { ok: false, error: 'Not connected to an online room.' };
    }

    this.moveInFlight = true;
    try {
      const { data } = await this.apiPost({
        action: 'move',
        roomCode: this.roomCode,
        token: this.playerToken,
        from,
        to,
        promotion,
        stateSeal: this.stateSeal
      });

      if (!data.ok || !data.room) {
        this.error = data.error || 'Move rejected by server.';
        this.emit();
        return { ok: false, error: this.error };
      }

      this.room = data.room;
      if (data.stateSeal) {
        this.stateSeal = data.stateSeal;
        if (this.playerColor) {
          this.saveCredentials(this.roomCode, this.playerColor, this.playerToken, this.stateSeal);
        }
      }
      this.error = null;
      this.connectionStatus = this.computeConnectionStatus(data.room, this.playerColor);
      this.emit();
      return { ok: true, room: data.room };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error sending move.';
      this.error = msg;
      this.emit();
      return { ok: false, error: msg };
    } finally {
      this.moveInFlight = false;
    }
  }

  public async resign(): Promise<{ ok: boolean; error?: string }> {
    if (!this.roomCode || !this.playerToken) {
      return { ok: false, error: 'Not in an online room.' };
    }
    this.moveInFlight = true;
    try {
      const { data } = await this.apiPost({
        action: 'resign',
        roomCode: this.roomCode,
        token: this.playerToken,
        stateSeal: this.stateSeal
      });
      if (data.ok && data.room) {
        this.room = data.room;
        if (data.stateSeal) {
          this.stateSeal = data.stateSeal;
        }
        this.connectionStatus = this.computeConnectionStatus(data.room, this.playerColor);
        this.emit();
        return { ok: true };
      }
      return { ok: false, error: data.error || 'Could not resign.' };
    } catch {
      return { ok: false, error: 'Network error.' };
    } finally {
      this.moveInFlight = false;
    }
  }

  public async requestRematch(): Promise<{ ok: boolean; error?: string; room?: PublicRoomView }> {
    if (!this.roomCode || !this.playerToken) {
      return { ok: false, error: 'Not in an online room.' };
    }
    this.moveInFlight = true;
    try {
      const { data } = await this.apiPost({
        action: 'rematch',
        roomCode: this.roomCode,
        token: this.playerToken,
        stateSeal: this.stateSeal
      });
      if (data.ok && data.room) {
        this.room = data.room;
        if (data.stateSeal) {
          this.stateSeal = data.stateSeal;
          if (this.playerColor) {
            this.saveCredentials(this.roomCode, this.playerColor, this.playerToken, this.stateSeal);
          }
        }
        this.connectionStatus = this.computeConnectionStatus(data.room, this.playerColor);
        this.emit();
        return { ok: true, room: data.room };
      }
      return { ok: false, error: data.error || 'Could not request rematch.' };
    } catch {
      return { ok: false, error: 'Network error.' };
    } finally {
      this.moveInFlight = false;
    }
  }

  public leaveRoom(): void {
    this.stopPolling();
    try {
      window.sessionStorage.removeItem(ACTIVE_ROOM_SESSION_KEY);
    } catch {
      // Ignore
    }
    this.roomCode = null;
    this.playerColor = null;
    this.playerToken = null;
    this.stateSeal = null;
    this.room = null;
    this.connectionStatus = 'idle';
    this.error = null;
    this.updateUrlRoomParam(null);
    this.emit();
  }

  private updateUrlRoomParam(roomCode: string | null): void {
    try {
      const url = new URL(window.location.href);
      if (roomCode) {
        url.searchParams.set('room', roomCode);
      } else {
        url.searchParams.delete('room');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Ignore history API issues
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.consecutivePollFailures = 0;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, 850);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollInFlight = false;
  }

  public async pollOnce(): Promise<void> {
    if (!this.roomCode || this.pollInFlight || this.moveInFlight) return;
    this.pollInFlight = true;
    try {
      const { data } = await this.apiPost({
        action: 'poll',
        roomCode: this.roomCode,
        token: this.playerToken,
        stateSeal: this.stateSeal
      });

      if (this.moveInFlight) {
        return;
      }

      if (data.ok && data.room) {
        if (this.room && data.room.version < this.room.version) {
          return;
        }
        this.consecutivePollFailures = 0;
        this.room = data.room;
        if (data.stateSeal) {
          this.stateSeal = data.stateSeal;
          if (this.playerColor && this.playerToken) {
            this.saveCredentials(this.roomCode, this.playerColor, this.playerToken, this.stateSeal);
          }
        }
        if (data.playerColor) {
          this.playerColor = data.playerColor;
        }
        this.connectionStatus = this.computeConnectionStatus(data.room, this.playerColor);
        this.error = null;
        this.emit();
      } else if (data.code === 'ROOM_NOT_FOUND') {
        this.error = data.error || 'Room expired.';
        this.connectionStatus = 'error';
        this.stopPolling();
        this.emit();
      }
    } catch {
      this.consecutivePollFailures += 1;
      if (this.consecutivePollFailures >= 3) {
        this.connectionStatus = 'reconnecting';
        this.emit();
      }
    } finally {
      this.pollInFlight = false;
    }
  }
}

export const onlineClient = new OnlineMultiplayerClient();
