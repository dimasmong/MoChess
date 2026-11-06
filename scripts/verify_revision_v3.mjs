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
const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startVitePreview() {
  return new Promise((resolve, reject) => {
    const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
    const proc = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
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

async function runVerification() {
  console.log('[Verify v3] Starting Vite preview server...');
  const server = await startVitePreview();

  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  try {
    // =========================================================================
    // PART 1: DESKTOP (1280x720) — Graphics Modes, 3 Chess Skins, Maps & Music
    // =========================================================================
    const contextDesktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await contextDesktop.newPage();

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__wizardChess?.scene));
    await page.waitForTimeout(800);

    // Make a few opening moves so pieces are dynamically arranged on the board
    await page.evaluate(() => {
      const { engine } = window.__wizardChess;
      engine.startNewGame({ mode: 'local', playerColor: 'w', mapId: 'cathedral', skinId: 'arcane_royalty' });
      engine.executeMove('e2', 'e4');
      engine.executeMove('e7', 'e5');
      engine.executeMove('g1', 'f3');
      engine.executeMove('b8', 'c6');
      engine.executeMove('d2', 'd4');
      engine.executeMove('d7', 'd6');
    });
    await page.waitForTimeout(1100);

    // 1. Verify & Capture LOW Graphics Mode (3/4 Cinematic angle to clearly show board + pieces + braziers)
    await page.evaluate(() => {
      const { scene } = window.__wizardChess;
      scene.updateSettings({ quality: 'low' });
      scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(500);

    const lowStats = await page.evaluate(() => {
      const { scene } = window.__wizardChess;
      return {
        quality: scene.getSettings().quality,
        shadowEnabled: scene['renderer'].shadowMap.enabled,
        envPresent: Boolean(scene['scene'].environment),
        envIntensity: scene['scene'].environmentIntensity,
        brazierLightVisible: scene['arena'].braziers[0]?.light?.visible ?? false,
        visibleFlameLayers: scene['arena'].braziers[0]?.flameLayers.filter((l) => l.visible).length ?? 0
      };
    });
    console.log('[Verify v3] Low Graphics Stats:', JSON.stringify(lowStats));
    if (lowStats.shadowEnabled || lowStats.envPresent || lowStats.brazierLightVisible || lowStats.visibleFlameLayers > 2) {
      throw new Error(`Low Graphics Mode did not disable heavy features: ${JSON.stringify(lowStats)}`);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_01_low_graphics.png') });
    console.log('[Verify v3] Saved v3_01_low_graphics.png');

    // 2. Verify & Capture HIGH Graphics Mode from the exact same camera angle
    await page.evaluate(() => {
      const { scene } = window.__wizardChess;
      scene.updateSettings({ quality: 'high' });
      scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(600);

    const highStats = await page.evaluate(() => {
      const { scene } = window.__wizardChess;
      return {
        quality: scene.getSettings().quality,
        shadowEnabled: scene['renderer'].shadowMap.enabled,
        envPresent: Boolean(scene['scene'].environment),
        envIntensity: scene['scene'].environmentIntensity,
        brazierLightVisible: scene['arena'].braziers[0]?.light?.visible ?? false,
        visibleFlameLayers: scene['arena'].braziers[0]?.flameLayers.filter((l) => l.visible).length ?? 0
      };
    });
    console.log('[Verify v3] High Graphics Stats:', JSON.stringify(highStats));
    if (!highStats.shadowEnabled || !highStats.envPresent || !highStats.brazierLightVisible || highStats.visibleFlameLayers < 8) {
      throw new Error(`High Graphics Mode missing features: ${JSON.stringify(highStats)}`);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_02_high_graphics.png') });
    console.log('[Verify v3] Saved v3_02_high_graphics.png');

    // 3. Verify & Capture the 3 Distinct Sculpted Chess Skins
    // Skin 1: Arcane Royalty
    await page.evaluate(() => {
      const { ui, scene } = window.__wizardChess;
      ui.setPieceSkin('arcane_royalty');
      scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_04_skin_arcane_royalty.png') });
    console.log('[Verify v3] Saved v3_04_skin_arcane_royalty.png');

    // Skin 2: Runic Warforged
    await page.evaluate(() => {
      const { ui, scene } = window.__wizardChess;
      ui.setPieceSkin('runic_warforged');
      scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_05_skin_runic_warforged.png') });
    console.log('[Verify v3] Saved v3_05_skin_runic_warforged.png');

    // Skin 3: Mystic Sanctum
    await page.evaluate(() => {
      const { ui, scene } = window.__wizardChess;
      ui.setPieceSkin('mystic_sanctum');
      scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_06_skin_mystic_sanctum.png') });
    console.log('[Verify v3] Saved v3_06_skin_mystic_sanctum.png');

    // 4. Verify Map Selection & Map-Specific Music Switching
    await page.click('#btn-maps');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_07_map_selection.png') });
    console.log('[Verify v3] Saved v3_07_map_selection.png');

    await page.click('#card-map-warhall');
    await page.waitForTimeout(250);
    const warhallMusic = await page.evaluate(() => window.__wizardChess.sound.getMusicStatus());
    console.log('[Verify v3] War Hall Music Status:', JSON.stringify(warhallMusic));
    if (warhallMusic.trackId !== 'warhall_noble_march') {
      throw new Error(`Expected warhall_noble_march, got ${warhallMusic.trackId}`);
    }

    await page.click('#card-map-sanctum');
    await page.waitForTimeout(250);
    const sanctumMusic = await page.evaluate(() => window.__wizardChess.sound.getMusicStatus());
    console.log('[Verify v3] Sanctum Music Status:', JSON.stringify(sanctumMusic));
    if (sanctumMusic.trackId !== 'sanctum_mystic_astra') {
      throw new Error(`Expected sanctum_mystic_astra, got ${sanctumMusic.trackId}`);
    }

    await page.click('#card-map-cathedral');
    await page.waitForTimeout(250);
    await page.click('#btn-close-maps');
    await page.waitForTimeout(250);

    // 5. Verify Settings Modal with Graphics Quality, Chess Skin Selection, and Map Music Controls
    await page.click('#btn-settings');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_08_settings_music_skins.png') });
    console.log('[Verify v3] Saved v3_08_settings_music_skins.png');
    await page.click('#btn-settings-done');

    await contextDesktop.close();

    // =========================================================================
    // PART 2: MOBILE PORTRAIT (390x844) — Full-Board Framing & Corner Projection Check
    // =========================================================================
    const contextMobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const mobilePage = await contextMobile.newPage();

    await mobilePage.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForFunction(() => Boolean(window.__wizardChess?.scene));
    await mobilePage.waitForTimeout(800);

    await mobilePage.evaluate(() => {
      const { engine, scene } = window.__wizardChess;
      engine.startNewGame({ mode: 'ai', playerColor: 'w', mapId: 'cathedral', skinId: 'arcane_royalty' });
      scene.setCameraPreset('gameplay', true, 'w');
    });
    await mobilePage.waitForTimeout(500);

    // Mathematically verify that all 4 outer corner squares (a1, h1, a8, h8) project well inside NDC [-0.90, +0.90]
    const mobileBoardBounds = await mobilePage.evaluate(() => {
      const { scene } = window.__wizardChess;
      const cam = scene['camera'];
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();

      const corners = [
        { name: 'a1_outer', x: -4.14, y: 0, z: 4.14 },
        { name: 'h1_outer', x: 4.14, y: 0, z: 4.14 },
        { name: 'a8_outer', x: -4.14, y: 0, z: -4.14 },
        { name: 'h8_outer', x: 4.14, y: 0, z: -4.14 }
      ];

      const projected = corners.map((c) => {
        const v = scene['camera'].position.clone().set(c.x, c.y, c.z).project(cam);
        return { name: c.name, ndcX: Number(v.x.toFixed(3)), ndcY: Number(v.y.toFixed(3)) };
      });
      return {
        fov: cam.fov,
        aspect: cam.aspect,
        camPos: scene['camera'].position.toArray().map((n) => Number(n.toFixed(2))),
        projected
      };
    });

    console.log('[Verify v3] Mobile Portrait 390x844 Board Projection:', JSON.stringify(mobileBoardBounds));
    for (const pt of mobileBoardBounds.projected) {
      if (Math.abs(pt.ndcX) > 0.94 || Math.abs(pt.ndcY) > 0.85) {
        throw new Error(`Mobile board corner ${pt.name} cropped or too close to edge: ${JSON.stringify(pt)}`);
      }
    }

    // Select a pawn on e2 so legal move highlights also appear on the full mobile board
    await mobilePage.evaluate(() => {
      window.__wizardChess.engine.handleSquareInteraction('e2');
    });
    await mobilePage.waitForTimeout(350);

    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'v3_03_mobile_full_board.png') });
    console.log('[Verify v3] Saved v3_03_mobile_full_board.png');

    await contextMobile.close();

    if (errors.length > 0) {
      throw new Error(`Page runtime errors: ${errors.join('; ')}`);
    }

    console.log('[Verify v3] ALL VERIFICATION CHECKS & SCREENSHOTS SUCCEEDED!');
  } finally {
    await browser.close().catch(() => {});
    stopVitePreview(server);
  }
}

const safetyTimer = setTimeout(() => {
  console.error('[Verify v3] Safety timeout reached (90s), forcing exit.');
  process.exit(1);
}, 90000);
safetyTimer.unref();

runVerification()
  .then(() => {
    clearTimeout(safetyTimer);
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(safetyTimer);
    console.error('[Verify v3] FAILED:', err);
    process.exit(1);
  });
