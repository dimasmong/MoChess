import { describe, expect, it } from 'vitest';
import { OnlineRoomService } from '../src/server/onlineRoomService';
import { ChessGameEngine } from '../src/engine/ChessGameEngine';

describe('Online Private PvP Room Service & Authoritative Validator', () => {
  it('creates a private room, assigns seat & private token, and strips tokens from public view', async () => {
    const service = new OnlineRoomService();
    const createRes = await service.createRoom({
      hostColor: 'w',
      mapId: 'warhall',
      timeControlMinutes: 0
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.ok).toBe(true);
    expect(createRes.body.playerColor).toBe('w');
    expect(typeof createRes.body.playerToken).toBe('string');
    expect(createRes.body.playerToken!.length).toBeGreaterThanOrEqual(24);

    const room = createRes.body.room!;
    expect(room.roomCode).toHaveLength(6);
    expect(room.status).toBe('waiting');
    expect(room.mapId).toBe('warhall');
    expect(room.seats.w.joined).toBe(true);
    expect(room.seats.b.joined).toBe(false);
    // Ensure private tokens are never exposed in PublicRoomView
    expect((room as Record<string, unknown>).whiteToken).toBeUndefined();
    expect((room as Record<string, unknown>).blackToken).toBeUndefined();
  });

  it('allows a second player to join, rejects a third player, and supports token reconnect', async () => {
    const service = new OnlineRoomService();
    const hostRes = await service.createRoom({ hostColor: 'w', mapId: 'cathedral' });
    const roomCode = hostRes.body.room!.roomCode;
    const whiteToken = hostRes.body.playerToken!;

    // Reject move while still waiting for opponent
    const prematureMove = await service.submitMove({
      roomCode,
      token: whiteToken,
      from: 'e2',
      to: 'e4'
    });
    expect(prematureMove.status).toBe(409);
    expect(prematureMove.body.code).toBe('WAITING_FOR_OPPONENT');

    // Second player joins -> gets Black seat
    const guestRes = await service.joinRoom({ roomCode });
    expect(guestRes.status).toBe(200);
    expect(guestRes.body.ok).toBe(true);
    expect(guestRes.body.playerColor).toBe('b');
    expect(guestRes.body.room!.status).toBe('playing');
    const blackToken = guestRes.body.playerToken!;
    expect(blackToken).not.toBe(whiteToken);

    // Third player attempting to join without token is rejected with 409 ROOM_FULL
    const thirdRes = await service.joinRoom({ roomCode });
    expect(thirdRes.status).toBe(409);
    expect(thirdRes.body.code).toBe('ROOM_FULL');

    // Existing Black player reconnecting with their token succeeds
    const reconnectRes = await service.joinRoom({ roomCode, token: blackToken });
    expect(reconnectRes.status).toBe(200);
    expect(reconnectRes.body.ok).toBe(true);
    expect(reconnectRes.body.reconnected).toBe(true);
    expect(reconnectRes.body.playerColor).toBe('b');
  });

  it('enforces seat ownership, turn order, and legal chess rules on the server', async () => {
    const service = new OnlineRoomService();
    const host = await service.createRoom({ hostColor: 'w' });
    const roomCode = host.body.room!.roomCode;
    const whiteToken = host.body.playerToken!;

    const guest = await service.joinRoom({ roomCode });
    const blackToken = guest.body.playerToken!;

    // 1. Forged / invalid token -> 403
    const badTokenRes = await service.submitMove({
      roomCode,
      token: 'forged_token_123',
      from: 'e2',
      to: 'e4'
    });
    expect(badTokenRes.status).toBe(403);
    expect(badTokenRes.body.code).toBe('UNAUTHORIZED_SEAT');

    // 2. Black trying to move on White's turn -> 403 OUT_OF_TURN
    const outOfTurnRes = await service.submitMove({
      roomCode,
      token: blackToken,
      from: 'e7',
      to: 'e5'
    });
    expect(outOfTurnRes.status).toBe(403);
    expect(outOfTurnRes.body.code).toBe('OUT_OF_TURN');

    // 3. White trying an illegal chess move (e2 -> e5) -> 400 ILLEGAL_MOVE
    const illegalRes = await service.submitMove({
      roomCode,
      token: whiteToken,
      from: 'e2',
      to: 'e5'
    });
    expect(illegalRes.status).toBe(400);
    expect(illegalRes.body.code).toBe('ILLEGAL_MOVE');

    // 4. White plays legal move e2 -> e4
    const move1 = await service.submitMove({
      roomCode,
      token: whiteToken,
      from: 'e2',
      to: 'e4'
    });
    expect(move1.status).toBe(200);
    expect(move1.body.room!.turn).toBe('b');
    expect(move1.body.room!.moveHistory).toHaveLength(1);
    expect(move1.body.room!.moveHistory[0].san).toBe('e4');

    // 5. Duplicate / out-of-turn move by White immediately rejected
    const duplicateWhite = await service.submitMove({
      roomCode,
      token: whiteToken,
      from: 'd2',
      to: 'd4'
    });
    expect(duplicateWhite.status).toBe(403);
    expect(duplicateWhite.body.code).toBe('OUT_OF_TURN');
  });

  it('completes a full Fool’s Mate game, synchronizes ChessGameEngine, and processes two-player rematch', async () => {
    const service = new OnlineRoomService();
    const host = await service.createRoom({ hostColor: 'w', mapId: 'sanctum' });
    const roomCode = host.body.room!.roomCode;
    const whiteToken = host.body.playerToken!;

    const guest = await service.joinRoom({ roomCode });
    const blackToken = guest.body.playerToken!;

    const whiteEngine = new ChessGameEngine();
    const blackEngine = new ChessGameEngine();

    whiteEngine.syncFromOnlineRoom(guest.body.room!, 'w');
    blackEngine.syncFromOnlineRoom(guest.body.room!, 'b');

    // Fool's Mate sequence: 1. f3 e5 2. g4 Qh4#
    const m1 = await service.submitMove({ roomCode, token: whiteToken, from: 'f2', to: 'f3' });
    expect(m1.status).toBe(200);
    const animB1 = blackEngine.syncFromOnlineRoom(m1.body.room!, 'b');
    expect(animB1?.san).toBe('f3');

    const m2 = await service.submitMove({ roomCode, token: blackToken, from: 'e7', to: 'e5' });
    expect(m2.status).toBe(200);
    const animW2 = whiteEngine.syncFromOnlineRoom(m2.body.room!, 'w');
    expect(animW2?.san).toBe('e5');

    const m3 = await service.submitMove({ roomCode, token: whiteToken, from: 'g2', to: 'g4' });
    expect(m3.status).toBe(200);

    const m4 = await service.submitMove({ roomCode, token: blackToken, from: 'd8', to: 'h4' });
    expect(m4.status).toBe(200);

    const finalRoom = m4.body.room!;
    expect(finalRoom.isGameOver).toBe(true);
    expect(finalRoom.status).toBe('finished');
    expect(finalRoom.winner).toBe('b');
    expect(finalRoom.resultReason).toBe('checkmate');

    whiteEngine.syncFromOnlineRoom(finalRoom, 'w');
    blackEngine.syncFromOnlineRoom(finalRoom, 'b');
    expect(whiteEngine.isGameOver()).toBe(true);
    expect(blackEngine.getGameResult().winner).toBe('b');

    // Request rematch from White first -> still finished until Black accepts
    const rem1 = await service.requestRematch({ roomCode, token: whiteToken });
    expect(rem1.body.room!.isGameOver).toBe(true);
    expect(rem1.body.room!.seats.w.rematchRequested).toBe(true);
    expect(rem1.body.room!.seats.b.rematchRequested).toBe(false);

    // Black accepts rematch -> board resets to initial position and status = 'playing'
    const rem2 = await service.requestRematch({ roomCode, token: blackToken });
    expect(rem2.body.room!.isGameOver).toBe(false);
    expect(rem2.body.room!.status).toBe('playing');
    expect(rem2.body.room!.moveHistory).toHaveLength(0);

    whiteEngine.syncFromOnlineRoom(rem2.body.room!, 'w');
    expect(whiteEngine.isGameOver()).toBe(false);
    expect(whiteEngine.getSnapshot().moveHistory).toHaveLength(0);
  });
});
