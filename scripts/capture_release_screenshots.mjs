import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4195;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.resolve('docs/screenshots');

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
  throw new Error('No Chromium/Edge executable found.');
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function saveScreenshotWebp(targetPage, encoderPage, filename, quality = 0.9) {
  const outPath = path.join(OUT_DIR, filename);
  const pngBuf = await targetPage.screenshot({ type: 'png' });
  const pngDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;

  const result = await encoderPage.evaluate(
    async ({ src, q }) => {
      const img = new Image();
      img.src = src;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        dataUrl: canvas.toDataURL('image/webp', q)
      };
    },
    { src: pngDataUrl, q: quality }
  );

  if (!result.dataUrl.startsWith('data:image/webp;base64,')) {
    throw new Error(`Failed to encode WebP for ${filename}`);
  }
  const webpBuf = Buffer.from(result.dataUrl.replace(/^data:image\/webp;base64,/, ''), 'base64');
  if (webpBuf.toString('ascii', 0, 4) !== 'RIFF' || webpBuf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`Invalid RIFF/WEBP header for ${filename}`);
  }
  fs.writeFileSync(outPath, webpBuf);
  console.log(
    `[Screenshots] Saved ${filename} (${result.width}x${result.height}, ${(webpBuf.length / 1024).toFixed(1)} KB)`
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[Screenshots] Starting Vite preview server on port ${PORT}...`);
  const server = spawn(
    'cmd.exe',
    ['/c', 'npx', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: 'pipe'
    }
  );

  let browser;
  try {
    await waitForServer(BASE_URL);

    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
    });

    const encoderCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const encoderPage = await encoderCtx.newPage();
    await encoderPage.setContent('<!DOCTYPE html><html><body></body></html>');

    // =========================================================================
    // DESKTOP CONTEXT (1440x900)
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1
    });
    const page = await desktopCtx.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => Boolean(window.__wizardChess?.scene && window.__wizardChess?.engine && window.__wizardChess?.ui),
      { timeout: 20000 }
    );

    // 1. main-menu.webp — Dedicated animated 3D Main Menu Hero Scene
    await page.evaluate(() => {
      const app = window.__wizardChess;
      app.scene.updateSettings({ quality: 'high', reducedMotion: false, pieceMarkers: true });
      app.ui.showMainMenu(true);
      app.scene.setMenuShowcaseMode(true);
    });
    await page.waitForTimeout(1000);
    await saveScreenshotWebp(page, encoderPage, 'main-menu.webp', 0.9);

    // 2–5. Four Battle Arenas in rich panoramic 3/4 architectural + gameplay framing
    const arenaShots = [
      {
        file: 'gothic-cathedral.webp',
        mapId: 'cathedral',
        skinId: 'arcane_royalty',
        camPos: [-4.1, 2.55, 7.25],
        target: [0, 1.25, -1.6]
      },
      {
        file: 'royal-war-hall.webp',
        mapId: 'warhall',
        skinId: 'runic_warforged',
        camPos: [4.2, 2.6, 7.2],
        target: [0, 1.3, -1.6]
      },
      {
        file: 'arcane-sanctum.webp',
        mapId: 'sanctum',
        skinId: 'mystic_sanctum',
        camPos: [-4.25, 2.65, 7.3],
        target: [0, 1.3, -1.5]
      },
      {
        file: 'classic-board.webp',
        mapId: 'classic',
        skinId: 'classic',
        camPos: [3.85, 3.65, 6.85],
        target: [0, 0.65, -0.4]
      }
    ];

    for (const shot of arenaShots) {
      await page.evaluate(({ mapId, skinId, camPos, target }) => {
        const app = window.__wizardChess;
        app.ui.showMainMenu(false);
        app.engine.startNewGame({
          mode: 'local',
          playerColor: 'w',
          mapId,
          skinId
        });
        app.scene.skipOpeningCinematic();
        app.scene.updateSettings({ quality: 'high', pieceMarkers: true });
        app.scene.setMap(mapId);
        app.scene.setPieceSkin(skinId);
        // Play 2 natural opening moves so the battlefield looks active
        app.engine.executeMove('e2', 'e4');
        app.engine.executeMove('e7', 'e5');
        app.engine.executeMove('g1', 'f3');
        app.engine.executeMove('b8', 'c6');
        app.scene.rebuildAllPieces(app.engine.getSnapshot());

        app.scene.cameraTween = null;
        app.scene.camera.fov = 48;
        app.scene.camera.position.set(camPos[0], camPos[1], camPos[2]);
        app.scene.controls.target.set(target[0], target[1], target[2]);
        app.scene.camera.lookAt(app.scene.controls.target);
        app.scene.camera.updateProjectionMatrix();
      }, shot);
      await page.waitForTimeout(850);
      await saveScreenshotWebp(page, encoderPage, shot.file, 0.9);
    }

    // 6–9. Four Chess Skins — Real 12-Piece 3D Model Showcase on Matching Arena Boards
    const skinShots = [
      { file: 'arcane-royalty.webp', skinId: 'arcane_royalty', mapId: 'cathedral' },
      { file: 'runic-warforged.webp', skinId: 'runic_warforged', mapId: 'warhall' },
      { file: 'mystic-sanctum-skin.webp', skinId: 'mystic_sanctum', mapId: 'sanctum' },
      { file: 'classic-staunton.webp', skinId: 'classic', mapId: 'classic' }
    ];

    for (const sk of skinShots) {
      await page.evaluate(({ skinId, mapId }) => {
        const app = window.__wizardChess;
        app.ui.showMainMenu(false);
        app.engine.startNewGame({
          mode: 'local',
          playerColor: 'w',
          mapId,
          skinId
        });
        app.scene.skipOpeningCinematic();

        const showcaseFen = '8/8/8/1kqbnrp1/1KQBNRP1/8/8/8 w - - 0 1';
        app.scene.setMap(mapId);
        app.scene.setPieceSkin(skinId);
        app.scene.chessboard.updateHighlights(null, [], null, null);
        app.scene.rebuildAllPieces({
          ...app.engine.getSnapshot(),
          fen: showcaseFen
        });
        // Angle pieces heroically toward the showcase camera so 3D faces, knights, and top emblems shine
        for (const [sq, obj] of app.scene.pieceObjects.entries()) {
          obj.rotation.y = sq.endsWith('4') ? 0.16 : -0.16;
        }

        app.scene.cameraTween = null;
        app.scene.camera.fov = 34.5;
        app.scene.camera.position.set(0.0, 3.95, 5.85);
        app.scene.controls.target.set(0.0, 0.58, -0.05);
        app.scene.camera.lookAt(app.scene.controls.target);
        app.scene.camera.updateProjectionMatrix();
      }, sk);
      await page.waitForTimeout(750);
      await saveScreenshotWebp(page, encoderPage, sk.file, 0.92);
    }

    // Restore HUD visibility & default camera FOV
    await page.evaluate(() => {
      const topHud = document.querySelector('.hud-top');
      const bottomHud = document.querySelector('.hud-bottom');
      if (topHud) topHud.style.visibility = '';
      if (bottomHud) bottomHud.style.visibility = '';
      window.__wizardChess.scene.camera.fov = 45;
      window.__wizardChess.scene.camera.updateProjectionMatrix();
    });

    // 10. top-down-gameplay.webp — Direct Overhead Tactical Position with Role Identifiers & Legal Sigils
    await page.evaluate(() => {
      const app = window.__wizardChess;
      app.ui.showMainMenu(false);
      app.engine.startNewGame({
        mode: 'local',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty'
      });
      app.scene.skipOpeningCinematic();
      app.scene.updateSettings({ quality: 'high', pieceMarkers: true });
      app.scene.setMap('cathedral');
      app.scene.setPieceSkin('arcane_royalty');
      // Italian Game position with rich tactical options
      app.engine.executeMove('e2', 'e4');
      app.engine.executeMove('e7', 'e5');
      app.engine.executeMove('g1', 'f3');
      app.engine.executeMove('b8', 'c6');
      app.engine.executeMove('f1', 'c4');
      app.engine.executeMove('g8', 'f6');
      app.scene.rebuildAllPieces(app.engine.getSnapshot());
      app.scene.setCameraPreset('top', true, 'w');
      // Select White Knight on f3 to display glowing legal move & capture (Nxe5) sigils
      app.engine.selectSquare('f3');
    });
    await page.waitForTimeout(800);
    await saveScreenshotWebp(page, encoderPage, 'top-down-gameplay.webp', 0.92);

    // 11. checkmate.webp — Real Checkmate Finisher Cutscene (Scholar's Mate: White King Finisher)
    await page.evaluate(() => {
      const app = window.__wizardChess;
      app.ui.showMainMenu(false);
      app.scene.updateSettings({ quality: 'high', reducedMotion: false, pieceMarkers: true });
      app.engine.startNewGame({
        mode: 'local',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty'
      });
      app.scene.skipOpeningCinematic();
      app.engine.executeMove('e2', 'e4');
      app.engine.executeMove('e7', 'e5');
      app.engine.executeMove('f1', 'c4');
      app.engine.executeMove('b8', 'c6');
      app.engine.executeMove('d1', 'h5');
      app.engine.executeMove('g8', 'f6');
      app.scene.rebuildAllPieces(app.engine.getSnapshot());
      // Trigger checkmate move Qxf7#
      app.engine.executeMove('h5', 'f7');
    });
    // Wait until the Checkmate Finisher Cutscene reaches peak King-vs-King arcane impact (~1.75s after move)
    await page.waitForTimeout(1750);
    await saveScreenshotWebp(page, encoderPage, 'checkmate.webp', 0.9);

    // Wait for gameover modal to finish settling before opening Online PvP
    await page.waitForFunction(
      () => !document.getElementById('gameover-modal')?.classList.contains('hidden'),
      { timeout: 6000 }
    );

    // 12. online-pvp.webp — Actual Online Private PvP Room Interface
    await page.evaluate(() => {
      document.getElementById('gameover-modal')?.classList.add('hidden');
      window.__wizardChess.ui.showMainMenu(true);
    });
    await page.waitForTimeout(300);
    await page.click('#btn-menu-online');
    await page.waitForSelector('#online-modal:not(.hidden)', { timeout: 5000 });
    await page.click('#btn-online-color-w');
    await page.click('#btn-online-map-sanctum');
    await page.click('#btn-online-create-submit');
    await page.waitForSelector('#online-waiting-view:not(.hidden)', { timeout: 8000 });
    await page.waitForFunction(
      () => {
        const code = document.getElementById('online-room-code-text')?.textContent?.trim() || '';
        return code.length >= 5 && !code.includes('-');
      },
      { timeout: 8000 }
    );
    // Normalize preview server localhost port in the displayed shareable invite URL to production domain
    await page.evaluate(() => {
      const inp = document.getElementById('online-invite-url-input');
      if (inp && inp.value) {
        inp.value = inp.value.replace(/^http:\/\/localhost:\d+/, 'https://mochess-arcane.vercel.app');
      }
    });
    await page.waitForTimeout(500);
    await saveScreenshotWebp(page, encoderPage, 'online-pvp.webp', 0.9);

    await desktopCtx.close();

    // =========================================================================
    // 13. mobile-gameplay.webp — Responsive Android Mobile Portrait (390x844 @ 2x)
    // =========================================================================
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const mPage = await mobileCtx.newPage();
    mPage.on('pageerror', (err) => pageErrors.push(err.message));

    await mPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await mPage.waitForFunction(() => Boolean(window.__wizardChess?.scene), { timeout: 20000 });
    await mPage.evaluate(() => {
      const app = window.__wizardChess;
      app.ui.showMainMenu(false);
      app.engine.startNewGame({
        mode: 'ai',
        difficulty: 'knight',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty'
      });
      app.scene.skipOpeningCinematic();
      app.scene.updateSettings({ quality: 'medium', pieceMarkers: true });
      app.scene.setCameraPreset('gameplay', true, 'w');
      app.engine.selectSquare('g1');
    });
    await mPage.waitForTimeout(850);
    await saveScreenshotWebp(mPage, encoderPage, 'mobile-gameplay.webp', 0.9);

    await mobileCtx.close();
    await encoderCtx.close();

    if (pageErrors.length > 0) {
      throw new Error(`Unexpected page errors during capture: ${pageErrors.join(' | ')}`);
    }
    console.log('\n[Screenshots] All 13 genuine WebP screenshots captured cleanly!');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server?.pid) {
      try {
        execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Screenshots] FAILED:', err);
    process.exit(1);
  });
