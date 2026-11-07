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

const PORT = 4185;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const MAPS_DIR = path.resolve('public/previews/maps');
const SKINS_DIR = path.resolve('public/previews/skins');

fs.mkdirSync(MAPS_DIR, { recursive: true });
fs.mkdirSync(SKINS_DIR, { recursive: true });

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

async function main() {
  console.log('[3D Previews] Starting Vite preview server on port', PORT);
  const server = await startVitePreview();

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page.waitForFunction(
      () => {
        const app = window.__wizardChess;
        return Boolean(app && app.scene && app.engine);
      },
      { timeout: 20000 }
    );
    await page.waitForTimeout(1200);

    const maps = ['cathedral', 'warhall', 'sanctum', 'classic'];
    for (const mapId of maps) {
      const dataUrl = await page.evaluate((m) => {
        return window.__wizardChess.scene.renderMapPreviewDataUrl(m, 960, 540);
      }, mapId);
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const outPath = path.join(MAPS_DIR, `map_${mapId}.png`);
      fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
      const stat = fs.statSync(outPath);
      console.log(`[3D Previews] Generated ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    }

    const skins = ['arcane_royalty', 'runic_warforged', 'mystic_sanctum', 'classic'];
    for (const skinId of skins) {
      const dataUrl = await page.evaluate((s) => {
        return window.__wizardChess.scene.renderSkinPreviewDataUrl(s, 960, 540);
      }, skinId);
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const outPath = path.join(SKINS_DIR, `skin_${skinId}.png`);
      fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
      const stat = fs.statSync(outPath);
      console.log(`[3D Previews] Generated ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    }

    console.log('[3D Previews] All 8 real 3D preview images generated successfully!');
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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[3D Previews] Fatal error:', err);
    process.exit(1);
  });
