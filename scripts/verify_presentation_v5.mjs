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
      [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
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

async function runVerification() {
  console.log('[Verify v5] Starting Vite preview server...');
  const server = await startVitePreview();

  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  try {
    // =========================================================================
    // 1. DESKTOP MAIN MENU HERO SCENE VERIFICATION
    // =========================================================================
    console.log('[Verify v5] 1. Verifying Dedicated Animated 3D Main Menu Scene...');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__wizardChess && window.__wizardChess.scene));
    await page.waitForTimeout(800);

    const menuState1 = await page.evaluate(() => {
      const s = window.__wizardChess.scene;
      const menuEl = document.getElementById('main-menu-screen');
      return {
        menuVisible: menuEl && !menuEl.classList.contains('hidden'),
        titleText: document.getElementById('menu-title')?.textContent?.trim(),
        subtitleText: document.getElementById('menu-subtitle')?.textContent?.trim(),
        menuShowcaseActive: s.menuShowcaseActive,
        chessboardVisible: s.chessboard.group.visible,
        piecesVisible: s.piecesGroup.visible,
        arenaVisible: s.arena.group.visible,
        heroSceneVisible: s.menuHeroScene.group.visible,
        ribbon1RotY: s.menuHeroScene.runeRibbon1.rotation.y,
        heroY: s.menuHeroScene.heroPieceGroup.position.y,
        camX: s.camera.position.x
      };
    });

    if (!menuState1.menuVisible) throw new Error('Main Menu screen should be visible on startup');
    if (menuState1.chessboardVisible || menuState1.piecesVisible || menuState1.arenaVisible) {
      throw new Error(
        `Live match board must NOT be visible in Main Menu! Got chessboard=${menuState1.chessboardVisible}, pieces=${menuState1.piecesVisible}, arena=${menuState1.arenaVisible}`
      );
    }
    if (!menuState1.heroSceneVisible) {
      throw new Error('Dedicated 3D Menu Hero Scene must be visible in Main Menu!');
    }

    await page.waitForTimeout(650);

    const menuState2 = await page.evaluate(() => {
      const s = window.__wizardChess.scene;
      return {
        ribbon1RotY: s.menuHeroScene.runeRibbon1.rotation.y,
        heroY: s.menuHeroScene.heroPieceGroup.position.y,
        camX: s.camera.position.x
      };
    });

    if (Math.abs(menuState2.ribbon1RotY - menuState1.ribbon1RotY) < 0.01) {
      throw new Error('Main Menu 3D Hero Scene rune ribbons did not animate across frames!');
    }
    console.log(
      `[Verify v5] Main Menu 3D Hero Scene verified: live board hidden, hero scene animated (ribbon delta=${(
        menuState2.ribbon1RotY - menuState1.ribbon1RotY
      ).toFixed(3)})`
    );

    const shot1 = path.join(ARTIFACT_DIR, 'v5_01_main_menu_hero_scene.png');
    await page.screenshot({ path: shot1 });
    console.log(`[Verify v5] Saved ${shot1}`);

    // =========================================================================
    // 2. MAP SELECTION MODAL INCLUDING CLASSIC MAP
    // =========================================================================
    console.log('[Verify v5] 2. Verifying Map Selection Modal (including Classic Board)...');
    await page.click('#btn-menu-maps');
    await page.waitForTimeout(350);

    const mapCardsCount = await page.locator('#map-select-modal .map-card').count();
    if (mapCardsCount < 4) {
      throw new Error(`Expected 4 map cards in #map-select-modal, got ${mapCardsCount}`);
    }

    // Click Classic Map card and confirm
    await page.click('#card-map-classic');
    await page.waitForTimeout(250);

    const shot2 = path.join(ARTIFACT_DIR, 'v5_02_map_selection_classic.png');
    await page.screenshot({ path: shot2 });
    console.log(`[Verify v5] Saved ${shot2}`);

    await page.click('#btn-maps-confirm');
    await page.waitForTimeout(350);

    // =========================================================================
    // 3. CHESS SKIN SELECTION MODAL INCLUDING CLASSIC STAUNTON SKIN
    // =========================================================================
    console.log('[Verify v5] 3. Verifying Chess Skin Selection Modal (including Classic Staunton)...');
    await page.click('#btn-menu-skins');
    await page.waitForTimeout(350);

    const skinCardsCount = await page.locator('#skin-select-modal .skin-card').count();
    if (skinCardsCount < 4) {
      throw new Error(`Expected 4 skin cards in #skin-select-modal, got ${skinCardsCount}`);
    }

    // Click Classic Staunton Skin card and screenshot before closing
    await page.click('#card-skin-classic');
    await page.waitForTimeout(250);

    const shot3 = path.join(ARTIFACT_DIR, 'v5_03_skin_selection_classic.png');
    await page.screenshot({ path: shot3 });
    console.log(`[Verify v5] Saved ${shot3}`);

    await page.click('#btn-skins-confirm');
    await page.waitForTimeout(350);

    const badges = await page.evaluate(() => ({
      mapBadge: document.getElementById('menu-current-map-badge')?.textContent?.trim(),
      skinBadge: document.getElementById('menu-current-skin-badge')?.textContent?.trim(),
      mapId: window.__wizardChess.scene.getMap(),
      skinId: window.__wizardChess.scene.getPieceSkin()
    }));
    console.log('[Verify v5] Updated menu badges & state:', badges);
    if (badges.mapId !== 'classic' || badges.skinId !== 'classic') {
      throw new Error(`Expected classic map & skin, got map=${badges.mapId}, skin=${badges.skinId}`);
    }

    // =========================================================================
    // 4. GAMEPLAY ON CLASSIC MAP WITH CLASSIC STAUNTON CHESS SKIN
    // =========================================================================
    console.log('[Verify v5] 4. Starting Local Play on Classic Map with Classic Staunton Skin...');
    await page.click('#btn-menu-local');
    await page.waitForTimeout(300);
    await page.click('#btn-lobby-start');
    await page.waitForTimeout(450);

    await page.evaluate(() => {
      window.__wizardChess.scene.skipOpeningCinematic();
    });
    await page.waitForTimeout(500);

    const classicGameplayState = await page.evaluate(() => {
      const s = window.__wizardChess.scene;
      // Select White Knight on g1 so legal move indicators are visible on Classic Board
      window.__wizardChess.engine.handleSquareInteraction('g1');
      return {
        chessboardVisible: s.chessboard.group.visible,
        piecesVisible: s.piecesGroup.visible,
        heroSceneVisible: s.menuHeroScene.group.visible,
        mapId: s.getMap(),
        skinId: s.getPieceSkin(),
        coordinatesVisible: s.chessboard.coordinatesGroup.visible,
        musicTrack: window.__wizardChess.sound.getMusicStatus().trackId
      };
    });
    await page.waitForTimeout(350);

    if (
      !classicGameplayState.chessboardVisible ||
      !classicGameplayState.piecesVisible ||
      classicGameplayState.heroSceneVisible
    ) {
      throw new Error('Gameplay board & pieces must be visible and Hero Scene hidden during match!');
    }
    console.log('[Verify v5] Classic Map + Classic Skin gameplay state:', classicGameplayState);

    const shot4 = path.join(ARTIFACT_DIR, 'v5_04_classic_map_and_skin_gameplay.png');
    await page.screenshot({ path: shot4 });
    console.log(`[Verify v5] Saved ${shot4}`);

    // Complete Knight move g1 -> f3 to verify gameplay works on Classic Map + Skin
    await page.evaluate(() => {
      window.__wizardChess.engine.handleSquareInteraction('f3');
    });
    await page.waitForTimeout(500);

    // =========================================================================
    // 5. KING VS KING CHECKMATE FINISHER CUTSCENE & VICTORY RESULT SCREEN
    // =========================================================================
    console.log('[Verify v5] 5. Verifying King vs King Checkmate Finisher Cutscene...');
    // Switch to Gothic Cathedral + Arcane Royalty skin to showcase the royal fantasy King vs King finisher
    await page.evaluate(() => {
      const { engine, scene } = window.__wizardChess;
      scene.setMap('cathedral');
      scene.setPieceSkin('arcane_royalty');
      engine.startNewGame({ mode: 'local', mapId: 'cathedral', skinId: 'arcane_royalty' });
      // Play Scholar's Mate moves up to 1 move before White delivers Checkmate (Qxf7#)
      engine.executeMove('e2', 'e4');
      engine.executeMove('e7', 'e5');
      engine.executeMove('f1', 'c4');
      engine.executeMove('b8', 'c6');
      engine.executeMove('d1', 'h5');
      engine.executeMove('g8', 'f6');
    });
    await page.waitForTimeout(550);

    // Trigger checkmating move Qxf7#
    await page.evaluate(() => {
      window.__wizardChess.engine.executeMove('h5', 'f7');
    });

    // Wait until the King vs King Checkmate Finisher Cutscene reaches peak impact (elapsed >= 1.10s into the 2.35s sequence)
    await page.waitForFunction(
      () => {
        const cm = window.__wizardChess.scene.animController.activeCheckmate;
        return Boolean(cm && cm.elapsed >= 1.10);
      },
      { timeout: 6000 }
    );

    const cutsceneMidState = await page.evaluate(() => {
      const s = window.__wizardChess.scene;
      const modal = document.getElementById('gameover-modal');
      return {
        isCheckmate: window.__wizardChess.engine.getSnapshot().resultReason === 'checkmate',
        cutscenePlaying: s.isCheckmateCutscenePlaying(),
        animActive: s.animController.isCheckmateCutsceneActive(),
        cutsceneElapsed: s.animController.activeCheckmate?.elapsed ?? 0,
        gameoverModalHidden: modal ? modal.classList.contains('hidden') : false
      };
    });
    console.log('[Verify v5] Mid-cutscene state:', cutsceneMidState);

    if (!cutsceneMidState.isCheckmate || !cutsceneMidState.cutscenePlaying) {
      throw new Error(
        `Expected King vs King Checkmate Finisher Cutscene to be playing! Got ${JSON.stringify(cutsceneMidState)}`
      );
    }
    if (!cutsceneMidState.gameoverModalHidden) {
      throw new Error('Game Over Result Screen must wait until Checkmate Finisher Cutscene finishes!');
    }

    const shot5 = path.join(ARTIFACT_DIR, 'v5_05_checkmate_finisher_cutscene.png');
    await page.screenshot({ path: shot5 });
    console.log(`[Verify v5] Saved ${shot5}`);

    // Wait for the cutscene to finish completely and verify Victory Result Screen appears
    await page.waitForFunction(() => !window.__wizardChess.scene.isCheckmateCutscenePlaying(), {
      timeout: 8000
    });
    await page.waitForTimeout(200);

    const postCutsceneState = await page.evaluate(() => {
      const s = window.__wizardChess.scene;
      const modal = document.getElementById('gameover-modal');
      return {
        cutscenePlaying: s.isCheckmateCutscenePlaying(),
        gameoverModalVisible: modal ? !modal.classList.contains('hidden') : false,
        title: document.getElementById('gameover-title')?.textContent?.trim(),
        winnerBadge: document.getElementById('gameover-winner-badge')?.textContent?.trim(),
        modeBadge: document.getElementById('gameover-mode-badge')?.textContent?.trim()
      };
    });
    console.log('[Verify v5] Post-cutscene Victory Result Screen state:', postCutsceneState);

    if (!postCutsceneState.gameoverModalVisible) {
      throw new Error('Expected Victory Result Screen (#gameover-modal) to appear after Checkmate Cutscene!');
    }

    const shot6 = path.join(ARTIFACT_DIR, 'v5_06_victory_result_screen.png');
    await page.screenshot({ path: shot6 });
    console.log(`[Verify v5] Saved ${shot6}`);

    await context.close();

    // =========================================================================
    // 6. ANDROID MOBILE PORTRAIT MAIN MENU VERIFICATION
    // =========================================================================
    console.log('[Verify v5] 6. Verifying Mobile Portrait Main Menu layout (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await mobilePage.waitForFunction(() => Boolean(window.__wizardChess && window.__wizardChess.scene));
    await mobilePage.waitForTimeout(700);

    const shot7 = path.join(ARTIFACT_DIR, 'v5_07_mobile_main_menu.png');
    await mobilePage.screenshot({ path: shot7 });
    console.log(`[Verify v5] Saved ${shot7}`);

    await mobileContext.close();

    console.log('\n[Verify v5] ALL PRESENTATION REVISION VERIFICATION CHECKS & SCREENSHOTS SUCCEEDED!');
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
    console.error('[Verify v5] Verification failed:', err);
    process.exit(1);
  });
