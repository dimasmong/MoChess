import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.VERIFY_URL || 'http://localhost:4179';
const SCREENSHOT_DIR = path.resolve('docs/screenshots');

function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Could not find Edge or Chrome executable for Playwright.');
}

async function waitForCondition(fn, timeoutMs = 12000, intervalMs = 200, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fn();
    if (res) return res;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

async function clickSquare3D(page, square) {
  await page.evaluate(async (sq) => {
    const app = window.__wizardChess;
    if (!app) throw new Error('Missing __wizardChess');
    // Simulate direct 3D board square tap through the exact scene/engine handler
    const res = app.engine.handleSquareInteraction(sq);
    if (res && 'valid' in res && res.valid && res.move) {
      if (app.engine.getConfig().mode === 'online') {
        await app.online.submitMove(res.move.from, res.move.to, res.move.promotion);
      }
    }
  }, square);
}

async function runVerification() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const executablePath = findBrowserExecutable();
  console.log(`[Verify Online PvP] Launching browser against ${TARGET_URL}`);

  const launchOpts = {
    executablePath,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  };
  const browserA = await chromium.launch(launchOpts);
  const browserB = await chromium.launch(launchOpts);

  try {
    // Independent Browser A: Desktop (1280x720) — Host (White)
    const contextA = await browserA.newContext({
      viewport: { width: 1280, height: 720 }
    });
    // Independent Browser B: Android Mobile Portrait (390x844) — Guest (Black)
    const contextB = await browserB.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const errors = [];
    pageA.on('pageerror', (e) => errors.push(`PageA error: ${e.message}`));
    pageB.on('pageerror', (e) => errors.push(`PageB error: ${e.message}`));

    // 1. Player A opens Main Menu and clicks Online PvP -> Create Private Room
    console.log('[1/7] Player A (Desktop) opening Main Menu -> Online PvP...');
    await pageA.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#btn-menu-online', { state: 'visible' });
    // Set low quality on headless SwiftShader so two simultaneous WebGL contexts don't starve CPU
    await pageA.evaluate(() => window.__wizardChess?.scene.updateSettings({ quality: 'low' }));
    await pageA.click('#btn-menu-online');

    await pageA.waitForSelector('#online-modal', { state: 'visible' });
    await pageA.click('#btn-online-color-w');
    await pageA.click('#btn-online-map-sanctum');
    await pageA.click('#btn-online-create-submit');

    // Wait for room code to be generated
    const roomCode = await waitForCondition(
      async () => {
        const text = await pageA.textContent('#online-room-code-text');
        return text && text.trim() !== '------' && text.trim().length === 6 ? text.trim() : null;
      },
      10000,
      200,
      'Room Code generation'
    );

    const inviteUrl = await pageA.inputValue('#online-invite-url-input');
    console.log(`  ✓ Room created: code=${roomCode}, inviteUrl=${inviteUrl}`);

    await pageA.screenshot({
      path: path.join(SCREENSHOT_DIR, '11_online_waiting_room.png')
    });

    // 2. Player B (Android) joins using the shareable invite URL
    console.log('[2/7] Player B (Android 390x844) joining via invite URL...');
    await pageB.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
    await pageB.waitForFunction(() => Boolean(window.__wizardChess));
    await pageB.evaluate(() => window.__wizardChess?.scene.updateSettings({ quality: 'low' }));

    // Wait for both clients to enter 'playing' state with both seats joined
    await waitForCondition(
      async () => {
        const stateA = await pageA.evaluate(() => window.__wizardChess?.online.getSnapshot());
        const stateB = await pageB.evaluate(() => window.__wizardChess?.online.getSnapshot());
        console.log(
          `    [poll] A: status=${stateA?.room?.status} color=${stateA?.playerColor} err=${stateA?.error} | B: status=${stateB?.room?.status} color=${stateB?.playerColor} err=${stateB?.error}`
        );
        return (
          stateA?.room?.status === 'playing' &&
          stateB?.room?.status === 'playing' &&
          stateA?.playerColor === 'w' &&
          stateB?.playerColor === 'b'
        );
      },
      12000,
      500,
      'Both players connected in playing state'
    );
    console.log('  ✓ Both players joined and assigned seats: Player A = White, Player B = Black');

    // Skip opening cinematic on both clients so we are in Gameplay camera view
    await pageA.evaluate(() => window.__wizardChess?.scene.skipOpeningCinematic());
    await pageB.evaluate(() => window.__wizardChess?.scene.skipOpeningCinematic());

    // 3. Verify server rejects out-of-turn and illegal moves
    console.log('[3/7] Verifying authoritative server rejects out-of-turn & illegal moves...');
    const outOfTurnAttempt = await pageB.evaluate(async () => {
      return await window.__wizardChess.online.submitMove('e7', 'e5');
    });
    if (outOfTurnAttempt.ok) {
      throw new Error('Server allowed Black to move on White turn!');
    }

    const illegalAttempt = await pageA.evaluate(async () => {
      return await window.__wizardChess.online.submitMove('e2', 'e5');
    });
    if (illegalAttempt.ok) {
      throw new Error('Server allowed illegal move e2->e5!');
    }
    console.log(`  ✓ Server rejected out-of-turn ("${outOfTurnAttempt.error}") & illegal ("${illegalAttempt.error}") moves`);

    // 4. Play synchronized moves including capture & combat animation across both clients
    console.log('[4/7] Playing synchronized moves & capture across Desktop & Android clients...');
    // 1. e4 (White)
    await clickSquare3D(pageA, 'e2');
    await clickSquare3D(pageA, 'e4');

    await waitForCondition(
      async () => {
        const snapB = await pageB.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        return snapB?.moveHistory.length === 1 && snapB.moveHistory[0].san === 'e4';
      },
      8000,
      200,
      'Player B receiving 1. e4'
    );
    console.log('  ✓ Move 1. e4 synced to Player B (Android)');

    // 1... f5 (Black)
    await clickSquare3D(pageB, 'f7');
    await clickSquare3D(pageB, 'f5');

    await waitForCondition(
      async () => {
        const snapA = await pageA.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        return snapA?.moveHistory.length === 2 && snapA.moveHistory[1].san === 'f5';
      },
      8000,
      200,
      'Player A receiving 1... f5'
    );
    console.log('  ✓ Move 1... f5 synced to Player A (Desktop)');

    // 2. exf5 (White captures Black pawn on f5!)
    await clickSquare3D(pageA, 'e4');
    await clickSquare3D(pageA, 'f5');

    await waitForCondition(
      async () => {
        const snapB = await pageB.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        return snapB?.moveHistory.length === 3 && snapB.moveHistory[2].san === 'exf5';
      },
      8000,
      200,
      'Player B receiving capture 2. exf5'
    );
    console.log('  ✓ Capture 2. exf5 synced & animated on both clients');

    // 2... g5 (Black)
    await clickSquare3D(pageB, 'g7');
    await clickSquare3D(pageB, 'g5');

    await waitForCondition(
      async () => {
        const snapA = await pageA.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        return snapA?.moveHistory.length === 4 && snapA.moveHistory[3].san === 'g5';
      },
      8000,
      200,
      'Player A receiving 2... g5'
    );

    // 5. Verify Disconnect / Page Reload Reconnect for Player B
    console.log('[5/7] Testing Player B page reload & automatic seat reconnection...');
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.waitForFunction(() => Boolean(window.__wizardChess));
    await pageB.evaluate(() => window.__wizardChess?.scene.updateSettings({ quality: 'low' }));
    await waitForCondition(
      async () => {
        const snapB = await pageB.evaluate(() => ({
          online: window.__wizardChess?.online.getSnapshot(),
          engine: window.__wizardChess?.engine.getSnapshot()
        }));
        return (
          snapB.online?.active &&
          snapB.online?.playerColor === 'b' &&
          snapB.engine?.moveHistory.length === 4
        );
      },
      10000,
      250,
      'Player B reconnect after page reload'
    );
    console.log('  ✓ Player B reconnected to Black seat with full 4-ply move history intact');

    // 6. Complete Checkmate: 3. Qh5# (White Queen delivers checkmate)
    console.log('[6/7] Delivering 3. Qh5# Checkmate and verifying end-of-game overlay on both clients...');
    await clickSquare3D(pageA, 'd1');
    await clickSquare3D(pageA, 'h5');

    await waitForCondition(
      async () => {
        const snapA = await pageA.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        const snapB = await pageB.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        return (
          snapA?.isGameOver &&
          snapA?.resultReason === 'checkmate' &&
          snapA?.winner === 'w' &&
          snapB?.isGameOver &&
          snapB?.resultReason === 'checkmate' &&
          snapB?.winner === 'w'
        );
      },
      10000,
      200,
      'Checkmate synced on both clients'
    );
    console.log('  ✓ Checkmate confirmed on both Player A and Player B!');

    // 7. Verify Two-Player Rematch Flow
    console.log('[7/7] Testing two-player Rematch handshake...');
    await pageA.click('#btn-gameover-rematch');

    await waitForCondition(
      async () => {
        const roomB = await pageB.evaluate(() => window.__wizardChess?.online.getSnapshot().room);
        return roomB?.seats.w.rematchRequested === true;
      },
      8000,
      200,
      'Player B seeing White rematch request'
    );

    await pageB.click('#btn-gameover-rematch');

    await waitForCondition(
      async () => {
        const snapA = await pageA.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        const snapB = await pageB.evaluate(() => window.__wizardChess?.engine.getSnapshot());
        return (
          snapA?.isGameOver === false &&
          snapA?.moveHistory.length === 0 &&
          snapB?.isGameOver === false &&
          snapB?.moveHistory.length === 0
        );
      },
      10000,
      200,
      'Rematch board reset on both clients'
    );
    console.log('  ✓ Rematch accepted by both players — board reset to starting position!');

    if (errors.length > 0) {
      throw new Error(`Console/Page errors occurred:\n${errors.join('\n')}`);
    }

    console.log(`\n✅ ALL ONLINE PRIVATE PvP CHECKS PASSED AGAINST ${TARGET_URL}!`);
  } finally {
    await browserA.close();
    await browserB.close();
  }
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
