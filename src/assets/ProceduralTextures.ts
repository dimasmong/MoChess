import * as THREE from 'three';
import type { MapId } from '../engine/types';

export type QualityTier = 'low' | 'medium' | 'high';

export function getAdaptiveTextureSize(tier: QualityTier, isMobile: boolean): number {
  if (tier === 'low') return 512;
  if (tier === 'medium' || isMobile) return 1024;
  return 2048;
}

function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash2D(xi, yi);
  const b = hash2D(xi + 1, yi);
  const c = hash2D(xi, yi + 1);
  const d = hash2D(xi + 1, yi + 1);

  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return value;
}

function makeFallbackTexture(r = 64, g = 64, b = 64): THREE.DataTexture {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates seamless PBR marble color + satin-matte roughness textures for pieces and board tiles,
 * customized per MapId so each map has a distinct board and piece feel without harsh glare.
 */
export function createMarbleTextures(
  variant: 'white' | 'black',
  resolution = 256,
  mapId: MapId = 'cathedral'
): { map: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  const size = Math.min(512, Math.max(128, resolution));
  const colorData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 4.5;
      const ny = (y / size) * 4.5;
      const n = fbm(nx, ny, 4);
      const vein = Math.pow(Math.abs(Math.sin((nx + ny * 0.7 + n * 2.5) * Math.PI)), 0.42);
      const idx = (y * size + x) * 4;

      if (variant === 'white') {
        let rBase = 222;
        let gBase = 214;
        let bBase = 200;
        if (mapId === 'warhall') {
          // Warm champagne travertine stone
          rBase = 216;
          gBase = 198;
          bBase = 172;
        } else if (mapId === 'sanctum') {
          // Cool silver-moonlight alabaster
          rBase = 210;
          gBase = 220;
          bBase = 236;
        }
        const delta = Math.round((vein - 0.5) * 22);
        colorData[idx] = Math.min(248, Math.max(155, rBase + delta));
        colorData[idx + 1] = Math.min(245, Math.max(150, gBase + delta));
        colorData[idx + 2] = Math.min(248, Math.max(140, bBase + delta));
        colorData[idx + 3] = 255;

        // Higher satin roughness (105..150 out of 255 -> ~0.45..0.58) to eliminate harsh reflections
        const rough = Math.round(108 + (1 - vein) * 42);
        roughData[idx] = rough;
        roughData[idx + 1] = rough;
        roughData[idx + 2] = rough;
        roughData[idx + 3] = 255;
      } else {
        const vFactor = 1.0 - vein;
        let rBase = 20;
        let gBase = 22;
        let bBase = 28;
        if (mapId === 'warhall') {
          // Deep charred bronze-basalt
          rBase = 28;
          gBase = 22;
          bBase = 20;
        } else if (mapId === 'sanctum') {
          // Deep void-indigo obsidian
          rBase = 18;
          gBase = 20;
          bBase = 36;
        }
        colorData[idx] = Math.min(68, Math.max(10, rBase + Math.round(vFactor * 20 + n * 6)));
        colorData[idx + 1] = Math.min(70, Math.max(10, gBase + Math.round(vFactor * 20 + n * 6)));
        colorData[idx + 2] = Math.min(86, Math.max(14, bBase + Math.round(vFactor * 26 + n * 8)));
        colorData[idx + 3] = 255;

        const rough = Math.round(112 + vFactor * 44);
        roughData[idx] = rough;
        roughData[idx + 1] = rough;
        roughData[idx + 2] = rough;
        roughData[idx + 3] = 255;
      }
    }
  }

  const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.needsUpdate = true;

  return { map, roughnessMap };
}

/**
 * Generates a realistic multi-tongued stylized fire flame sprite texture (not a solid geometric blob!).
 */
