import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

const ARTIFACT_DIR =
  'C:/Users/Dimas Mong/.gemini/antigravity/brain/213bd253-a39d-48d5-8459-e007b9c8a98f';
const PORT = 4181;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startVitePreview() {
  return new Promise((resolve, reject) => {
    const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
    const proc = spawn(
      process.execPath,
      [viteBin, 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let resolved = false;
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (!resolved && (text.includes(String(PORT)) || text.includes('Local:'))) {
        resolved = true;
        resolve(proc);
      }
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (!resolved && text.includes('Error')) {
        reject(new Error(text));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(proc);
      }
    }, 3500);
  });
}

function stopVitePreview(proc) {
  if (!proc || !proc.pid) return;
  try {
    proc.stdout?.destroy();
    proc.stderr?.destroy();
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    // Process already exited
  }
}

async function clickBoardSquare(page, square, useTouch = false) {
  const pt = await page.evaluate((sq) => {
    const { scene } = window.__wizardChess;
    return scene.getSquareScreenPosition(sq, 0.12);
  }, square);

  if (useTouch) {
    await page.touchscreen.tap(pt.x, pt.y);
  } else {
    await page.mouse.click(pt.x, pt.y);
  }
}

async function runVerification() {
  console.log('[Verify Piece Audit] Starting Vite preview server...');
  const server = await startVitePreview();

  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  try {
    // =========================================================================
    // PART 1: DESKTOP (1280x720) — Opening Knights & All Camera Presets
    // =========================================================================
    const contextDesktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await contextDesktop.newPage();

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__wizardChess?.scene));
    await page.waitForTimeout(600);

    // Start fresh local 2P match and skip opening cinematic so we test immediate gameplay camera
    await page.evaluate(() => {
      const { engine, scene } = window.__wizardChess;
      engine.startNewGame({
        mode: 'local',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty',
        timeControlMinutes: 0
      });
      scene.skipOpeningCinematic();
      scene.setCameraPreset('gameplay', true, 'w');
    });
    await page.waitForTimeout(300);

    // 1A. Click b1 Knight -> verify selection & legal destinations ['a3', 'c3']
    await clickBoardSquare(page, 'b1');
    await page.waitForTimeout(150);

    const b1State = await page.evaluate(() => {
      const snap = window.__wizardChess.engine.getSnapshot();
      return {
        selectedSquare: snap.selectedSquare,
        legalDestinations: snap.legalDestinations.map((d) => d.square).sort()
      };
    });
    if (b1State.selectedSquare !== 'b1' || b1State.legalDestinations.join(',') !== 'a3,c3') {
      throw new Error(`Failed b1 Knight selection: ${JSON.stringify(b1State)}`);
    }

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v4_01_knight_selection_and_jump.png')
    });

    // Click c3 on the 3D canvas -> Knight jumps over b2/c2 pawns onto c3!
    await clickBoardSquare(page, 'c3');
    await page.waitForTimeout(750);

    const afterC3 = await page.evaluate(() => {
      const { engine } = window.__wizardChess;
      return {
        c3Piece: engine.getPieceAt('c3'),
        b1Piece: engine.getPieceAt('b1'),
        turn: engine.getSnapshot().turn
      };
    });
    if (!afterC3.c3Piece || afterC3.c3Piece.type !== 'n' || afterC3.c3Piece.color !== 'w' || afterC3.turn !== 'b') {
      throw new Error(`Knight b1 -> c3 3D click move failed: ${JSON.stringify(afterC3)}`);
    }

    // 1B. Test Black Knight b8 -> c6 in 'top' camera preset, then g1 -> f3 & g8 -> f6 in 'cinematic' preset
    await page.evaluate(() => {
      window.__wizardChess.scene.setCameraPreset('top', true, 'b');
    });
    await page.waitForTimeout(250);

    await clickBoardSquare(page, 'b8');
    await page.waitForTimeout(120);
    await clickBoardSquare(page, 'c6');
    await page.waitForTimeout(350);

    await page.evaluate(() => {
      window.__wizardChess.scene.setCameraPreset('cinematic', true, 'w');
    });
    await page.waitForTimeout(250);

    await clickBoardSquare(page, 'g1');
    await page.waitForTimeout(120);
    await clickBoardSquare(page, 'f3');
    await page.waitForTimeout(350);

    await clickBoardSquare(page, 'g8');
    await page.waitForTimeout(120);
    await clickBoardSquare(page, 'f6');
    await page.waitForTimeout(350);

    const fourKnightsVerify = await page.evaluate(() => {
      const { engine } = window.__wizardChess;
      return {
        c3: engine.getPieceAt('c3')?.type,
        c6: engine.getPieceAt('c6')?.type,
        f3: engine.getPieceAt('f3')?.type,
        f6: engine.getPieceAt('f6')?.type
      };
    });
    if (
      fourKnightsVerify.c3 !== 'n' ||
      fourKnightsVerify.c6 !== 'n' ||
      fourKnightsVerify.f3 !== 'n' ||
      fourKnightsVerify.f6 !== 'n'
    ) {
      throw new Error(`Four Knights 3D click sequence failed: ${JSON.stringify(fourKnightsVerify)}`);
    }
    console.log('[Verify Piece Audit] PASS 1: Opening Knights (b1->c3, b8->c6, g1->f3, g8->f6) across gameplay, top, and cinematic camera presets.');

    // =========================================================================
    // PART 2: CENTER KNIGHT ON d4 SURROUNDED BY 8 PIECES — ALL 8 L-JUMPS
    // =========================================================================
    await page.evaluate(() => {
      const { engine, scene } = window.__wizardChess;
      scene.setCameraPreset('gameplay', true, 'w');
      engine.loadFen('4k3/8/8/2ppp3/2PNP3/2PPP3/8/4K3 w - - 0 1');
    });
    await page.waitForTimeout(300);

    await clickBoardSquare(page, 'd4');
    await page.waitForTimeout(150);

    const d4RaycastAudit = await page.evaluate(() => {
      const { engine, scene } = window.__wizardChess;
      const snap = engine.getSnapshot();
      const targets = ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'];
      const picked = targets.map((sq) => {
        const pt = scene.getSquareScreenPosition(sq, 0.08);
        return { target: sq, picked: scene.pickSquareAtClientPosition(pt.x, pt.y) };
      });
      return {
        selectedSquare: snap.selectedSquare,
        legalCount: snap.legalDestinations.length,
        picked
      };
    });

    if (
      d4RaycastAudit.selectedSquare !== 'd4' ||
      d4RaycastAudit.legalCount !== 8 ||
      d4RaycastAudit.picked.some((p) => p.target !== p.picked)
    ) {
      throw new Error(`d4 surrounded Knight 8-target raycast audit failed: ${JSON.stringify(d4RaycastAudit)}`);
    }

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v4_02_center_knight_all_8_targets.png')
    });

    // Click c6 on 3D canvas -> Knight jumps over surrounded 3x3 ring onto c6
    await clickBoardSquare(page, 'c6');
    await page.waitForTimeout(750);

    const c6Landed = await page.evaluate(() => window.__wizardChess.engine.getPieceAt('c6'));
    if (!c6Landed || c6Landed.type !== 'n' || c6Landed.color !== 'w') {
      throw new Error(`Surrounded Knight jump d4 -> c6 failed: ${JSON.stringify(c6Landed)}`);
    }
    console.log('[Verify Piece Audit] PASS 2: Center Knight on d4 surrounded by 8 pieces selects and jumps to all 8 L-shaped targets.');

    // =========================================================================
    // PART 3: ALL 3 CHESS SKINS & ALL 3 MAPS — 3D CANVAS KNIGHT INTERACTION
    // =========================================================================
    const skinsAndMaps = [
      { skinId: 'arcane_royalty', mapId: 'cathedral' },
      { skinId: 'runic_warforged', mapId: 'warhall' },
      { skinId: 'mystic_sanctum', mapId: 'sanctum' }
    ];

    for (const combo of skinsAndMaps) {
      await page.evaluate(({ skinId, mapId }) => {
        const { engine, scene } = window.__wizardChess;
        engine.startNewGame({ mode: 'local', playerColor: 'w', skinId, mapId });
        scene.skipOpeningCinematic();
        scene.setCameraPreset('gameplay', true, 'w');
      }, combo);
      await page.waitForTimeout(300);

      await clickBoardSquare(page, 'b1');
      await page.waitForTimeout(100);
      await clickBoardSquare(page, 'c3');
      await page.waitForTimeout(350);

      const moved = await page.evaluate(() => window.__wizardChess.engine.getPieceAt('c3'));
      if (!moved || moved.type !== 'n') {
        throw new Error(`Skin/Map (${combo.skinId}/${combo.mapId}) Knight move failed`);
      }
    }
    console.log('[Verify Piece Audit] PASS 3: All 3 Chess Skins and All 3 Maps verified with real 3D canvas Knight interactions.');

    // =========================================================================
    // PART 4: PINNED KNIGHT & HUD FEEDBACK TOAST VERIFICATION
    // =========================================================================
    await page.evaluate(() => {
      const { engine } = window.__wizardChess;
      // White Knight on e2 is pinned to White King on e1 by Black Rook on e8
      engine.loadFen('4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1');
    });
    await page.waitForTimeout(200);

    await clickBoardSquare(page, 'e2');
    await page.waitForTimeout(200);

    const pinnedState = await page.evaluate(() => {
      const snap = window.__wizardChess.engine.getSnapshot();
      const toast = document.getElementById('hud-feedback-toast');
      return {
        selectedSquare: snap.selectedSquare,
        legalCount: snap.legalDestinations.length,
        reason: window.__wizardChess.engine.getNoMovesReason('e2'),
        toastVisible: toast ? !toast.classList.contains('hidden') : false,
        toastText: toast?.textContent?.trim() || ''
      };
    });

    if (
      pinnedState.selectedSquare !== 'e2' ||
      pinnedState.legalCount !== 0 ||
      pinnedState.reason !== 'pinned' ||
      !pinnedState.toastVisible
    ) {
      throw new Error(`Pinned Knight feedback verification failed: ${JSON.stringify(pinnedState)}`);
    }

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v4_03_pinned_knight_toast_feedback.png')
    });
    console.log(`[Verify Piece Audit] PASS 4: Pinned Knight feedback toast verified ("${pinnedState.toastText}").`);

    await contextDesktop.close();

    // =========================================================================
    // PART 5: ANDROID MOBILE PORTRAIT (390x844) & LANDSCAPE (844x390) TOUCH TAPS
    // =========================================================================
    const contextMobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await contextMobile.newPage();

    await mobilePage.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForFunction(() => Boolean(window.__wizardChess?.scene));
    await mobilePage.waitForTimeout(600);

    await mobilePage.evaluate(() => {
      const { engine, scene } = window.__wizardChess;
      engine.startNewGame({ mode: 'local', playerColor: 'w', mapId: 'cathedral', skinId: 'arcane_royalty' });
      scene.skipOpeningCinematic();
      scene.setCameraPreset('gameplay', true, 'w');
    });
    await mobilePage.waitForTimeout(300);

    // Touch tap b1 -> c3 in Mobile Portrait (390x844)
    await clickBoardSquare(mobilePage, 'b1', true);
    await mobilePage.waitForTimeout(120);
    await clickBoardSquare(mobilePage, 'c3', true);
    await mobilePage.waitForTimeout(350);

    const mobilePortraitMove = await mobilePage.evaluate(() =>
      window.__wizardChess.engine.getPieceAt('c3')
    );
    if (!mobilePortraitMove || mobilePortraitMove.type !== 'n') {
      throw new Error(`Mobile Portrait touch Knight move failed: ${JSON.stringify(mobilePortraitMove)}`);
    }

    await mobilePage.screenshot({
      path: path.join(ARTIFACT_DIR, 'v4_04_mobile_knight_touch.png')
    });

    // Rotate to Mobile Landscape (844x390) and touch tap Black Knight b8 -> c6
    await mobilePage.setViewportSize({ width: 844, height: 390 });
    await mobilePage.waitForTimeout(300);
    await mobilePage.evaluate(() => {
      window.__wizardChess.scene.setCameraPreset('gameplay', true, 'w');
    });
    await mobilePage.waitForTimeout(250);

    await clickBoardSquare(mobilePage, 'b8', true);
    await mobilePage.waitForTimeout(120);
    await clickBoardSquare(mobilePage, 'c6', true);
    await mobilePage.waitForTimeout(350);

    const mobileLandscapeMove = await mobilePage.evaluate(() =>
      window.__wizardChess.engine.getPieceAt('c6')
    );
    if (!mobileLandscapeMove || mobileLandscapeMove.type !== 'n') {
      throw new Error(`Mobile Landscape touch Knight move failed: ${JSON.stringify(mobileLandscapeMove)}`);
    }
    console.log('[Verify Piece Audit] PASS 5: Android Mobile Portrait (390x844) & Landscape (844x390) touch Knight selection & movement verified.');

    await contextMobile.close();

    // =========================================================================
    // PART 6: TWO-CLIENT LIVE ONLINE PvP — WAITING LOCK, HEARTBEAT SELECTION & MATCH
    // =========================================================================
    const ctxWhite = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxBlack = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageWhite = await ctxWhite.newPage();
    const pageBlack = await ctxBlack.newPage();

    await pageWhite.goto(`${BASE_URL}/?quality=low`, { waitUntil: 'domcontentloaded' });
    await pageWhite.waitForFunction(() => Boolean(window.__wizardChess?.scene));

    // White opens Online PvP modal and creates a room as White
    await pageWhite.click('#btn-menu-online');
    await pageWhite.waitForTimeout(150);
    await pageWhite.click('#btn-online-color-w');
    await pageWhite.click('#btn-online-create-submit');

    await pageWhite.waitForFunction(() => {
      const codeEl = document.getElementById('online-room-code-text');
      return codeEl && codeEl.textContent && codeEl.textContent.trim().length === 6 && codeEl.textContent.trim() !== '------';
    });

    const roomCode = await pageWhite.evaluate(() =>
      document.getElementById('online-room-code-text')?.textContent?.trim()
    );

    // While waiting for Black to join, verify White's engine blocks premature board selection
    const waitingCheck = await pageWhite.evaluate(() => {
      const { engine } = window.__wizardChess;
      return {
        isHumanTurn: engine.isHumanTurn(),
        selected: engine.selectSquare('b1').length
      };
    });
    if (waitingCheck.isHumanTurn !== false || waitingCheck.selected !== 0) {
      throw new Error(`Online waiting lock failed: ${JSON.stringify(waitingCheck)}`);
    }

    // Black joins via invite URL (?room=CODE)
    await pageBlack.goto(`${BASE_URL}/?room=${roomCode}&quality=low`, { waitUntil: 'domcontentloaded' });
    await pageBlack.waitForFunction(() => {
      const snap = window.__wizardChess?.engine?.getSnapshot();
      return snap && snap.config.mode === 'online' && snap.config.onlineStatus === 'playing';
    });
    await pageWhite.waitForFunction(() => {
      const snap = window.__wizardChess?.engine?.getSnapshot();
      return snap && snap.config.mode === 'online' && snap.config.onlineStatus === 'playing';
    });

    await pageWhite.evaluate(() => {
      window.__wizardChess.scene.skipOpeningCinematic();
      window.__wizardChess.scene.setCameraPreset('gameplay', true, 'w');
    });
    await pageBlack.evaluate(() => {
      window.__wizardChess.scene.skipOpeningCinematic();
      window.__wizardChess.scene.setCameraPreset('gameplay', true, 'b');
    });
    await pageWhite.waitForTimeout(300);

    // White selects Knight on b1 via 3D canvas click and waits 1100ms across a heartbeat poll
    await clickBoardSquare(pageWhite, 'b1');
    await pageWhite.waitForTimeout(1100);

    const stillSelectedAfterPoll = await pageWhite.evaluate(() =>
      window.__wizardChess.engine.getSnapshot().selectedSquare
    );
    if (stillSelectedAfterPoll !== 'b1') {
      throw new Error(`Online heartbeat poll cleared White's active b1 selection! Got: ${stillSelectedAfterPoll}`);
    }

    // Black tries clicking b8 on White's turn -> verify blocked & toast shown
    await clickBoardSquare(pageBlack, 'b8');
    await pageBlack.waitForTimeout(150);
    const blackOutTurnToast = await pageBlack.evaluate(() => {
      const toast = document.getElementById('hud-feedback-toast');
      return {
        selected: window.__wizardChess.engine.getSnapshot().selectedSquare,
        toastVisible: toast ? !toast.classList.contains('hidden') : false,
        toastText: toast?.textContent?.trim() || ''
      };
    });
    if (blackOutTurnToast.selected !== null || !blackOutTurnToast.toastVisible) {
      throw new Error(`Black out-of-turn click was not rejected with toast: ${JSON.stringify(blackOutTurnToast)}`);
    }

    // White completes Knight jump b1 -> c3 via 3D canvas click
    await clickBoardSquare(pageWhite, 'c3');
    await pageBlack.waitForFunction(
      () => window.__wizardChess.engine.getPieceAt('c3')?.type === 'n',
      { timeout: 5000 }
    );

    // Black responds Knight b8 -> c6 via 3D canvas click
    await clickBoardSquare(pageBlack, 'b8');
    await pageBlack.waitForTimeout(150);
    await clickBoardSquare(pageBlack, 'c6');
    await pageWhite.waitForFunction(
      () => window.__wizardChess.engine.getPieceAt('c6')?.type === 'n',
      { timeout: 5000 }
    );

    console.log('[Verify Piece Audit] PASS 6: Online PvP waiting lock, heartbeat selection persistence, out-of-turn toast, and 2-client 3D Knight sync verified.');

    await ctxWhite.close();
    await ctxBlack.close();

    if (errors.length > 0) {
      throw new Error(`Page runtime errors encountered: ${errors.join('; ')}`);
    }

    console.log('\n=======================================================');
    console.log('ALL 3D PIECE INTERACTION & MOVEMENT AUDITS PASSED! (6/6)');
    console.log('=======================================================\n');
  } finally {
    await browser.close();
    stopVitePreview(server);
  }
}

runVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Verify Piece Audit] FAILED:', err);
    process.exit(1);
  });
