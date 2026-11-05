import * as THREE from 'three';
import type { MapId } from '../engine/types';
import {
  createFlameSpriteTexture,
  createMasonryWallTexture,
  createStoneFloorTexture,
  getAdaptiveTextureSize,
  type QualityTier
} from '../assets/ProceduralTextures';

export interface BrazierFlameInstance {
  light: THREE.PointLight | null;
  flameLayers: THREE.Mesh[];
  coreGlow: THREE.Mesh;
  sparks: THREE.Points | null;
  baseIntensity: number;
  phase: number;
}

export interface FloatingCrystalInstance {
  mesh: THREE.Group;
  baseY: number;
  phase: number;
}

export interface ArenaElements {
  group: THREE.Group;
  mapId: MapId;
  braziers: BrazierFlameInstance[];
  floatingCrystals: FloatingCrystalInstance[];
  embers: THREE.Points | null;
}

/**
 * Builds one of the 3 distinct dark-fantasy 3D arenas:
 * 1. `cathedral` — Gothic Cathedral (weathered dark limestone, stained glass, warm roaring fire braziers)
 * 2. `warhall`   — Royal War Hall (iron-granite fortress, crimson-and-gold royal banners, shields, grand chandelier)
 * 3. `sanctum`   — Arcane Sanctum (astral obsidian chamber, levitating mana crystal monoliths, cyan-violet arcane fire)
 */