export function createFlameSpriteTexture(variant: 'warm' | 'arcane' = 'warm'): THREE.Texture {
  const size = 256;
  if (typeof document === 'undefined') {
    return makeFallbackTexture(255, 140, 30);
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return makeFallbackTexture(255, 140, 30);

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let y = 0; y < size; y++) {
    // v = 0 at bottom (base of flame), v = 1 at top (tip of flame)
    const v = 1.0 - y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = (x / (size - 1)) * 2.0 - 1.0; // -1..+1

      // Teardrop width envelope that narrows toward the top and pinches at the bottom base
      const widthEnv = Math.sin(Math.pow(v, 0.62) * Math.PI) * (1.0 - v * 0.42);
      // Organic turbulent flame tongue displacement
      const turb =
        (fbm(u * 3.5 + 4.1, v * 5.2, 4) - 0.5) * (0.35 + v * 0.65) +
        Math.sin(v * 14.0 + u * 5.0) * 0.08 * v;

      const dist = Math.abs(u + turb * 0.45) / Math.max(0.05, widthEnv * 0.78);
      const verticalFade = Math.sin(Math.min(1, Math.max(0, v)) * Math.PI);
      const rawIntensity = Math.max(0, (1.0 - dist * dist) * verticalFade);
      // Sharpen flame licks
      const intensity = Math.pow(rawIntensity, 1.35);

      const idx = (y * size + x) * 4;
      if (intensity <= 0.01) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }

      if (variant === 'warm') {
        // Real fire color gradient: white-hot core -> bright yellow -> deep orange -> crimson tip
        const r = Math.min(255, Math.round(intensity * 420));
        const g = Math.min(255, Math.round(Math.pow(intensity, 1.85) * 310));
        const b = Math.min(255, Math.round(Math.pow(intensity, 3.6) * 240));
        const a = Math.min(255, Math.round(Math.pow(intensity, 0.85) * 255));
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      } else {
        // Arcane Sanctum mystic cyan-violet flame gradient
        const r = Math.min(255, Math.round(Math.pow(intensity, 1.7) * 240 + (1 - intensity) * 110));
        const g = Math.min(255, Math.round(Math.pow(intensity, 1.2) * 255));
        const b = Math.min(255, Math.round(intensity * 420));
        const a = Math.min(255, Math.round(Math.pow(intensity, 0.85) * 255));
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates the 2K Board Outer Frame Texture customized per MapId:
 * - `cathedral`: Veined jet-black marble with golden Elder Futhark runes
 * - `warhall`: Crimson-porphyry & dark bronze war table with imperial gold chevrons/runes
 * - `sanctum`: Deep astral obsidian with glowing cyan & violet arcane runes
 */
export function createRuneBoardFrameTexture(size = 1024, mapId: MapId = 'cathedral'): THREE.Texture {
  if (typeof document === 'undefined') {
    return makeFallbackTexture(18, 18, 22);
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return makeFallbackTexture(18, 18, 22);

  // 1. Base stone color per map
  if (mapId === 'warhall') {
    ctx.fillStyle = '#1c1110';
  } else if (mapId === 'sanctum') {
    ctx.fillStyle = '#090c1a';
  } else {
    ctx.fillStyle = '#0b0d12';
  }
  ctx.fillRect(0, 0, size, size);

  // 2. Veins across the outer slab
  ctx.strokeStyle =
    mapId === 'warhall'
      ? 'rgba(218, 155, 72, 0.35)'
      : mapId === 'sanctum'
        ? 'rgba(72, 210, 255, 0.42)'
        : 'rgba(220, 226, 238, 0.42)';
  ctx.lineCap = 'round';
  const veinCount = 44;
  for (let v = 0; v < veinCount; v++) {
    let vx = hash2D(v, 1.1) * size;
    let vy = hash2D(v, 2.3) * size;
    let angle = (hash2D(v, 3.7) - 0.5) * 1.4 + Math.PI * 0.5;
    ctx.lineWidth = (0.8 + hash2D(v, 4.9) * 1.6) * (size / 1024);
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    for (let s = 0; s < 18; s++) {
      angle += (hash2D(v * 17 + s, s * 3.1) - 0.5) * 0.85;
      vx += Math.cos(angle) * (size * 0.028);
      vy += Math.sin(angle) * (size * 0.028);
      ctx.lineTo(vx, vy);
    }
    ctx.stroke();
  }

  // 3. Double Border Framing the Rune Band
  const outerPad = size * 0.052;
  const innerPad = size * 0.132;
  const runeColor = mapId === 'sanctum' ? '#58e2ff' : mapId === 'warhall' ? '#e8a844' : '#d8a238';

  ctx.strokeStyle = runeColor;
  ctx.lineWidth = Math.max(2, size * 0.0038);
  ctx.strokeRect(outerPad, outerPad, size - outerPad * 2, size - outerPad * 2);
  ctx.strokeRect(
    outerPad + size * 0.008,
    outerPad + size * 0.008,
    size - (outerPad + size * 0.008) * 2,
    size - (outerPad + size * 0.008) * 2
  );

  ctx.strokeRect(innerPad, innerPad, size - innerPad * 2, size - innerPad * 2);
  ctx.strokeRect(
    innerPad - size * 0.008,
    innerPad - size * 0.008,
    size - (innerPad - size * 0.008) * 2,
    size - (innerPad - size * 0.008) * 2
  );

  const bandCenter = (outerPad + innerPad) * 0.5;
  const runeHeight = (innerPad - outerPad) * 0.54;

  const drawCornerStar = (cx: number, cy: number, r: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = runeColor;
    ctx.lineWidth = Math.max(2, size * 0.0032);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * -r, Math.sin(a) * -r);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.restore();
  };

  drawCornerStar(bandCenter, bandCenter, runeHeight * 0.55);
  drawCornerStar(size - bandCenter, bandCenter, runeHeight * 0.55);
  drawCornerStar(bandCenter, size - bandCenter, runeHeight * 0.55);
  drawCornerStar(size - bandCenter, size - bandCenter, runeHeight * 0.55);

  const drawRuneGlyph = (cx: number, cy: number, rotation: number, glyphIndex: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.strokeStyle = runeColor;
    ctx.lineWidth = Math.max(1.8, size * 0.0028);
    const h = runeHeight * 0.46;
    const w = runeHeight * 0.28;

    ctx.beginPath();
    switch (glyphIndex % 8) {
      case 0:
        ctx.moveTo(-w, h);
        ctx.lineTo(w, -h * 0.2);
        ctx.lineTo(0, -h);
        ctx.lineTo(-w, -h * 0.2);
        ctx.lineTo(w, h);
        break;
      case 1:
        ctx.moveTo(0, -h);
        ctx.lineTo(0, h);
        ctx.moveTo(-w, -h * 0.85);
        ctx.lineTo(0, -h * 0.15);
        ctx.lineTo(w, -h * 0.85);
        break;
      case 2:
        ctx.moveTo(-w, -h);
        ctx.lineTo(w, h);
        ctx.moveTo(w, -h);
        ctx.lineTo(-w, h);
        break;
      case 3:
        ctx.moveTo(-w, -h);
        ctx.lineTo(-w, h);
        ctx.lineTo(w, -h);
        ctx.lineTo(w, h);
        ctx.closePath();
        break;
      case 4:
        ctx.moveTo(-w * 0.8, -h);
        ctx.lineTo(-w * 0.8, h);
        ctx.moveTo(-w * 0.8, -h);
        ctx.lineTo(w * 0.8, -h * 0.35);
        ctx.lineTo(-w * 0.8, h * 0.1);
        ctx.lineTo(w * 0.8, h);
        break;
      case 5:
        ctx.moveTo(0, -h);
        ctx.lineTo(0, h);
        ctx.moveTo(-w, -h * 0.35);
        ctx.lineTo(0, -h);
        ctx.lineTo(w, -h * 0.35);
        break;
      case 6:
        ctx.moveTo(-w * 0.7, h);
        ctx.lineTo(-w * 0.7, -h);
        ctx.lineTo(w * 0.9, -h * 0.85);
        ctx.lineTo(-w * 0.7, -h * 0.15);
        ctx.lineTo(w * 0.8, -h * 0.5);
        break;
      case 7:
        ctx.moveTo(-w, h);
        ctx.lineTo(-w, -h);
        ctx.lineTo(w, h * 0.1);
        ctx.lineTo(w, h);
        ctx.lineTo(w, -h);
        ctx.lineTo(-w, h * 0.1);
        break;
    }
    ctx.stroke();
    ctx.restore();
  };

  const runesPerSide = 16;
  const startOffset = innerPad + runeHeight * 0.45;
  const endOffset = size - startOffset;
  for (let i = 0; i < runesPerSide; i++) {
    const t = startOffset + ((endOffset - startOffset) * (i + 0.5)) / runesPerSide;
    drawRuneGlyph(t, bandCenter, 0, i);
    drawRuneGlyph(t, size - bandCenter, 0, i + 3);
    drawRuneGlyph(bandCenter, t, -Math.PI / 2, i + 1);
    drawRuneGlyph(size - bandCenter, t, Math.PI / 2, i + 5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates darker, atmospheric weathered masonry wall & column textures customized per MapId.
 */
export function createMasonryWallTexture(
  size = 1024,
  mapId: MapId = 'cathedral'
): { map: THREE.Texture; bumpMap: THREE.Texture } {
  if (typeof document === 'undefined') {
    const fb = makeFallbackTexture(75, 62, 50);
    return { map: fb, bumpMap: fb };
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d');

  if (!ctx || !bumpCtx) {
    const fb = makeFallbackTexture(75, 62, 50);
    return { map: fb, bumpMap: fb };
  }

  ctx.fillStyle = mapId === 'sanctum' ? '#080b16' : '#18130f';
  ctx.fillRect(0, 0, size, size);
  bumpCtx.fillStyle = '#202020';
  bumpCtx.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 4;
  const rowH = size / rows;
  const colW = size / cols;
  const mortar = Math.max(2, size * 0.0055);

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const bx = c * colW + offset;
      const by = r * rowH;
      const shade = (hash2D(c + 10, r + 20) - 0.5) * 22;

      let baseR = 88 + shade;
      let baseG = 72 + shade * 0.85;
      let baseB = 58 + shade * 0.75;

      if (mapId === 'warhall') {
        // Dark fortress iron-granite blocks
        baseR = 66 + shade * 0.8;
        baseG = 62 + shade * 0.8;
        baseB = 68 + shade * 0.85;
      } else if (mapId === 'sanctum') {
        // Deep astral obsidian-slate blocks
        baseR = 34 + shade * 0.6;
        baseG = 40 + shade * 0.7;
        baseB = 64 + shade * 0.9;
      }

      ctx.fillStyle = `rgb(${Math.round(baseR)}, ${Math.round(baseG)}, ${Math.round(baseB)})`;
      ctx.fillRect(bx + mortar, by + mortar, colW - mortar * 2, rowH - mortar * 2);

      // Subtle weathered stone grain
      ctx.strokeStyle =
        mapId === 'sanctum'
          ? 'rgba(88, 210, 255, 0.12)'
          : 'rgba(220, 185, 140, 0.10)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + mortar + 1, by + mortar + 1, colW - mortar * 2 - 2, rowH - mortar * 2 - 2);

      const bumpVal = Math.min(245, Math.max(40, Math.round(165 + shade * 1.5)));
      bumpCtx.fillStyle = `rgb(${bumpVal}, ${bumpVal}, ${bumpVal})`;
      bumpCtx.fillRect(bx + mortar, by + mortar, colW - mortar * 2, rowH - mortar * 2);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.needsUpdate = true;

  return { map, bumpMap };
}

/**
 * Generates dark atmospheric stone floor pavers customized per MapId.
 */
export function createStoneFloorTexture(size = 1024, mapId: MapId = 'cathedral'): THREE.Texture {
  if (typeof document === 'undefined') {
    return makeFallbackTexture(52, 42, 34);
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return makeFallbackTexture(52, 42, 34);

  ctx.fillStyle = mapId === 'sanctum' ? '#070912' : '#14100c';
  ctx.fillRect(0, 0, size, size);

  const rows = 4;
  const cols = 4;
  const rowH = size / rows;
  const colW = size / cols;
  const gap = Math.max(2, size * 0.007);

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const bx = c * colW + offset;
      const by = r * rowH;
      const v = (hash2D(c * 3 + 7, r * 5 + 11) - 0.5) * 14;

      let cr = Math.round(62 + v);
      let cg = Math.round(50 + v * 0.85);
      let cb = Math.round(40 + v * 0.75);

      if (mapId === 'warhall') {
        cr = Math.round(52 + v);
        cg = Math.round(46 + v);
        cb = Math.round(48 + v);
      } else if (mapId === 'sanctum') {
        cr = Math.round(24 + v * 0.6);
        cg = Math.round(28 + v * 0.7);
        cb = Math.round(46 + v * 0.9);
      }

      ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
      ctx.fillRect(bx + gap, by + gap, colW - gap * 2, rowH - gap * 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates an arcane sigil radial texture for board square selection, legal moves, and check warnings.
 */
export function createArcaneSigilTexture(kind: 'quiet' | 'capture' | 'selected' | 'check'): THREE.Texture {
  const size = 256;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);

      const primaryColor =
        kind === 'capture'
          ? '#ff4455'
          : kind === 'check'
            ? '#ff2222'
            : kind === 'selected'
              ? '#ffd15c'
              : '#44d5ff';

      const grad = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.48);
      if (kind === 'quiet') {
        grad.addColorStop(0, 'rgba(68, 213, 255, 0.88)');
        grad.addColorStop(0.28, 'rgba(68, 213, 255, 0.38)');
        grad.addColorStop(0.65, 'rgba(68, 213, 255, 0.10)');
        grad.addColorStop(1, 'rgba(68, 213, 255, 0.0)');
      } else if (kind === 'capture') {
        grad.addColorStop(0, 'rgba(255, 68, 85, 0.18)');
        grad.addColorStop(0.68, 'rgba(255, 68, 85, 0.65)');
        grad.addColorStop(0.92, 'rgba(255, 190, 90, 0.90)');
        grad.addColorStop(1, 'rgba(255, 68, 85, 0.0)');
      } else if (kind === 'check') {
        grad.addColorStop(0, 'rgba(255, 30, 30, 0.85)');
        grad.addColorStop(0.55, 'rgba(255, 50, 20, 0.50)');
        grad.addColorStop(1, 'rgba(255, 0, 0, 0.0)');
      } else {
        grad.addColorStop(0, 'rgba(255, 209, 92, 0.28)');
        grad.addColorStop(0.75, 'rgba(255, 209, 92, 0.72)');
        grad.addColorStop(1, 'rgba(255, 209, 92, 0.0)');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = kind === 'quiet' ? 3 : 4;
      ctx.beginPath();
      ctx.arc(cx, cy, size * (kind === 'quiet' ? 0.22 : 0.41), 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
      ctx.stroke();

      const points = 8;
      const rInner = size * (kind === 'quiet' ? 0.14 : 0.31);
      const rOuter = size * (kind === 'quiet' ? 0.36 : 0.45);
      for (let i = 0; i < points; i++) {
        const angle = (i * Math.PI * 2) / points;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
        ctx.lineTo(cx + Math.cos(angle) * rOuter, cy + Math.sin(angle) * rOuter);
        ctx.stroke();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    }
  }

  return makeFallbackTexture(100, 200, 255);
}

/**
 * Creates a sprite label texture for algebraic board coordinates (A-H, 1-8).
 */
export function createCoordinateLabelTexture(label: string): THREE.Texture {
  const size = 128;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, size, size);
      ctx.font = 'bold 64px "Cinzel", "Georgia", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e5c168';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 6;
      ctx.fillText(label.toUpperCase(), size / 2, size / 2);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    }
  }

  return makeFallbackTexture(220, 185, 90);
}
