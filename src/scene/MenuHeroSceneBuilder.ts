import * as THREE from 'three';
import { getPieceGeometryParts } from '../assets/PieceGeometryBuilder';
import {
  createArcaneSigilTexture,
  createFlameSpriteTexture,
  type QualityTier
} from '../assets/ProceduralTextures';

export interface MenuHeroSceneElements {
  group: THREE.Group;
  heroPieceGroup: THREE.Group;
  chestCrystal: THREE.Mesh;
  runeRibbon1: THREE.Group;
  runeRibbon2: THREE.Group;
  floorSigil: THREE.Mesh;
  banners: THREE.Mesh[];
  braziers: Array<{
    light: THREE.PointLight | null;
    flameLayers: THREE.Mesh[];
    coreGlow: THREE.Mesh;
    baseIntensity: number;
    phase: number;
  }>;
  godRays: THREE.Mesh[];
  embers: THREE.Points | null;
  update: (elapsed: number, delta: number, reducedMotion: boolean) => void;
  setQuality: (quality: QualityTier) => void;
}

/**
 * Creates a radial golden rune-ribbon texture for the orbiting halos around the Main Menu Hero King.
 */
function createOrbitingRuneRibbonTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array(16 * 16 * 4);
    const tex = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
  const width = 1024;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  ctx.clearRect(0, 0, width, height);

  // Soft golden ribbon glow along center
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0.0, 'rgba(255, 195, 70, 0.0)');
  grad.addColorStop(0.28, 'rgba(255, 195, 70, 0.25)');
  grad.addColorStop(0.5, 'rgba(255, 232, 145, 0.88)');
  grad.addColorStop(0.72, 'rgba(255, 195, 70, 0.25)');
  grad.addColorStop(1.0, 'rgba(255, 195, 70, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Crisp glowing Elder Futhark rune glyphs along the ribbon
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = 3.2;
  ctx.shadowColor = '#ffaa22';
  ctx.shadowBlur = 12;

  const runeCount = 24;
  const step = width / runeCount;
  for (let i = 0; i < runeCount; i++) {
    const cx = (i + 0.5) * step;
    const cy = height * 0.5;
    const h = height * 0.26;
    const w = step * 0.24;

    ctx.beginPath();
    switch (i % 6) {
      case 0:
        ctx.moveTo(cx - w, cy + h);
        ctx.lineTo(cx + w, cy - h);
        ctx.moveTo(cx - w, cy - h);
        ctx.lineTo(cx + w, cy + h);
        break;
      case 1:
        ctx.moveTo(cx, cy - h);
        ctx.lineTo(cx, cy + h);
        ctx.moveTo(cx - w, cy - h * 0.4);
        ctx.lineTo(cx, cy - h);
        ctx.lineTo(cx + w, cy - h * 0.4);
        break;
      case 2:
        ctx.moveTo(cx - w, cy - h);
        ctx.lineTo(cx - w, cy + h);
        ctx.moveTo(cx - w, cy - h);
        ctx.lineTo(cx + w, cy - h * 0.2);
        ctx.lineTo(cx - w, cy + h * 0.2);
        break;
      case 3:
        ctx.moveTo(cx, cy - h);
        ctx.lineTo(cx + w, cy);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx - w, cy);
        ctx.closePath();
        break;
      case 4:
        ctx.moveTo(cx - w, cy - h);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx + w, cy - h);
        break;
      case 5:
        ctx.moveTo(cx - w, cy - h);
        ctx.lineTo(cx - w, cy + h);
        ctx.lineTo(cx + w, cy - h);
        ctx.lineTo(cx + w, cy + h);
        break;
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds the dedicated, non-gameplay 3D Main Menu Presentation Scene:
 * - Monumental Hero King Piece on a stepped octagonal arcane altar pedestal (offset to the right so left-side menu UI is unobstructed)
 * - Glowing amethyst chest crystal + counter-rotating golden rune ribbons
 * - Flanking Gothic stone pillars with roaring fire braziers
 * - Swaying crimson-and-gold royal banners
 * - Moonlit Gothic cathedral arch & distant citadel silhouette with volumetric light shafts and drifting embers
 */
export function buildMenuHeroScene(
  quality: QualityTier = 'high',
  isMobile = false
): MenuHeroSceneElements {
  const group = new THREE.Group();
  group.name = 'DedicatedMainMenuHeroScene';
  group.visible = false;

  const isLow = quality === 'low';
  const heroCenterX = 1.18;
  const heroCenterZ = 0.0;

  // 1. Dark Sanctuary Flagstone Floor
  const floorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#100d14'),
    roughness: 0.65,
    metalness: 0.14
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(38, 38), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = !isLow;
  group.add(floor);

  // 2. Stepped Octagonal Altar Pedestal under the Hero King
  const pedestalStoneMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1a1622'),
    roughness: 0.48,
    metalness: 0.22
  });
  const royalGoldMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f0b63a'),
    roughness: isLow ? 0.42 : 0.22,
    metalness: isLow ? 0.65 : 0.92
  });
  const darkObsidianMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#13111c'),
    roughness: isLow ? 0.68 : 0.24,
    metalness: isLow ? 0.12 : 0.28,
    clearcoat: isLow ? 0 : 0.38
  });

  const pedestalGroup = new THREE.Group();
  pedestalGroup.position.set(heroCenterX, 0, heroCenterZ);
  group.add(pedestalGroup);

  const steps: Array<[number, number, number, number]> = [
    [1.95, 2.10, 0.18, 0.09],
    [1.58, 1.70, 0.20, 0.28],
    [1.24, 1.34, 0.22, 0.49]
  ];
  for (const [rTop, rBot, h, y] of steps) {
    const stepMesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 8), pedestalStoneMat);
    stepMesh.position.y = y;
    stepMesh.castShadow = !isLow;
    stepMesh.receiveShadow = !isLow;
    pedestalGroup.add(stepMesh);

    const trimRing = new THREE.Mesh(new THREE.TorusGeometry(rTop, 0.024, 8, 8), royalGoldMat);
    trimRing.rotation.x = Math.PI / 2;
    trimRing.rotation.z = Math.PI / 8;
    trimRing.position.y = y + h * 0.5;
    pedestalGroup.add(trimRing);
  }

  // Glowing Golden Arcane Sigil Circle on the Floor around the Pedestal
  const sigilTex = createArcaneSigilTexture('selected');
  const floorSigilMat = new THREE.MeshBasicMaterial({
    map: sigilTex,
    color: new THREE.Color('#ffbe44'),
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const floorSigil = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), floorSigilMat);
  floorSigil.rotation.x = -Math.PI / 2;
  floorSigil.position.set(heroCenterX, 0.01, heroCenterZ);
  group.add(floorSigil);

  // 3. Monumental Sculpted Hero King Piece on the Pedestal
  const heroPieceGroup = new THREE.Group();
  heroPieceGroup.position.set(heroCenterX, 0.60, heroCenterZ);
  const heroScale = 1.72;
  heroPieceGroup.scale.setScalar(heroScale);
  group.add(heroPieceGroup);

  const kingParts = getPieceGeometryParts('k', isLow ? 'low' : 'high', 'Classic' in {} ? 'classic' : 'classic');
  const bodyMesh = new THREE.Mesh(kingParts.body, darkObsidianMat);
  const goldMesh = new THREE.Mesh(kingParts.gold, royalGoldMat);
  bodyMesh.castShadow = !isLow;
  goldMesh.castShadow = !isLow;
  heroPieceGroup.add(bodyMesh, goldMesh);

  // Ornate Sculpted Golden Crown Spikes & Filigree Collar on the Hero King
  const crownPoints = 8;
  for (let i = 0; i < crownPoints; i++) {
    const a = (i * Math.PI * 2) / crownPoints;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.18, 4), royalGoldMat);
    spike.position.set(Math.sin(a) * 0.21, 1.54, Math.cos(a) * 0.21);
    spike.rotation.y = a;
    heroPieceGroup.add(spike);
  }

  // Glowing Amethyst Core Diamond embedded in the Hero King's chest (matching Reference Image 1!)
  const crystalMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#c855ff')
  });
  const chestCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), crystalMat);
  chestCrystal.scale.set(0.85, 1.65, 0.72);
  chestCrystal.position.set(0, 0.78, 0.19);
  heroPieceGroup.add(chestCrystal);

  const crystalFrame = new THREE.Mesh(new THREE.OctahedronGeometry(0.115, 0), royalGoldMat);
  crystalFrame.scale.set(1.04, 1.82, 0.36);
  crystalFrame.position.set(0, 0.78, 0.16);
  heroPieceGroup.add(crystalFrame);

  // 4. Two Counter-Rotating Orbiting Golden Rune Ribbons around the Hero King
  const ribbonTex = createOrbitingRuneRibbonTexture();
  const ribbonMat = new THREE.MeshBasicMaterial({
    map: ribbonTex,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const makeRibbonGroup = (radius: number, height: number, tiltX: number, tiltZ: number) => {
    const g = new THREE.Group();
    g.position.set(heroCenterX, 1.85, heroCenterZ);
    g.rotation.set(tiltX, 0, tiltZ);
    const cylGeo = new THREE.CylinderGeometry(radius, radius, height, 48, 1, true);
    const mesh = new THREE.Mesh(cylGeo, ribbonMat);
    g.add(mesh);
    group.add(g);
    return g;
  };

  const runeRibbon1 = makeRibbonGroup(1.38, 0.22, 0.36, -0.28);
  const runeRibbon2 = makeRibbonGroup(1.62, 0.18, -0.32, 0.24);

  // 5. Flanking Gothic Columns, Roaring Fire Braziers, and Swaying Royal Banners
  const columnMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1d1826'),
    roughness: 0.78,
    metalness: 0.10
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6b1322'),
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide
  });

  const banners: THREE.Mesh[] = [];
  const columnPositions: Array<[number, number]> = [
    [-2.4, -3.2],
    [3.8, -3.2],
    [-3.8, -6.5],
    [0.2, -6.5],
    [4.6, -6.5]
  ];
  for (const [cx, cz] of columnPositions) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 9.5, 12), columnMat);
    col.position.set(cx, 4.75, cz);
    group.add(col);

    // Royal Crimson & Gold Banner hanging on front columns
    if (cz > -4.0) {
      const bannerGeo = new THREE.PlaneGeometry(0.95, 2.85, 4, 8);
      const banner = new THREE.Mesh(bannerGeo, bannerMat);
      banner.position.set(cx, 4.6, cz + 0.52);
      banner.userData.baseX = cx;
      banner.userData.phase = cx * 0.7;

      // Golden border bar & King crest silhouette on banner
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.06, 0.06), royalGoldMat);
      topBar.position.set(0, 1.42, 0);
      banner.add(topBar);

      const crest = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.55, 6), royalGoldMat);
      crest.position.set(0, 0.1, 0.02);
      banner.add(crest);

      group.add(banner);
      banners.push(banner);
    }
  }

  // Flanking Fire Braziers
  const flameTex = createFlameSpriteTexture('warm');
  const flameMat = new THREE.MeshBasicMaterial({
    map: flameTex,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const coreGlowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffaa33'),
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const braziers: MenuHeroSceneElements['braziers'] = [];
  const brazierCoords: Array<[number, number]> = [
    [-0.95, -1.85],
    [3.15, -1.65]
  ];
  brazierCoords.forEach(([bx, bz], bIdx) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(bx, 0, bz);
    group.add(bGroup);

    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.25, 8), pedestalStoneMat);
    ped.position.y = 0.625;
    bGroup.add(ped);

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.24, 0.28, 10), royalGoldMat);
    bowl.position.y = 1.32;
    bGroup.add(bowl);

    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), coreGlowMat);
    coreGlow.position.y = 1.52;
    bGroup.add(coreGlow);

    const flameLayers: THREE.Mesh[] = [];
    const layerCount = isLow ? 2 : 5;
    for (let l = 0; l < layerCount; l++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.92), flameMat);
      plane.position.y = 1.72 + l * 0.03;
      plane.rotation.y = (l * Math.PI) / layerCount;
      bGroup.add(plane);
      flameLayers.push(plane);
    }

    let light: THREE.PointLight | null = null;
    if (!isLow) {
      light = new THREE.PointLight('#ff9436', 3.4, 9.5, 1.6);
      light.position.set(bx, 2.1, bz);
      group.add(light);
    }

    braziers.push({
      light,
      flameLayers,
      coreGlow,
      baseIntensity: 3.4,
      phase: bIdx * 2.1
    });
  });

  // 6. Moonlit Gothic Arch & Distant Castle Silhouette Backdrop + Volumetric God-Rays
  const moonMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#e8ecff')
  });
  const moonMesh = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), moonMat);
  moonMesh.position.set(3.4, 5.2, -9.2);
  group.add(moonMesh);

  const moonHaloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#8a68ff'),
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const moonHalo = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), moonHaloMat);
  moonHalo.position.set(3.4, 5.2, -9.25);
  group.add(moonHalo);

  // Distant Castle Spires Silhouette against the Moon
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#090710') });
  const spireSpecs: Array<[number, number, number, number]> = [
    [3.1, 2.2, 0.55, 2.8],
    [3.45, 2.7, 0.38, 3.8],
    [3.8, 2.1, 0.45, 2.5],
    [2.7, 1.8, 0.42, 2.0]
  ];
  for (const [sx, sy, sw, sh] of spireSpecs) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.2), silhouetteMat);
    tower.position.set(sx, sy, -8.8);
    group.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(sw * 0.78, sh * 0.45, 4), silhouetteMat);
    roof.position.set(sx, sy + sh * 0.5 + sh * 0.2, -8.8);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
  }

  // Volumetric God-Ray Shafts slanting down onto the Hero King
  const rayMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#9e7cff'),
    transparent: true,
    opacity: isLow ? 0.0 : 0.09,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const godRays: THREE.Mesh[] = [];
  for (let r = 0; r < 3; r++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + r * 0.35, 9.5), rayMat);
    ray.position.set(heroCenterX + 0.6 + (r - 1) * 0.65, 3.8, -1.8);
    ray.rotation.z = -0.32;
    ray.rotation.y = (r - 1) * 0.22;
    group.add(ray);
    godRays.push(ray);
  }

  // Dedicated Dramatic Key & Rim Lights on the Hero King
  const heroKeyLight = new THREE.DirectionalLight('#ffe4b5', 2.4);
  heroKeyLight.position.set(-2.5, 5.5, 4.2);
  heroKeyLight.target.position.set(heroCenterX, 1.6, heroCenterZ);
  group.add(heroKeyLight, heroKeyLight.target);

  const heroRimLight = new THREE.PointLight('#a66cff', 3.2, 10.0, 1.5);
  heroRimLight.position.set(heroCenterX + 1.4, 3.2, -2.2);
  group.add(heroRimLight);

  // 7. Floating Arcane Embers & Ground Mist Particles
  const emberCount = isLow ? 28 : isMobile ? 64 : 120;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(emberCount * 3);
  for (let i = 0; i < emberCount; i++) {
    emberPos[i * 3] = (Math.random() - 0.35) * 9.5;
    emberPos[i * 3 + 1] = Math.random() * 4.5;
    emberPos[i * 3 + 2] = (Math.random() - 0.5) * 7.5;
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const emberMat = new THREE.PointsMaterial({
    color: new THREE.Color('#ffca58'),
    size: 0.065,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  group.add(embers);

  const update = (elapsed: number, delta: number, reducedMotion: boolean) => {
    if (reducedMotion) return;

    // 1. Subtle Hero King breathing & slow regal turn
    heroPieceGroup.position.y = 0.60 + Math.sin(elapsed * 1.4) * 0.025;
    heroPieceGroup.rotation.y = Math.sin(elapsed * 0.45) * 0.16 - 0.18;

    // 2. Pulsing amethyst chest crystal & floor sigil shimmer
    const pulse = 0.82 + Math.sin(elapsed * 3.2) * 0.18;
    chestCrystal.scale.set(0.85 * pulse, 1.65 * pulse, 0.65 * pulse);
    floorSigil.rotation.z = elapsed * 0.18;
    (floorSigil.material as THREE.MeshBasicMaterial).opacity = 0.72 + Math.sin(elapsed * 2.4) * 0.16;

    // 3. Counter-rotating orbiting golden rune ribbons
    runeRibbon1.rotation.y = elapsed * 0.42;
    runeRibbon2.rotation.y = -elapsed * 0.34;

    // 4. Gentle cloth/banner sway
    for (const banner of banners) {
      const phase = (banner.userData.phase as number) ?? 0;
      banner.rotation.z = Math.sin(elapsed * 1.6 + phase) * 0.035;
      banner.rotation.x = Math.cos(elapsed * 1.2 + phase) * 0.025;
    }

    // 5. Brazier flame flicker
    for (const b of braziers) {
      const flicker = Math.sin(elapsed * 9.0 + b.phase) * 0.16 + Math.cos(elapsed * 15.0 + b.phase) * 0.09;
      if (b.light) {
        b.light.intensity = b.baseIntensity * (1.0 + flicker);
      }
      b.coreGlow.scale.setScalar(1.0 + flicker * 0.32);
      b.flameLayers.forEach((layer, idx) => {
        const wave = Math.sin(elapsed * (8.5 + idx) + b.phase);
        layer.scale.set(1.0 - wave * 0.1, 1.0 + wave * 0.22 + flicker * 0.25, 1.0);
      });
    }

    // 6. Rising golden embers
    const posAttr = embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      let y = posAttr.getY(i) + delta * (0.28 + (i % 5) * 0.08);
      if (y > 4.6) y = 0.05;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;
    embers.rotation.y = elapsed * 0.04;
  };

  const setQuality = (newQuality: QualityTier) => {
    const low = newQuality === 'low';
    for (const ray of godRays) {
      ray.visible = !low;
    }
    for (const b of braziers) {
      if (b.light) b.light.visible = !low;
      b.flameLayers.forEach((l, idx) => {
        l.visible = idx < (low ? 2 : 5);
      });
    }
  };

  return {
    group,
    heroPieceGroup,
    chestCrystal,
    runeRibbon1,
    runeRibbon2,
    floorSigil,
    banners,
    braziers,
    godRays,
    embers,
    update,
    setQuality
  };
}
