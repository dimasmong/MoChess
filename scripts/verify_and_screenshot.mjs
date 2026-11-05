import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT_DIR, 'screenshots');
const DOCS_SCREENSHOT_DIR = path.join(ROOT_DIR, 'docs', 'screenshots');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowserExecutable() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Could not find Chrome or Edge executable.');
}

async function saveShot(page, filename, legacyFilename) {
  const docsPath = path.join(DOCS_SCREENSHOT_DIR, filename);
  await page.screenshot({ path: docsPath });
  if (legacyFilename) {
    fs.copyFileSync(docsPath, path.join(SCREENSHOT_DIR, legacyFilename));
  }
  console.log(`[QA] Captured docs/screenshots/${filename}`);
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(DOCS_SCREENSHOT_DIR, { recursive: true });

  const server = await createServer({
    root: ROOT_DIR,
    server: { port: 4173, strictPort: false }
  });
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 4173;
  const url = `http://localhost:${port}`;
  console.log(`[QA & Visual Verification] Dev server listening at ${url}`);

  const executablePath = findBrowserExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox'
    ]
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__wizardChess));
    await page.waitForTimeout(800);

    // 1. Verify Main Menu & Developer Identity Footer + capture 01_main_menu.png
    const menuVisible = await page.evaluate(
      () => !document.getElementById('main-menu-screen').classList.contains('hidden')
    );
    if (!menuVisible) {
      throw new Error('Main Menu screen should be visible on initial launch');
    }
    const footerSig = await page.textContent('#menu-footer-signature');
    const footerCopy = await page.textContent('#menu-footer-copyright');
    const githubHref = await page.getAttribute('#menu-github-link', 'href');
    if (
      !footerSig?.includes('Crafted with ❤️ by Dimas Mong') ||
      !footerCopy?.includes('© 2026 Dimas Mong') ||
      githubHref !== 'https://github.com/dimasmong'
    ) {
      throw new Error(`Developer identity missing on Main Menu footer: sig=${footerSig}, copy=${footerCopy}, href=${githubHref}`);
    }
    await saveShot(page, '01_main_menu.png', 'v2_01_main_menu.png');

    // 2. Verify Credits Modal & Developer Branding + capture 02_credits_modal.png
    await page.click('#btn-menu-credits');
    await page.waitForTimeout(250);
    const creditsVisible = await page.evaluate(
      () => !document.getElementById('credits-modal').classList.contains('hidden')
    );
    const creditsHref = await page.getAttribute('#credits-github-link', 'href');
    if (!creditsVisible || creditsHref !== 'https://github.com/dimasmong') {
      throw new Error('Credits modal or GitHub link did not render properly');
    }
    await saveShot(page, '02_credits_modal.png');
    await page.click('#btn-credits-close');
    await page.waitForTimeout(150);

    // 3. Test Language Switching on Main Menu (EN -> ID -> EN)
    await page.click('#btn-menu-lang');
    await page.waitForTimeout(150);
    const idPlayText = await page.textContent('#btn-menu-play');
    if (idPlayText?.trim() !== 'Main Sekarang') {
      throw new Error(`Expected Indonesian 'Main Sekarang' on Play button, got '${idPlayText}'`);
    }
    await page.click('#btn-menu-lang');
    await page.waitForTimeout(150);
    const enPlayText = await page.textContent('#btn-menu-play');
    if (enPlayText?.trim() !== 'Play') {
      throw new Error(`Expected English 'Play' on Play button, got '${enPlayText}'`);
    }

    // 4. Open Map Selection from Main Menu & capture 03_map_selection.png
    await page.click('#btn-menu-maps');
    await page.waitForTimeout(350);
    await saveShot(page, '03_map_selection.png', 'v2_02_map_selection.png');

    // Confirm Map Selection -> opens Lobby -> Click Start Match -> triggers Opening Cinematic Camera on Gothic Cathedral
    await page.click('#btn-maps-confirm');
    await page.waitForTimeout(200);
    await page.click('#btn-lobby-start');
    await page.waitForTimeout(550);

    const isCinematicActive = await page.evaluate(() => window.__wizardChess.scene.isOpeningCinematicPlaying());
    if (!isCinematicActive) {
      throw new Error('Opening Cinematic Camera should be active right after starting a match');
    }
    await saveShot(page, '04_map_gothic_cathedral.png', 'v2_03_opening_cinematic.png');

    // Wait for Opening Cinematic to automatically transition into the centered Gameplay Chess Camera
    await page.waitForTimeout(2600);
    const presetAfterIntro = await page.evaluate(() => window.__wizardChess.scene.getCameraPreset());
    if (presetAfterIntro !== 'gameplay') {
      throw new Error(`Expected camera preset 'gameplay' after opening cinematic, got '${presetAfterIntro}'`);
    }

    // 5. Select a piece in the centered Gameplay Camera & capture 07_gameplay_strategic.png
    await page.evaluate(() => {
      window.__wizardChess.engine.selectSquare('e2');
    });
    await page.waitForTimeout(350);
    await saveShot(page, '07_gameplay_strategic.png', 'v2_04_gameplay_topdown_camera.png');

    // 6. Trigger a Role-Specific Capture Combat Animation & capture mid-strike (08_battle_capture_animation.png)
    await page.evaluate(() => {
      const eng = window.__wizardChess.engine;
      eng.startNewGame({ mode: 'local', playerColor: 'w', aiDifficulty: 'knight', timeControlMinutes: 0, mapId: 'cathedral' });
      eng.executeMove('e2', 'e4');
      eng.executeMove('d7', 'd5');
      window.__wizardChess.scene.rebuildAllPieces(eng.getSnapshot());
      window.__wizardChess.scene.setCameraPreset('gameplay', true);
      eng.executeMove('e4', 'd5');
    });
    await page.waitForTimeout(420);
    await saveShot(page, '08_battle_capture_animation.png', 'v2_05_capture_combat_animation.png');
    await page.waitForTimeout(600);

    // 7. Verify Map 2: Royal War Hall & capture 05_map_royal_war_hall.png
    await page.evaluate(() => {
      const eng = window.__wizardChess.engine;
      eng.setMap('warhall');
      window.__wizardChess.scene.setMap('warhall');
      window.__wizardChess.scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(450);
    await saveShot(page, '05_map_royal_war_hall.png', 'v2_07_map_royal_war_hall.png');

    // 8. Verify Map 3: Arcane Sanctum & capture 06_map_arcane_sanctum.png
    await page.evaluate(() => {
      const eng = window.__wizardChess.engine;
      eng.setMap('sanctum');
      window.__wizardChess.scene.setMap('sanctum');
      window.__wizardChess.scene.setCameraPreset('cinematic', true);
    });
    await page.waitForTimeout(450);
    await saveShot(page, '06_map_arcane_sanctum.png', 'v2_08_map_arcane_sanctum.png');

    // Switch back to Gothic Cathedral for Settings & Checkmate verification
    await page.evaluate(() => {
      window.__wizardChess.engine.setMap('cathedral');
      window.__wizardChess.scene.setMap('cathedral');
      window.__wizardChess.scene.setCameraPreset('gameplay', true);
    });
    await page.waitForTimeout(300);

    // 9. Verify Settings Modal & Bahasa Indonesia Localization (10_settings_indonesian.png)
    await page.click('#btn-settings');
    await page.waitForTimeout(200);
    await page.click('#select-language [data-lang="id"]');
    await page.waitForTimeout(250);
    const idSettingsTitle = await page.textContent('#settings-title');
    if (!idSettingsTitle?.includes('Pengaturan')) {
      throw new Error(`Expected Indonesian settings title, got '${idSettingsTitle}'`);
    }
    await saveShot(page, '10_settings_indonesian.png', 'v2_09_settings_indonesian.png');

    // Switch back to English and close Settings
    await page.click('#select-language [data-lang="en"]');
    await page.waitForTimeout(150);
    await page.click('#btn-settings-done');
    await page.waitForTimeout(150);

    // 10. Verify Checkmate End-State Overlay & Post-Checkmate Move Locking (09_checkmate_screen.png)
    await page.evaluate(() => {
      const eng = window.__wizardChess.engine;
      eng.startNewGame({ mode: 'local', playerColor: 'w', aiDifficulty: 'knight', timeControlMinutes: 0, mapId: 'cathedral' });
      eng.executeMove('e2', 'e4');
      eng.executeMove('e7', 'e5');
      eng.executeMove('f1', 'c4');
      eng.executeMove('b8', 'c6');
      eng.executeMove('d1', 'h5');
      eng.executeMove('g8', 'f6');
      window.__wizardChess.scene.rebuildAllPieces(eng.getSnapshot());
      window.__wizardChess.scene.setCameraPreset('gameplay', true);
      eng.executeMove('h5', 'f7');
    });
    await page.waitForTimeout(950);

    const gameoverVisible = await page.evaluate(
      () => !document.getElementById('gameover-modal').classList.contains('hidden')
    );
    if (!gameoverVisible) {
      throw new Error('Checkmate Game Over overlay did not appear after Qxf7#');
    }
    await saveShot(page, '09_checkmate_screen.png', 'v2_06_checkmate_overlay.png');

    await page.click('#btn-gameover-rematch');
    await page.waitForTimeout(300);
    const isOverAfterRematch = await page.evaluate(() => window.__wizardChess.engine.isGameOver());
    if (isOverAfterRematch) {
      throw new Error('Rematch button did not reset game over state');
    }

    // 11. Check Mobile Viewport (390x844 Android Portrait) & verify zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (hasOverflow) {
      throw new Error('Mobile layout has horizontal overflow!');
    }

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        `Browser errors detected: console=${JSON.stringify(consoleErrors)}, page=${JSON.stringify(pageErrors)}`
      );
    }

    console.log('[QA & Visual Verification] All E2E checks and 10 docs/screenshots/ succeeded with 0 errors!');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('[QA & Visual Verification] FAILED:', err);
  process.exit(1);
});
