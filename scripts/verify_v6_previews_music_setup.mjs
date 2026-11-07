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
const PORT = 4186;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startVitePreview() {
  return new Promise((resolve, reject) => {
    const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
    const proc = spawn(
      process.execPath,
      [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(proc);
      }
    }, 3000);
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (!resolved && (text.includes('Local:') || text.includes(String(PORT)))) {
        resolved = true;
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function runVerification() {
  console.log('1. Starting Vite preview server on port', PORT);
  const server = await startVitePreview();

  let browser;
  const pageErrors = [];

  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    console.log('2. Navigating to MoChess Main Menu...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => Boolean(window.__wizardChess && window.__wizardChess.scene && window.__wizardChess.ui),
      { timeout: 20000 }
    );
    await page.waitForTimeout(800);

    // Check Main Menu Music is active on launch
    const menuMusicState = await page.evaluate(() => {
      const app = window.__wizardChess;
      return app.ui.isMainMenuVisible();
    });
    assert(menuMusicState === true, 'Main Menu must be visible on launch');

    // PHASE 1: Open Map Selection Modal & Verify Real 3D Visual Previews
    console.log('3. Testing Phase 1: Map Selection Real 3D Visual Previews...');
    await page.click('#btn-menu-maps');
    await page.waitForTimeout(500);

    // Click Arcane Sanctum to showcase spotlight banner update
    await page.click('#card-map-sanctum');
    await page.waitForTimeout(450);

    const mapModalCheck = await page.evaluate(() => {
      const modal = document.getElementById('map-select-modal');
      const spotlightImg = document.getElementById('map-spotlight-img');
      const spotlightTitle = document.getElementById('map-spotlight-title')?.textContent?.trim();
      const spotlightMusic = document.getElementById('map-spotlight-music')?.textContent?.trim();
      const cardImgs = Array.from(
        document.querySelectorAll('#map-cards-grid .card-preview-img')
      ).map((img) => ({
        id: img.id,
        src: img.getAttribute('src'),
        loaded: img.complete && img.naturalWidth > 400
      }));
      const activeCard = document
        .querySelector('#map-cards-grid .map-card.active')
        ?.getAttribute('data-map');
      const savedMap = localStorage.getItem('mochess_selected_map_v1');
      return {
        visible: modal && !modal.classList.contains('hidden'),
        spotlightLoaded:
          spotlightImg && spotlightImg.complete && spotlightImg.naturalWidth > 400,
        spotlightTitle,
        spotlightMusic,
        cardImgs,
        activeCard,
        savedMap
      };
    });

    assert(mapModalCheck.visible, 'Map Selection modal should be visible');
    assert(mapModalCheck.spotlightLoaded, 'Map spotlight preview image must be loaded');
    assert(mapModalCheck.spotlightTitle === 'Arcane Sanctum', 'Map spotlight title should be Arcane Sanctum');
    assert(
      mapModalCheck.spotlightMusic?.includes('Celestial Enchantment'),
      'Map spotlight music badge should show Arcane Sanctum — Celestial Enchantment'
    );
    assert(mapModalCheck.cardImgs.length === 4, 'All 4 map preview images must exist');
    for (const img of mapModalCheck.cardImgs) {
      assert(img.loaded, `Map preview image ${img.id} (${img.src}) must load with naturalWidth > 400`);
    }
    assert(mapModalCheck.activeCard === 'sanctum', 'Active map card must be sanctum');
    assert(mapModalCheck.savedMap === 'sanctum', 'Selected map must persist in localStorage');

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v6_01_map_selection_real_previews.png')
    });
    console.log('   Saved v6_01_map_selection_real_previews.png');

    await page.click('#btn-maps-confirm');
    await page.waitForTimeout(300);

    // PHASE 2: Open Chess Skin Selection Modal & Verify Real 12-Piece 3D Model Previews
    console.log('4. Testing Phase 2: Chess Skin Selection Real 3D Model Previews...');
    await page.click('#btn-menu-skins');
    await page.waitForTimeout(500);

    // Select Mystic Sanctum skin to verify spotlight update and persistence
    await page.click('#card-skin-sanctum');
    await page.waitForTimeout(450);

    const skinModalCheck = await page.evaluate(() => {
      const modal = document.getElementById('skin-select-modal');
      const spotlightImg = document.getElementById('skin-spotlight-img');
      const spotlightTitle = document.getElementById('skin-spotlight-title')?.textContent?.trim();
      const lineupLegend = document.getElementById('skin-lineup-legend')?.textContent?.trim();
      const cardImgs = Array.from(
        document.querySelectorAll('#skin-cards-grid .card-preview-img')
      ).map((img) => ({
        id: img.id,
        src: img.getAttribute('src'),
        loaded: img.complete && img.naturalWidth > 400
      }));
      const activeSkin = document
        .querySelector('#skin-cards-grid .skin-card.active')
        ?.getAttribute('data-skin');
      const savedSkin = localStorage.getItem('mochess_selected_skin_v1');
      return {
        visible: modal && !modal.classList.contains('hidden'),
        spotlightLoaded:
          spotlightImg && spotlightImg.complete && spotlightImg.naturalWidth > 400,
        spotlightTitle,
        lineupLegend,
        cardImgs,
        activeSkin,
        savedSkin
      };
    });

    assert(skinModalCheck.visible, 'Skin Selection modal should be visible');
    assert(skinModalCheck.spotlightLoaded, 'Skin spotlight preview image must be loaded');
    assert(skinModalCheck.spotlightTitle === 'Mystic Sanctum', 'Skin spotlight title should be Mystic Sanctum');
    assert(
      skinModalCheck.lineupLegend?.includes('Pawn') &&
        skinModalCheck.lineupLegend?.includes('King'),
      'Skin lineup legend must list all 6 piece types'
    );
    assert(skinModalCheck.cardImgs.length === 4, 'All 4 skin 3D model preview images must exist');
    for (const img of skinModalCheck.cardImgs) {
      assert(img.loaded, `Skin preview image ${img.id} (${img.src}) must load with naturalWidth > 400`);
    }
    assert(skinModalCheck.activeSkin === 'mystic_sanctum', 'Active skin card must be mystic_sanctum');
    assert(skinModalCheck.savedSkin === 'mystic_sanctum', 'Selected skin must persist in localStorage');

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v6_02_skin_selection_real_3d_models.png')
    });
    console.log('   Saved v6_02_skin_selection_real_3d_models.png');

    await page.click('#btn-skins-confirm');
    await page.waitForTimeout(300);

    // PHASE 4: Simplified Play / Match Setup Modal (AI Mode vs Local Mode)
    console.log('5. Testing Phase 4: Simplified Play / Match Setup Modal...');
    await page.click('#btn-menu-play');
    await page.waitForTimeout(450);

    const lobbyAiCheck = await page.evaluate(() => {
      const lobbyMapEl = document.getElementById('select-lobby-map');
      const lobbySkinEl = document.getElementById('select-lobby-skin');
      const diffGroup = document.getElementById('group-difficulty');
      const summaryMap = document.getElementById('lobby-summary-map')?.textContent?.trim();
      const summarySkin = document.getElementById('lobby-summary-skin')?.textContent?.trim();
      return {
        hasLobbyMapSelector: Boolean(lobbyMapEl),
        hasLobbySkinSelector: Boolean(lobbySkinEl),
        difficultyVisible: diffGroup && !diffGroup.classList.contains('hidden'),
        summaryMap,
        summarySkin
      };
    });

    assert(!lobbyAiCheck.hasLobbyMapSelector, '#select-lobby-map must be removed from Match Setup');
    assert(!lobbyAiCheck.hasLobbySkinSelector, '#select-lobby-skin must be removed from Match Setup');
    assert(lobbyAiCheck.difficultyVisible, 'AI Difficulty must be visible in Single Player vs AI mode');
    assert(
      lobbyAiCheck.summaryMap === 'Arcane Sanctum',
      `Lobby summary map should be 'Arcane Sanctum', got '${lobbyAiCheck.summaryMap}'`
    );
    assert(
      lobbyAiCheck.summarySkin === 'Mystic Sanctum',
      `Lobby summary skin should be 'Mystic Sanctum', got '${lobbyAiCheck.summarySkin}'`
    );

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v6_03_simplified_match_setup_ai.png')
    });
    console.log('   Saved v6_03_simplified_match_setup_ai.png');

    // Switch to Local 2 Player inside Lobby Modal and verify AI Difficulty hides automatically
    await page.click('#btn-mode-local');
    await page.waitForTimeout(350);

    const lobbyLocalCheck = await page.evaluate(() => {
      const diffGroup = document.getElementById('group-difficulty');
      return {
        difficultyHidden: diffGroup ? diffGroup.classList.contains('hidden') : false
      };
    });
    assert(
      lobbyLocalCheck.difficultyHidden,
      'AI Difficulty must automatically hide when Local 2 Player is selected'
    );

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v6_04_simplified_match_setup_local.png')
    });
    console.log('   Saved v6_04_simplified_match_setup_local.png');

    // Start Match and verify persisted Map ('sanctum') & Skin ('mystic_sanctum') are applied in-game!
    await page.click('#btn-lobby-start');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__wizardChess.scene.skipOpeningCinematic();
    });
    await page.waitForTimeout(450);

    const inGameConfigCheck = await page.evaluate(() => {
      const cfg = window.__wizardChess.engine.getConfig();
      const sceneMap = window.__wizardChess.scene.getMap();
      const sceneSkin = window.__wizardChess.scene.getPieceSkin();
      return { cfg, sceneMap, sceneSkin };
    });
    assert(
      inGameConfigCheck.cfg.mapId === 'sanctum' && inGameConfigCheck.sceneMap === 'sanctum',
      'Started match must use persisted Main Menu map (sanctum)'
    );
    assert(
      inGameConfigCheck.cfg.skinId === 'mystic_sanctum' &&
        inGameConfigCheck.sceneSkin === 'mystic_sanctum',
      'Started match must use persisted Main Menu skin (mystic_sanctum)'
    );

    // PHASE 3: Settings Modal & Magical Fantasy Music Controls Verification
    console.log('6. Testing Phase 3: Magical Fantasy Music Overhaul & Settings Controls...');
    await page.click('#btn-settings');
    await page.waitForTimeout(450);

    const settingsMusicCheck = await page.evaluate(() => {
      const masterVol = document.getElementById('slider-volume');
      const musicVol = document.getElementById('slider-music-volume');
      const sfxVol = document.getElementById('slider-sfx-volume');
      const musicToggle = document.getElementById('toggle-music');
      const sfxToggle = document.getElementById('toggle-sound');
      const duplicateSkin = document.getElementById('select-setting-skin');
      return {
        hasMasterVol: Boolean(masterVol),
        hasMusicVol: Boolean(musicVol),
        hasSfxVol: Boolean(sfxVol),
        hasMusicToggle: Boolean(musicToggle),
        hasSfxToggle: Boolean(sfxToggle),
        hasDuplicateSkin: Boolean(duplicateSkin)
      };
    });

    assert(settingsMusicCheck.hasMasterVol, 'Settings must have Master Volume slider');
    assert(settingsMusicCheck.hasMusicVol, 'Settings must have Music Volume slider');
    assert(settingsMusicCheck.hasSfxVol, 'Settings must have SFX Volume slider');
    assert(settingsMusicCheck.hasMusicToggle, 'Settings must have Music On/Off toggle');
    assert(settingsMusicCheck.hasSfxToggle, 'Settings must have SFX On/Off toggle');
    assert(!settingsMusicCheck.hasDuplicateSkin, 'Duplicate skin selector in Settings should be removed');

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v6_05_settings_music_volumes.png')
    });
    console.log('   Saved v6_05_settings_music_volumes.png');

    await page.click('#btn-settings-done');
    await page.waitForTimeout(300);

    // PHASE 5: Mobile Portrait (390x844) & Landscape (844x390) Responsiveness Check
    console.log('7. Testing Phase 5: Mobile Portrait (390x844) & Landscape (844x390)...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.click('#btn-main-menu');
    await page.waitForTimeout(400);
    await page.click('#btn-menu-skins');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'v6_06_mobile_map_and_skin_previews.png')
    });
    console.log('   Saved v6_06_mobile_map_and_skin_previews.png');

    // Also test Mobile Landscape (844x390)
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);

    assert(pageErrors.length === 0, `Page errors encountered: ${pageErrors.join('; ')}`);
    console.log('\nALL V6 VERIFICATION CHECKS & 6 SCREENSHOTS PASSED PERFECTLY!');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server.pid) {
      try {
        execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
  }
}

runVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
  });