export function buildCastleArena(
  quality: QualityTier = 'high',
  isMobile = false,
  enableParticles = true,
  enablePointLights = true,
  mapId: MapId = 'cathedral'
): ArenaElements {
  const group = new THREE.Group();
  group.name = `WizardChessArena_${mapId}`;

  const texSize = getAdaptiveTextureSize(quality, isMobile);
  const masonry = createMasonryWallTexture(texSize, mapId);
  masonry.map.repeat.set(6, 3);
  masonry.bumpMap.repeat.set(6, 3);

  const columnMasonry = createMasonryWallTexture(Math.max(256, Math.floor(texSize / 2)), mapId);
  columnMasonry.map.repeat.set(2, 4);
  columnMasonry.bumpMap.repeat.set(2, 4);

  const floorTex = createStoneFloorTexture(texSize, mapId);
  floorTex.repeat.set(14, 14);

  // Use neutral-warm/cool multipliers so the 2K procedural masonry & floor textures' own dark stone & mortar contrast read clearly
  const wallTint =
    mapId === 'warhall' ? '#d8c4b6' : mapId === 'sanctum' ? '#b8c4e8' : '#dfd2c4';
  const colTint =
    mapId === 'warhall' ? '#ccb6a6' : mapId === 'sanctum' ? '#aab8dc' : '#d4c5b4';
  const trimTint =
    mapId === 'warhall' ? '#8c7260' : mapId === 'sanctum' ? '#5c668a' : '#968270';
  const floorTint =
    mapId === 'warhall' ? '#c8b2a2' : mapId === 'sanctum' ? '#a8b6dc' : '#cfc0b0';

  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(wallTint),
    map: masonry.map,
    bumpMap: masonry.bumpMap,
    bumpScale: 0.032,
    roughness: 0.82,
    metalness: 0.06
  });

  const columnMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colTint),
    map: columnMasonry.map,
    bumpMap: columnMasonry.bumpMap,
    bumpScale: 0.028,
    roughness: 0.78,
    metalness: 0.08
  });

  const trimStoneMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(trimTint),
    roughness: 0.74,
    metalness: 0.10
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(floorTint),
    map: floorTex,
    bumpMap: floorTex,
    bumpScale: 0.018,
    roughness: 0.72,
    metalness: 0.08
  });

  const darkTimberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#22160f'),
    roughness: 0.80,
    metalness: 0.08
  });

  const wroughtIronMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#16181e'),
    roughness: 0.44,
    metalness: 0.84
  });

  const goldAccentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d89e32'),
    roughness: 0.28,
    metalness: 0.88
  });

  // 1. Paved Stone Chamber Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.18;
  floor.receiveShadow = true;
  group.add(floor);

  // 2. Layered Flame Sprite Texture ('warm' for Cathedral & War Hall, 'arcane' for Sanctum)
  const flameVariant = mapId === 'sanctum' ? 'arcane' : 'warm';
  const flameTex = createFlameSpriteTexture(flameVariant);
  const flameSpriteMat = new THREE.MeshBasicMaterial({
    map: flameTex,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const isArcane = mapId === 'sanctum';
  const coalColor = isArcane ? '#00bbff' : '#ff3b00';
  const coalEmissive = isArcane ? '#0077ee' : '#dd2600';
  const lightHex = isArcane ? 0x38b6ff : mapId === 'warhall' ? 0xff8c2a : 0xff9436;

  // Helper to build a realistic multi-plane layered fire cluster (visible from both side & top-down views)
  const createLayeredFireCluster = (scale = 1.0): { cluster: THREE.Group; layers: THREE.Mesh[]; coreGlow: THREE.Mesh } => {
    const cluster = new THREE.Group();
    const layers: THREE.Mesh[] = [];

    // 6 vertical intersecting flame planes at 30-degree intervals + tilted lick planes
    const planeGeo = new THREE.PlaneGeometry(1.45 * scale, 1.85 * scale);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(planeGeo, flameSpriteMat);
      const angle = (i * Math.PI) / 6;
      m.rotation.y = angle;
      m.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.08;
      m.position.set(
        Math.cos(angle * 2) * 0.08 * scale,
        0.55 * scale + (i % 3) * 0.06 * scale,
        Math.sin(angle * 2) * 0.08 * scale
      );
      m.userData = {
        baseScaleX: (0.82 + (i % 3) * 0.14),
        baseScaleY: (0.88 + (i % 2) * 0.22),
        baseRotY: angle,
        layerIdx: i
      };
      cluster.add(m);
      layers.push(m);
    }

    // 2 angled horizontal/conical flame petal planes so top-down camera also sees rich layered fire tongues
    const topGeo = new THREE.PlaneGeometry(1.35 * scale, 1.35 * scale);
    topGeo.rotateX(-Math.PI / 2);
    for (let j = 0; j < 2; j++) {
      const topMesh = new THREE.Mesh(topGeo, flameSpriteMat);
      topMesh.position.y = (0.28 + j * 0.22) * scale;
      topMesh.rotation.y = j * (Math.PI / 4);
      topMesh.userData = {
        baseScaleX: 0.95 - j * 0.15,
        baseScaleY: 0.95 - j * 0.15,
        baseRotY: j * (Math.PI / 4),
        isTopPetal: true,
        layerIdx: 6 + j
      };
      cluster.add(topMesh);
      layers.push(topMesh);
    }

    // Soft glowing inner ember core sphere
    const coreMat = new THREE.MeshBasicMaterial({
      color: isArcane ? 0x88ffff : 0xffdd77,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.36 * scale, 12, 10), coreMat);
    coreGlow.position.y = 0.24 * scale;
    cluster.add(coreGlow);

    return { cluster, layers, coreGlow };
  };

  // 3. Two Flanking Square Stone Pedestals with Wrought-Iron Caged Fire Braziers
  const braziers: BrazierFlameInstance[] = [];
  const brazierSides = [-8.15, 8.15];

  const coalMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(coalColor),
    emissive: new THREE.Color(coalEmissive),
    emissiveIntensity: 2.6,
    roughness: 0.45
  });

  brazierSides.forEach((bx, idx) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(bx, -0.18, 0.0);

    // Low stepped square stone pedestal
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.14, 3.35), columnMat);
    step1.position.y = 0.07;
    step1.receiveShadow = true;
    bGroup.add(step1);

    const step2 = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.14, 2.75), trimStoneMat);
    step2.position.y = 0.21;
    step2.receiveShadow = true;
    bGroup.add(step2);

    const step3 = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.12, 2.15), columnMat);
    step3.position.y = 0.34;
    step3.receiveShadow = true;
    bGroup.add(step3);

    // Wrought-iron brazier bowl & lattice cage
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.58, 0.48, 18), wroughtIronMat);
    bowl.position.y = 0.62;
    bGroup.add(bowl);

    const topRing = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.055, 8, 28), wroughtIronMat);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 0.96;
    bGroup.add(topRing);

    const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.045, 8, 28), wroughtIronMat);
    midRing.rotation.x = Math.PI / 2;
    midRing.position.y = 0.72;
    bGroup.add(midRing);

    for (let r = 0; r < 16; r++) {
      const a = (r * Math.PI * 2) / 16;
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 6), wroughtIronMat);
      rib.position.set(Math.cos(a) * 1.0, 0.76, Math.sin(a) * 1.0);
      rib.rotation.set(Math.sin(a) * -0.35, 0, Math.cos(a) * 0.35);
      bGroup.add(rib);
    }

    // Glowing coal bed + charred logs inside the brazier
    const coalBed = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.75, 0.16, 16), coalMat);
    coalBed.position.y = 0.76;
    bGroup.add(coalBed);

    for (let l = 0; l < 4; l++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.10, 1.15, 8), darkTimberMat);
      log.position.set(0, 0.85, 0);
      log.rotation.set(Math.PI / 2, (l * Math.PI) / 4, 0.18);
      bGroup.add(log);
    }

    // Multi-layered realistic flame sprite cluster
    const { cluster, layers, coreGlow } = createLayeredFireCluster(1.05);
    cluster.position.y = 0.78;
    bGroup.add(cluster);

    // Rising glowing spark particles above each brazier
    let sparks: THREE.Points | null = null;
    if (enableParticles) {
      const sparkCount = 28;
      const sPos = new Float32Array(sparkCount * 3);
      for (let s = 0; s < sparkCount; s++) {
        const rad = Math.random() * 0.65;
        const ang = Math.random() * Math.PI * 2;
        sPos[s * 3] = Math.cos(ang) * rad;
        sPos[s * 3 + 1] = 0.9 + Math.random() * 2.2;
        sPos[s * 3 + 2] = Math.sin(ang) * rad;
      }
      const sGeo = new THREE.BufferGeometry();
      sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
      const sMat = new THREE.PointsMaterial({
        color: isArcane ? 0x66e0ff : 0xffaa33,
        size: 0.08,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      sparks = new THREE.Points(sGeo, sMat);
      bGroup.add(sparks);
    }

    let fireLight: THREE.PointLight | null = null;
    if (enablePointLights) {
      fireLight = new THREE.PointLight(lightHex, 24.0, 25.0, 1.35);
      fireLight.position.set(0, 1.85, 0);
      fireLight.castShadow = false;
      bGroup.add(fireLight);
    }

    braziers.push({
      light: fireLight,
      flameLayers: layers,
      coreGlow,
      sparks,
      baseIntensity: 24.0,
      phase: idx * 2.3
    });

    group.add(bGroup);
  });

  // 4. Clustered Fluted Cathedral / Fortress Columns with Wall Torch Sconces
  const createClusteredColumn = (x: number, z: number, withTorch = false, idx = 0) => {
    const colGroup = new THREE.Group();
    colGroup.position.set(x, -0.18, z);

    const base1 = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.55, 0.42, 8), trimStoneMat);
    base1.position.y = 0.21;
    colGroup.add(base1);

    const base2 = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.36, 0.45, 8), trimStoneMat);
    base2.position.y = 0.64;
    colGroup.add(base2);

    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.96, 13.5, 16), columnMat);
    core.position.y = 7.4;
    core.receiveShadow = true;
    colGroup.add(core);

    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      const subShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 13.5, 10), columnMat);
      subShaft.position.set(Math.cos(a) * 0.86, 7.4, Math.sin(a) * 0.86);
      colGroup.add(subShaft);
    }

    for (const bandY of [4.2, 8.2]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.24, 1.18, 0.28, 12), trimStoneMat);
      band.position.y = bandY;
      colGroup.add(band);
    }

    // Add iron wall torch sconce facing toward the center of the arena
    if (withTorch) {
      const dirToCenter = new THREE.Vector2(-x, -z).normalize();
      const torchAngle = Math.atan2(dirToCenter.x, dirToCenter.y);
      const sconceGroup = new THREE.Group();
      sconceGroup.position.set(dirToCenter.x * 1.18, 3.35, dirToCenter.y * 1.18);
      sconceGroup.rotation.y = torchAngle;

      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.35), wroughtIronMat);
      bracket.position.set(0, -0.15, -0.12);
      sconceGroup.add(bracket);

      const torchShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.04, 0.68, 8), wroughtIronMat);
      torchShaft.rotation.x = 0.25;
      sconceGroup.add(torchShaft);

      const { cluster, layers, coreGlow } = createLayeredFireCluster(0.38);
      cluster.position.set(0, 0.32, 0.08);
      sconceGroup.add(cluster);

      colGroup.add(sconceGroup);
      braziers.push({
        light: null,
        flameLayers: layers,
        coreGlow,
        sparks: null,
        baseIntensity: 0,
        phase: idx * 1.3 + 0.7
      });
    }

    return colGroup;
  };

  // 5. Blind Gothic Arcade Wall Bay
  const createArcadeBay = (x: number, z: number, rotY: number) => {
    const bay = new THREE.Group();
    bay.position.set(x, -0.18, z);
    bay.rotation.y = rotY;

    for (const offsetX of [-1.25, 1.25]) {
      for (const side of [-0.95, 0.95]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.6, 8), trimStoneMat);
        pil.position.set(offsetX + side, 2.0, 0.24);
        bay.add(pil);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.15, 8, 18, Math.PI), trimStoneMat);
      arch.position.set(offsetX, 3.8, 0.24);
      bay.add(arch);
    }

    const molding = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.26, 0.45), trimStoneMat);
    molding.position.set(0, 5.15, 0.2);
    bay.add(molding);

    return bay;
  };

  // 6. Arched Cathedral Window (darker stained glass for moodier atmosphere)
  const createCathedralWindow = (x: number, y: number, z: number, rotY: number, style: 'amber' | 'sky') => {
    const winGroup = new THREE.Group();
    winGroup.position.set(x, y, z);
    winGroup.rotation.y = rotY;

    const glassColor =
      mapId === 'sanctum'
        ? style === 'amber'
          ? '#6b4cff'
          : '#2ad4ff'
        : mapId === 'warhall'
          ? style === 'amber'
            ? '#d46b24'
            : '#8a4f28'
          : style === 'amber'
            ? '#d98c2b'
            : '#5582b8';

    const glassMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(glassColor)
    });

    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 3.4), glassMat);
    pane.position.z = 0.16;
    winGroup.add(pane);

    const topPane = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16, 0, Math.PI), glassMat);
    topPane.position.set(0, 1.7, 0.16);
    winGroup.add(topPane);

    for (const sx of [-0.92, 0.92]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.5, 0.36), trimStoneMat);
      jamb.position.set(sx, 0, 0.16);
      winGroup.add(jamb);
    }
    const archFrame = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.14, 8, 18, Math.PI), trimStoneMat);
    archFrame.position.set(0, 1.7, 0.16);
    winGroup.add(archFrame);

    for (const mx of [-0.42, 0, 0.42]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 4.1, 0.05), wroughtIronMat);
      bar.position.set(mx, 0.3, 0.20);
      winGroup.add(bar);
    }
    for (const my of [-1.2, -0.4, 0.4, 1.2]) {
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.05), wroughtIronMat);
      hBar.position.set(0, my, 0.20);
      winGroup.add(hBar);
    }

    return winGroup;
  };

  // 7. Construct the 4 Perimeter Masonry Walls (`dist = 14.8`)
  const wallDist = 14.8;
  const wallConfigs: Array<{ pos: [number, number, number]; rotY: number }> = [
    { pos: [0, 6.8, -wallDist], rotY: 0 },
    { pos: [wallDist, 6.8, 0], rotY: -Math.PI / 2 },
    { pos: [-wallDist, 6.8, 0], rotY: Math.PI / 2 },
    { pos: [0, 6.8, wallDist], rotY: Math.PI }
  ];

  for (const wc of wallConfigs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(30.5, 14.5, 0.6), wallMat);
    wall.position.set(wc.pos[0], wc.pos[1], wc.pos[2]);
    wall.rotation.y = wc.rotY;
    wall.receiveShadow = true;
    group.add(wall);
  }

  const columnPositions: Array<[number, number]> = [
    [-10.5, -13.6],
    [-3.2, -13.6],
    [4.2, -13.6],
    [11.5, -13.6],
    [-10.5, 13.6],
    [-3.2, 13.6],
    [4.2, 13.6],
    [11.5, 13.6],
    [13.6, -7.2],
    [13.6, 0.5],
    [13.6, 8.2],
    [-13.6, -7.2],
    [-13.6, 0.5],
    [-13.6, 8.2]
  ];
  columnPositions.forEach(([cx, cz], i) => {
    group.add(createClusteredColumn(cx, cz, true, i));
  });

  group.add(createArcadeBay(0.5, -14.5, 0));
  group.add(createArcadeBay(7.8, -14.5, 0));
  group.add(createArcadeBay(0.5, 14.5, Math.PI));
  group.add(createArcadeBay(7.8, 14.5, Math.PI));
  group.add(createArcadeBay(14.5, -3.4, -Math.PI / 2));
  group.add(createArcadeBay(14.5, 4.4, -Math.PI / 2));
  group.add(createArcadeBay(-14.5, -3.4, Math.PI / 2));
  group.add(createArcadeBay(-14.5, 4.4, Math.PI / 2));

  // Grand Arched Double Cathedral Doors
  const createCathedralDoors = (x: number, z: number, rotY: number) => {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(x, -0.18, z);
    doorGroup.rotation.y = rotY;
    const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(3.8, 5.2, 0.22), darkTimberMat);
    doorLeaf.position.y = 2.6;
    doorGroup.add(doorLeaf);
    const doorArchPane = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 1.9, 0.20, 20, 1, false, 0, Math.PI),
      trimStoneMat
    );
    doorArchPane.rotation.z = -Math.PI / 2;
    doorArchPane.rotation.y = Math.PI / 2;
    doorArchPane.position.y = 5.2;
    doorGroup.add(doorArchPane);
    for (const r of [2.05, 2.28, 2.52]) {
      const archivolt = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 24, Math.PI), trimStoneMat);
      archivolt.position.set(0, 5.2, 0.16);
      doorGroup.add(archivolt);
      for (const sx of [-r, r]) {
        const jamb = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 5.2, 8), trimStoneMat);
        jamb.position.set(sx, 2.6, 0.16);
        doorGroup.add(jamb);
      }
    }
    return doorGroup;
  };

  group.add(createCathedralDoors(-6.8, -14.45, 0));
  group.add(createCathedralDoors(6.8, 14.45, Math.PI));

  group.add(createCathedralWindow(-0.2, 6.1, -14.45, 0, 'amber'));
  group.add(createCathedralWindow(5.8, 6.1, -14.45, 0, 'sky'));
  group.add(createCathedralWindow(-0.2, 6.1, 14.45, Math.PI, 'amber'));
  group.add(createCathedralWindow(-5.8, 6.1, 14.45, Math.PI, 'sky'));
  group.add(createCathedralWindow(14.45, 6.1, -3.2, -Math.PI / 2, 'sky'));
  group.add(createCathedralWindow(14.45, 6.1, 4.2, -Math.PI / 2, 'amber'));

  // 8. Map-Specific Landmarks & Environmental Storytelling
  const floatingCrystals: FloatingCrystalInstance[] = [];

  if (mapId === 'warhall') {
    // MAP 2: ROYAL WAR HALL — Crimson & Gold Royal Banners, Heraldic Shields, and Grand Overhead War Chandelier
    // Main crimson drape (with subtle warm self-illumination from hall torches so banners stand out vividly)
    const crimsonClothMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#9e1922'),
      emissive: new THREE.Color('#38060a'),
      emissiveIntensity: 0.45,
      roughness: 0.68,
      metalness: 0.08,
      side: THREE.DoubleSide
    });

    const createRoyalBanner = (x: number, y: number, z: number, rotY: number) => {
      const b = new THREE.Group();
      b.position.set(x, y, z);
      b.rotation.y = rotY;

      // Brass crossbar
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), goldAccentMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.y = 2.4;
      b.add(rod);

      // Main crimson drape
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.75, 4.4, 0.05), crimsonClothMat);
      cloth.position.y = 0.2;
      b.add(cloth);

      // Golden vertical trim & royal cross emblem
      for (const tx of [-0.78, 0.78]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(0.10, 4.42, 0.07), goldAccentMat);
        trim.position.set(tx, 0.2, 0);
        b.add(trim);
      }
      const vCross = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.8, 0.08), goldAccentMat);
      vCross.position.set(0, 0.5, 0);
      b.add(vCross);
      const hCross = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.08), goldAccentMat);
      hCross.position.set(0, 0.75, 0);
      b.add(hCross);

      // War shield mounted below the banner
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.12, 6), wroughtIronMat);
      shield.rotation.x = Math.PI / 2;
      shield.position.set(0, -1.6, 0.08);
      b.add(shield);
      const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), goldAccentMat);
      shieldBoss.position.set(0, -1.6, 0.14);
      b.add(shieldBoss);

      return b;
    };

    const bannerSpots: Array<[number, number, number, number]> = [
      [-6.8, 4.2, -13.1, 0],
      [0.5, 4.2, -13.1, 0],
      [7.8, 4.2, -13.1, 0],
      [-6.8, 4.2, 13.1, Math.PI],
      [0.5, 4.2, 13.1, Math.PI],
      [-13.1, 4.2, -3.4, Math.PI / 2],
      [-13.1, 4.2, 4.4, Math.PI / 2],
      [13.1, 4.2, -3.4, -Math.PI / 2],
      [13.1, 4.2, 4.4, -Math.PI / 2]
    ];
    for (const [bx, by, bz, brot] of bannerSpots) {
      group.add(createRoyalBanner(bx, by, bz, brot));
    }

    // Crimson & gold war-carpet runner under the board pedestals
    const carpetMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#5a0e14'),
      roughness: 0.85,
      metalness: 0.04
    });
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(24, 9.5), carpetMat);
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.y = -0.172;
    carpet.receiveShadow = true;
    group.add(carpet);

    const carpetBorderGeo = new THREE.RingGeometry(6.1, 6.35, 4);
    carpetBorderGeo.rotateX(-Math.PI / 2);
    carpetBorderGeo.rotateY(Math.PI / 4);
    const carpetBorder = new THREE.Mesh(carpetBorderGeo, goldAccentMat);
    carpetBorder.position.y = -0.168;
    group.add(carpetBorder);
  } else if (mapId === 'sanctum') {
    // MAP 3: ARCANE SANCTUM — Levitating Glowing Mana Crystal Monoliths & Inscribed Floor Ley-Line Rings
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#2ae0ff'),
      emissive: new THREE.Color('#1878ff'),
      emissiveIntensity: 1.85,
      roughness: 0.12,
      metalness: 0.2,
      clearcoat: 0.8
    });

    const leyLineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38d6ff'),
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // Concentric glowing arcane ritual rings on the chamber floor
    for (const [rIn, rOut] of [
      [6.4, 6.56],
      [7.8, 7.92],
      [9.6, 9.78]
    ]) {
      const ringGeo = new THREE.RingGeometry(rIn, rOut, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMesh = new THREE.Mesh(ringGeo, leyLineMat);
      ringMesh.position.y = -0.168;
      group.add(ringMesh);
    }

    // 8 Levitating Arcane Crystal Monoliths around the sanctum perimeter
    const crystalCoords: Array<[number, number]> = [
      [-7.4, -7.4],
      [7.4, -7.4],
      [-7.4, 7.4],
      [7.4, 7.4],
      [0, -9.2],
      [0, 9.2],
      [-9.8, -4.5],
      [9.8, 4.5]
    ];

    crystalCoords.forEach(([cx, cz], idx) => {
      const cGroup = new THREE.Group();
      const baseY = 1.95 + (idx % 2) * 0.45;
      cGroup.position.set(cx, baseY, cz);

      // Sculpted elongated crystal shard
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), crystalMat);
      shard.scale.set(0.75, 2.35, 0.75);
      cGroup.add(shard);

      // Orbiting golden astrolabe ring around the crystal
      const astroRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.04, 8, 28), goldAccentMat);
      astroRing.rotation.x = Math.PI / 3;
      astroRing.name = 'astrolabe_ring';
      cGroup.add(astroRing);

      // Stone arcane pedestal base beneath the levitating crystal
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.88, 0.42, 8), trimStoneMat);
      ped.position.set(cx, 0.03, cz);
      group.add(ped);

      group.add(cGroup);
      floatingCrystals.push({
        mesh: cGroup,
        baseY,
        phase: idx * 0.95
      });
    });
  }

  // 9. Atmospheric Floating Cathedral / Arcane Dust Motes
  let embers: THREE.Points | null = null;
  if (enableParticles) {
    const count = 96;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 1] = 0.3 + Math.random() * 5.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14;

      if (mapId === 'sanctum') {
        colors[i * 3] = 0.35;
        colors[i * 3 + 1] = 0.85;
        colors[i * 3 + 2] = 1.0;
      } else {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.78;
        colors[i * 3 + 2] = 0.42;
      }
    }

    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    emberGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const emberMat = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    embers = new THREE.Points(emberGeo, emberMat);
    embers.name = 'ArenaAtmosphericMotes';
    group.add(embers);
  }

  return { group, mapId, braziers, floatingCrystals, embers };
}
