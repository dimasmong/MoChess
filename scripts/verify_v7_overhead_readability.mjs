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
const PORT = 4192;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

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

async function getSquareScreenPoint(page, square) {
  return page.evaluate((sq) => {
    const app = window.__wizardChess;
    const sceneMgr = app.scene;
    const tile = sceneMgr.chessboard.tileMeshes.get(sq);
    const pos = tile.position.clone();
    pos.y = 0.08;
    pos.project(sceneMgr.camera);
    const rect = sceneMgr.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((pos.x + 1) / 2) * rect.width,
      y: rect.top + ((-pos.y + 1) / 2) * rect.height
    };
  }, square);
}

async function main() {
  console.log('[v7 Verify] Starting Vite preview server on port', PORT);
  const server = await startVitePreview();
  let browser;
  const pageErrors = [];

  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    });

    // =========================================================================
    // 1. DESKTOP OVERHEAD SCREENSHOTS FOR ALL 4 SKINS + CLOSE-UP COMPARISON
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1
    });
    const page = await desktopCtx.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => Boolean(window.__wizardChess?.scene && window.__wizardChess?.engine && window.__wizardChess?.ui),
      { timeout: 20000 }
    );
    await page.waitForTimeout(800);

    // Refresh Classic Skin 3D preview PNG after Classic Knight poll height polish
    const classicSkinUrl = await page.evaluate(() => {
      window.__wizardChess.scene.skinPreviewCache.clear();
      return window.__wizardChess.scene.renderSkinPreviewDataUrl('classic', 960, 540);
    });
    const classicSkinBuf = Buffer.from(classicSkinUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.resolve('public/previews/skins/skin_classic.png'), classicSkinBuf);
    fs.writeFileSync(path.resolve('dist/previews/skins/skin_classic.png'), classicSkinBuf);
    console.log('[v7 Verify] Refreshed skin_classic.png with polished Classic Knight poll');

    // Configure local 2P mode so we can inspect & test freely without AI interrupting
    const skinConfigs = [
      {
        skinId: 'arcane_royalty',
        mapId: 'cathedral',
        file: 'v7_01_arcane_royalty_topdown.png'
      },
      {
        skinId: 'runic_warforged',
        mapId: 'warhall',
        file: 'v7_02_runic_warforged_topdown.png'
      },
      {
        skinId: 'mystic_sanctum',
        mapId: 'sanctum',
        file: 'v7_03_mystic_sanctum_topdown.png'
      },
      {
        skinId: 'classic',
        mapId: 'classic',
        file: 'v7_04_classic_staunton_topdown.png'
      }
    ];

    for (const cfg of skinConfigs) {
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
        app.scene.updateSettings({ quality: 'high', pieceMarkers: true });
        app.scene.setMap(mapId);
        app.scene.setPieceSkin(skinId);
        app.scene.rebuildAllPieces(app.engine.getSnapshot());
        app.scene.setCameraPreset('top', true, 'w');
      }, cfg);
      await page.waitForTimeout(750);
      const outPath = `${ARTIFACT_DIR}/${cfg.file}`;
      await page.screenshot({ path: outPath });
      console.log(`[v7 Verify] Captured ${cfg.file}`);
    }

    // =========================================================================
    // 2. CLOSE-UP 6-ROLE x 4-SKIN OVERHEAD & 3/4 COMPOSITE COMPARISON SHEET
    // =========================================================================
    const closeupDataUrl = await page.evaluate(async () => {
      const app = window.__wizardChess;
      const sceneMgr = app.scene;
      const THREE_REF = sceneMgr.scene.constructor; // Scene constructor gives module access via objects

      // Render high-res overhead + 3/4 strips for each of the 4 skins and composite onto a crisp 1920x1280 sheet
      const skins = [
        { id: 'arcane_royalty', label: 'SKIN 1: ARCANE ROYALTY (Cathedral Ivory & Obsidian)' },
        { id: 'runic_warforged', label: 'SKIN 2: RUNIC WARFORGED (Forged Plate & Hex Gear Pedestal)' },
        { id: 'mystic_sanctum', label: 'SKIN 3: MYSTIC SANCTUM (Astral Crystal & Astrolabe Ring)' },
        { id: 'classic', label: 'SKIN 4: CLASSIC STAUNTON (Championship Turned Wood & Inlays)' }
      ];
      const roles = [
        { sym: 'k', name: 'KING', sub: 'Royal Gold • Cross ✠', hex: '#f6c138' },
        { sym: 'q', name: 'QUEEN', sub: 'Amethyst • 8-Star ✴', hex: '#9b3dff' },
        { sym: 'b', name: 'BISHOP', sub: 'Arcane Cyan • Diamond ◆', hex: '#14ccf5' },
        { sym: 'n', name: 'KNIGHT', sub: 'Ember Red • Horse ♞', hex: '#eb3434' },
        { sym: 'r', name: 'ROOK', sub: 'Emerald • Fortress ♜', hex: '#18c668' },
        { sym: 'p', name: 'PAWN', sub: 'Pearl Silver • Dot ●', hex: '#c6daf0' }
      ];

      // Set up clean custom arrangement on the Classic high-contrast board (or dark showcase board):
      // Put White K Q B N R P on rank 4 (a4..f4) and Black K Q B N R P on rank 5 (a5..f5) and zoom camera tight!
      const outCanvas = document.createElement('canvas');
      outCanvas.width = 1920;
      outCanvas.height = 1280;
      const ctx = outCanvas.getContext('2d');
      ctx.fillStyle = '#0d0b14';
      ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);

      // Header Banner
      ctx.fillStyle = '#171326';
      ctx.fillRect(0, 0, 1920, 96);
      ctx.strokeStyle = '#d4a84f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 96);
      ctx.lineTo(1920, 96);
      ctx.stroke();

      ctx.fillStyle = '#f6d379';
      ctx.font = 'bold 24px Georgia, serif';
      ctx.fillText('MOCHESS — 6-ROLE OVERHEAD & 3/4 IDENTITY COMPARISON', 36, 42);
      ctx.fillStyle = '#cfc6dc';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText(
        'Left: Direct 90° Overhead Close-Up (Silhouette + 3D Top Symbol + Role Color)  |  Right: Elevated 3/4 Sculpted Close-Up',
        36,
        74
      );

      // Role Legend Pills at top-right
      roles.forEach((r, idx) => {
        const rx = 1175 + (idx % 3) * 240;
        const ry = idx < 3 ? 15 : 51;
        ctx.fillStyle = '#221c35';
        ctx.fillRect(rx, ry, 228, 28);
        ctx.fillStyle = r.hex;
        ctx.beginPath();
        ctx.arc(rx + 15, ry + 14, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f4efe6';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText(`${r.name}: ${r.sub.split('•')[1].trim()}`, rx + 28, ry + 18);
      });

      const customFen = '8/8/8/kqbnrp2/KQBNRP2/8/8/8 w - - 0 1';
      sceneMgr.setMap('cathedral');
      sceneMgr.chessboard.group.visible = true;
      sceneMgr.arena.group.visible = false;
      sceneMgr.chessboard.updateHighlights(null, [], null, null);

      const stripW = 910;
      const stripH = 248;

      for (let sIdx = 0; sIdx < skins.length; sIdx++) {
        const sk = skins[sIdx];
        const rowY = 110 + sIdx * 290;

        // Separate Left & Right Header Bars (zero text overlap!)
        ctx.fillStyle = '#1b162b';
        ctx.fillRect(28, rowY, stripW, 32);
        ctx.fillRect(982, rowY, stripW, 32);

        // Column role labels aligned directly above the 6 magnified pieces in the Left 90° Overhead strip
        const colNames = ['KING (✠)', 'QUEEN (✴)', 'BISHOP (◆)', 'KNIGHT (♞)', 'ROOK (♜)', 'PAWN (●)'];
        colNames.forEach((cn, cIdx) => {
          ctx.fillStyle = roles[cIdx].hex;
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.fillText(cn, 128 + cIdx * 124, rowY + 21);
        });

        // Skin Title cleanly placed above the Right 3/4 Sculpted Close-Up strip
        ctx.fillStyle = '#f3c75f';
        ctx.font = 'bold 15px Georgia, serif';
        ctx.fillText(sk.label, 998, rowY + 21);

        sceneMgr.assetManager.setSkin(sk.id);
        sceneMgr.rebuildAllPieces({
          ...app.engine.getSnapshot(),
          fen: customFen
        });
        // Face all pieces cleanly toward camera (+Z) for crystal-clear comparison
        for (const obj of sceneMgr.pieceObjects.values()) {
          obj.rotation.y = 0;
        }

        // 1) Tight Magnified Direct 90° Overhead Close-Up Strip (centered on files a..f at x = -1.0, z = 0.0)
        sceneMgr.renderer.setSize(stripW, stripH, false);
        sceneMgr.camera.aspect = stripW / stripH;
        sceneMgr.camera.fov = 13.2;
        sceneMgr.camera.position.set(-1.0, 9.6, 0.01);
        sceneMgr.camera.lookAt(-1.0, 0.65, 0.0);
        sceneMgr.camera.updateProjectionMatrix();
        sceneMgr.renderer.render(sceneMgr.scene, sceneMgr.camera);

        const imgTop = new Image();
        imgTop.src = sceneMgr.renderer.domElement.toDataURL('image/png');
        await new Promise((r) => (imgTop.onload = r));
        ctx.drawImage(imgTop, 28, rowY + 34, stripW, stripH);
        ctx.strokeStyle = 'rgba(212, 168, 79, 0.45)';
        ctx.strokeRect(28, rowY + 34, stripW, stripH);

        // 2) Tight Magnified Elevated 3/4 Strategic Close-Up Strip
        sceneMgr.camera.fov = 18.5;
        sceneMgr.camera.position.set(-1.0, 4.4, 5.2);
        sceneMgr.camera.lookAt(-1.0, 0.65, 0.0);
        sceneMgr.camera.updateProjectionMatrix();
        sceneMgr.renderer.render(sceneMgr.scene, sceneMgr.camera);

        const img34 = new Image();
        img34.src = sceneMgr.renderer.domElement.toDataURL('image/png');
        await new Promise((r) => (img34.onload = r));
        ctx.drawImage(img34, 982, rowY + 34, stripW, stripH);
        ctx.strokeRect(982, rowY + 34, stripW, stripH);
      }

      // Restore normal viewport & board state
      sceneMgr.arena.group.visible = true;
      sceneMgr.handleResize();
      sceneMgr.rebuildAllPieces(app.engine.getSnapshot());
      sceneMgr.setCameraPreset('gameplay', true, 'w');
      return outCanvas.toDataURL('image/png');
    });

    fs.writeFileSync(
      `${ARTIFACT_DIR}/v7_05_closeup_6_roles_comparison.png`,
      Buffer.from(closeupDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
    );
    console.log('[v7 Verify] Captured v7_05_closeup_6_roles_comparison.png');

    // =========================================================================
    // 3. E2E GAMEPLAY INTERACTION: KNIGHT JUMP, CAPTURE, MARKERS ON/OFF, LOW GFX
    // =========================================================================
    await page.evaluate(() => {
      const app = window.__wizardChess;
      app.engine.startNewGame({
        mode: 'local',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty'
      });
      app.scene.skipOpeningCinematic();
      app.scene.setPieceSkin('arcane_royalty');
      app.scene.rebuildAllPieces(app.engine.getSnapshot());
      app.scene.setCameraPreset('gameplay', true, 'w');
    });
    await page.waitForTimeout(400);

    // 3a. Knight selection & L-jump over pawns (g1 -> f3)
    const g1Pt = await getSquareScreenPoint(page, 'g1');
    await page.mouse.click(g1Pt.x, g1Pt.y);
    await page.waitForTimeout(200);
    const selectedAfterG1 = await page.evaluate(() => {
      const s = window.__wizardChess.engine.getSnapshot();
      return {
        selected: s.selectedSquare,
        dests: s.legalDestinations.map((d) => (typeof d === 'string' ? d : d.square))
      };
    });
    assert(selectedAfterG1.selected === 'g1', `Expected g1 Knight selected, got ${selectedAfterG1.selected}`);
    assert(
      selectedAfterG1.dests.includes('f3') && selectedAfterG1.dests.includes('h3'),
      `Expected Knight jump destinations f3 & h3, got ${selectedAfterG1.dests.join(',')}`
    );

    const f3Pt = await getSquareScreenPoint(page, 'f3');
    await page.mouse.click(f3Pt.x, f3Pt.y);
    await page.waitForTimeout(650);
    const fenAfterJump = await page.evaluate(() => window.__wizardChess.engine.getSnapshot().fen);
    assert(fenAfterJump.includes('5N2'), `Expected White Knight on f3 in FEN, got ${fenAfterJump}`);
    console.log('[v7 Verify] Verified Knight 3D selection & L-jump over pawns (g1 -> f3)');

    // 3b. Capture sequence verification (d7->d5, e2->e4, d5xe4)
    await page.evaluate(() => {
      const eng = window.__wizardChess.engine;
      eng.executeMove('d7', 'd5');
      eng.executeMove('e2', 'e4');
      eng.executeMove('d5', 'e4');
    });
    await page.waitForTimeout(900);
    const pieceCountAfterCapture = await page.evaluate(
      () => window.__wizardChess.scene.pieceObjects.size
    );
    assert(
      pieceCountAfterCapture === 31,
      `Expected 31 pieces after capture animation, got ${pieceCountAfterCapture}`
    );
    console.log('[v7 Verify] Verified capture animation & 3D board sync (31 pieces)');

    // 3c. Piece Identification Markers ON / OFF toggle & localStorage persistence
    await page.click('#btn-settings');
    await page.waitForTimeout(250);
    const isCheckedInitially = await page.isChecked('#toggle-piece-markers');
    assert(isCheckedInitially === true, 'Expected #toggle-piece-markers checked by default');

    await page.click('#toggle-piece-markers');
    await page.waitForTimeout(200);
    const markersOffState = await page.evaluate(() => {
      let visibleMarkers = 0;
      let visibleBodies = 0;
      window.__wizardChess.scene.piecesGroup.traverse((c) => {
        if (c.isMesh && c.userData?.isRoleMarker && c.visible) visibleMarkers++;
        if (c.isMesh && c.name === 'body' && c.visible) visibleBodies++;
      });
      return {
        saved: window.localStorage.getItem('mochess_piece_markers_v1'),
        visibleMarkers,
        visibleBodies
      };
    });
    assert(markersOffState.saved === 'false', 'Expected localStorage mochess_piece_markers_v1 = false');
    assert(markersOffState.visibleMarkers === 0, 'Expected 0 visible role markers when toggled OFF');
    assert(markersOffState.visibleBodies >= 31, 'Expected physical 3D piece bodies to remain visible when markers OFF');

    // Reload page to verify persistence of OFF state
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__wizardChess?.scene), { timeout: 20000 });
    const persistedOff = await page.evaluate(() => ({
      setting: window.__wizardChess.scene.getSettings().pieceMarkers,
      checkbox: document.getElementById('toggle-piece-markers')?.checked
    }));
    assert(persistedOff.setting === false && persistedOff.checkbox === false, 'Expected OFF marker setting to persist across reload');

    // Toggle markers back ON via Settings UI
    await page.evaluate(() => {
      window.__wizardChess.ui.showMainMenu(false);
      window.__wizardChess.scene.skipOpeningCinematic();
    });
    await page.click('#btn-settings');
    await page.waitForTimeout(200);
    await page.click('#toggle-piece-markers');
    await page.waitForTimeout(200);
    await page.click('#btn-settings-done');
    const markersOnAgain = await page.evaluate(() => ({
      saved: window.localStorage.getItem('mochess_piece_markers_v1'),
      setting: window.__wizardChess.scene.getSettings().pieceMarkers
    }));
    assert(markersOnAgain.saved === 'true' && markersOnAgain.setting === true, 'Expected markers ON after re-enabling');
    console.log('[v7 Verify] Verified Piece Identification Markers ON/OFF toggle & reload persistence');

    // 3d. Low Graphics Mode with Markers Enabled Screenshot (v7_07_low_graphics_markers_on.png)
    await page.evaluate(() => {
      const app = window.__wizardChess;
      app.engine.startNewGame({
        mode: 'local',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty'
      });
      app.scene.skipOpeningCinematic();
      app.scene.updateSettings({ quality: 'low', pieceMarkers: true });
      app.scene.setCameraPreset('gameplay', true, 'w');
    });
    await page.waitForTimeout(750);
    const lowStats = await page.evaluate(() => {
      const s = window.__wizardChess.scene;
      let visibleMarkers = 0;
      s.piecesGroup.traverse((c) => {
        if (c.isMesh && c.userData?.isRoleMarker && c.visible) visibleMarkers++;
      });
      return {
        shadows: s.renderer.shadowMap.enabled,
        env: s.scene.environment,
        visibleMarkers
      };
    });
    assert(lowStats.shadows === false && lowStats.env === null, 'Expected shadows & envMap disabled in Low Graphics Mode');
    assert(lowStats.visibleMarkers === 32, `Expected all 32 piece markers visible in Low Graphics Mode, got ${lowStats.visibleMarkers}`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/v7_07_low_graphics_markers_on.png` });
    console.log('[v7 Verify] Captured v7_07_low_graphics_markers_on.png');

    // 3e. Checkmate Finisher Cutscene E2E verification (Fool's Mate: 1. f3 e5 2. g4 Qh4#)
    await page.evaluate(() => {
      const app = window.__wizardChess;
      app.scene.updateSettings({ quality: 'high', reducedMotion: true, pieceMarkers: true });
      app.engine.startNewGame({ mode: 'local', playerColor: 'w', mapId: 'cathedral', skinId: 'arcane_royalty' });
      app.scene.skipOpeningCinematic();
      app.engine.executeMove('f2', 'f3');
      app.engine.executeMove('e7', 'e5');
      app.engine.executeMove('g2', 'g4');
      app.engine.executeMove('d8', 'h4');
    });
    await page.waitForFunction(
      () => !document.getElementById('gameover-modal')?.classList.contains('hidden'),
      { timeout: 8000 }
    );
    console.log('[v7 Verify] Verified Checkmate Finisher Cutscene & Result Modal');

    await desktopCtx.close();

    // =========================================================================
    // 4. MOBILE PORTRAIT (390x844) & MOBILE LANDSCAPE (844x390) VERIFICATION
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
        mode: 'local',
        playerColor: 'w',
        mapId: 'cathedral',
        skinId: 'arcane_royalty'
      });
      app.scene.skipOpeningCinematic();
      app.scene.updateSettings({ quality: 'medium', pieceMarkers: true });
      app.scene.setCameraPreset('gameplay', true, 'w');
      // Select White Knight on g1 so legal move markers are also showcased on mobile!
      app.engine.selectSquare('g1');
    });
    await mPage.waitForTimeout(750);

    // Verify all 4 outer board corners fit inside 390px portrait width without clipping
    const portraitCorners = await mPage.evaluate(() => {
      const s = window.__wizardChess.scene;
      const rect = s.renderer.domElement.getBoundingClientRect();
      return ['a1', 'h1', 'a8', 'h8'].map((sq) => {
        const pos = s.chessboard.tileMeshes.get(sq).position.clone();
        pos.project(s.camera);
        return {
          sq,
          x: rect.left + ((pos.x + 1) / 2) * rect.width,
          y: rect.top + ((-pos.y + 1) / 2) * rect.height
        };
      });
    });
    for (const c of portraitCorners) {
      assert(
        c.x >= 8 && c.x <= 382 && c.y >= 60 && c.y <= 785,
        `Portrait corner ${c.sq} out of safe bounds: (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`
      );
    }
    await mPage.screenshot({ path: `${ARTIFACT_DIR}/v7_06_mobile_portrait_markers_on.png` });
    console.log('[v7 Verify] Captured v7_06_mobile_portrait_markers_on.png & verified 64-square framing');

    // Mobile Landscape (844x390) framing check
    await mPage.setViewportSize({ width: 844, height: 390 });
    await mPage.evaluate(() => window.__wizardChess.scene.handleResize());
    await mPage.waitForTimeout(450);
    const landscapeCorners = await mPage.evaluate(() => {
      const s = window.__wizardChess.scene;
      const rect = s.renderer.domElement.getBoundingClientRect();
      return ['a1', 'h1', 'a8', 'h8'].map((sq) => {
        const pos = s.chessboard.tileMeshes.get(sq).position.clone();
        pos.project(s.camera);
        return {
          sq,
          x: rect.left + ((pos.x + 1) / 2) * rect.width,
          y: rect.top + ((-pos.y + 1) / 2) * rect.height
        };
      });
    });
    for (const c of landscapeCorners) {
      assert(
        c.x >= 10 && c.x <= 834 && c.y >= 10 && c.y <= 385,
        `Landscape corner ${c.sq} out of bounds: (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`
      );
    }
    console.log('[v7 Verify] Verified Mobile Landscape (844x390) framing');

    await mobileCtx.close();

    assert(pageErrors.length === 0, `Unexpected page errors: ${pageErrors.join(' | ')}`);
    console.log('\n[v7 Verify] ALL OVERHEAD READABILITY, SCREENSHOT, AND E2E CHECKS SUCCEEDED!');
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
    console.error('[v7 Verify] FAILED:', err);
    process.exit(1);
  });
