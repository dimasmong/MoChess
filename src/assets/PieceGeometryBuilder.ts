import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PieceSkinId, PieceSymbol } from '../engine/types';

export type PieceDetailLevel = 'high' | 'low';

export interface PieceMeshParts {
  body: THREE.BufferGeometry;
  gold: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
  marker: THREE.BufferGeometry;
}

function finalizeMerged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 0) {
    // Tiny hidden triangle at origin if a part is unused
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.01, 0, 0.001, 0.01, 0, 0, 0.01, 0.001], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    return empty;
  }
  const merged = mergeGeometries(list, false);
  const indexed = mergeVertices(merged, 1e-4);
  indexed.computeBoundingSphere();
  indexed.computeBoundingBox();
  return indexed;
}

function prepGeo(
  geo: THREE.BufferGeometry,
  options?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    flatShaded?: boolean;
  }
): THREE.BufferGeometry {
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const g = geo.index ? geo.toNonIndexed() : geo.clone();

  if (options?.scale) {
    g.scale(options.scale[0], options.scale[1], options.scale[2]);
  }
  if (options?.rotation) {
    const euler = new THREE.Euler(options.rotation[0], options.rotation[1], options.rotation[2], 'XYZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const mat = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    g.applyMatrix4(mat);
  }
  if (options?.position) {
    g.translate(options.position[0], options.position[1], options.position[2]);
  }

  if (options?.flatShaded) {
    g.computeVertexNormals();
  } else {
    g.normalizeNormals();
  }

  const posAttr = g.getAttribute('position');
  if (!g.getAttribute('uv') && posAttr) {
    const uvs = new Float32Array(posAttr.count * 2);
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      uvs[i * 2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
      uvs[i * 2 + 1] = y * 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') {
      g.deleteAttribute(key);
    }
  }

  return g;
}

// ============================================================================
// UNIVERSAL 3D OVERHEAD ROLE EMBLEM & TOP GEOMETRY HELPERS
// Real extruded 3D geometry integrated into upper surfaces (zero flat stickers,
// zero z-fighting, readable from Strategic Top-Down & Direct Overhead cameras).
// ============================================================================

function extrudeHorizontalEmblem(
  ptsXZ: Array<[number, number]>,
  depth: number,
  yBase: number,
  detail: PieceDetailLevel,
  opts?: {
    scale?: number;
    rotX?: number;
    rotY?: number;
    offsetX?: number;
    offsetZ?: number;
    bevel?: boolean;
  }
): THREE.BufferGeometry {
  const s = opts?.scale ?? 1.0;
  const shape = new THREE.Shape();
  ptsXZ.forEach(([x, z], idx) => {
    // Map (x, z) -> (x, -z) so after rotating -90 deg around X, +x -> +X, +z -> +Z, extrude -> +Y
    const sx = x * s;
    const sy = -z * s;
    if (idx === 0) shape.moveTo(sx, sy);
    else shape.lineTo(sx, sy);
  });
  shape.closePath();

  const useBevel = (opts?.bevel ?? true) && detail === 'high';
  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth,
    curveSegments: detail === 'high' ? 8 : 4,
    bevelEnabled: useBevel,
    bevelThickness: useBevel ? Math.min(0.006, depth * 0.25) : 0,
    bevelSize: useBevel ? 0.005 * s : 0,
    bevelSegments: 1
  });

  return prepGeo(extrudeGeo, {
    rotation: [-Math.PI / 2 + (opts?.rotX ?? 0), opts?.rotY ?? 0, 0],
    position: [opts?.offsetX ?? 0, yBase, opts?.offsetZ ?? 0],
    flatShaded: true
  });
}

/**
 * PAWN TOP EMBLEM — Pearl Silver Single Dot Medallion framed by a contrasting gold bezel ring.
 */
function addPawnTopDotEmblem(
  yTop: number,
  scale: number,
  detail: PieceDetailLevel,
  goldList: THREE.BufferGeometry[],
  markerList: THREE.BufferGeometry[],
  isClassic = false
): void {
  const segs = detail === 'high' ? 24 : 12;
  const bezelR = (isClassic ? 0.068 : 0.092) * scale;
  const dotR = (isClassic ? 0.054 : 0.072) * scale;
  const h = isClassic ? 0.016 : 0.026;

  // Contrasting warm gold bezel ring so Pearl Silver reads crisply on BOTH White ivory and Black obsidian
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(bezelR, bezelR * 1.06, h * 0.65, segs), {
      position: [0, yTop + h * 0.25, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(bezelR * 0.96, 0.011 * scale, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, yTop + h * 0.55, 0]
    })
  );

  // Raised Pearl Silver Single Dot Medallion
  markerList.push(
    prepGeo(new THREE.CylinderGeometry(dotR * 0.96, dotR, h, segs), {
      position: [0, yTop + h * 0.65, 0]
    })
  );
  markerList.push(
    prepGeo(new THREE.SphereGeometry(dotR * 0.96, segs, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), {
      scale: [1.0, 0.36, 1.0],
      position: [0, yTop + h * 1.02, 0]
    })
  );
}

/**
 * ROOK TOP EMBLEM — Emerald Green Crenellated Castle Tower / Fortress Symbol on a square parapet deck.
 */
function addRookTopFortressEmblem(
  yDeck: number,
  scale: number,
  detail: PieceDetailLevel,
  goldList: THREE.BufferGeometry[],
  markerList: THREE.BufferGeometry[],
  isClassic = false
): void {
  const depth = isClassic ? 0.018 : 0.032;

  // Crisp square gold frame inset on the parapet deck
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.255 * scale, 0.012, 0.255 * scale), {
      position: [0, yDeck + 0.005, 0],
      flatShaded: true
    })
  );

  // 3-Merlon Crenellated Castle Tower silhouette in (X, Z) facing forward (+Z) & upward (+Y)
  const towerPts: Array<[number, number]> = [
    [-0.108, -0.112],
    [0.108, -0.112],
    [0.092, -0.068],
    [0.084, 0.024],
    [0.114, 0.042],
    [0.114, 0.114],
    [0.056, 0.114],
    [0.056, 0.068],
    [0.028, 0.068],
    [0.028, 0.114],
    [-0.028, 0.114],
    [-0.028, 0.068],
    [-0.056, 0.068],
    [-0.056, 0.114],
    [-0.114, 0.114],
    [-0.114, 0.042],
    [-0.084, 0.024],
    [-0.092, -0.068]
  ];

  markerList.push(
    extrudeHorizontalEmblem(towerPts, depth, yDeck + 0.012, detail, {
      scale,
      bevel: !isClassic
    })
  );

  // Raised central fortress keep ridge for extra 3D depth
  if (!isClassic) {
    markerList.push(
      prepGeo(new THREE.BoxGeometry(0.088 * scale, depth * 0.45, 0.095 * scale), {
        position: [0, yDeck + 0.012 + depth + depth * 0.2, -0.018 * scale],
        flatShaded: true
      })
    );
  }
}

/**
 * KNIGHT TOP EMBLEM — Ember Red Stylized Horse-Head Crest integrated onto the upper horse crown/poll.
 */
function addKnightTopHorseEmblem(
  yPoll: number,
  zPoll: number,
  scale: number,
  pitchX: number,
  detail: PieceDetailLevel,
  goldList: THREE.BufferGeometry[],
  markerList: THREE.BufferGeometry[],
  isClassic = false
): void {
  const segs = detail === 'high' ? 16 : 8;
  const depth = isClassic ? 0.018 : 0.030;

  // Sculpted dorsal crest escutcheon plate framing the Ember Red Horse-Head symbol
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.132 * scale, 0.142 * scale, 0.016, segs), {
      scale: [0.94, 1.0, 1.08],
      rotation: [pitchX, 0, 0],
      position: [0, yPoll, zPoll]
    })
  );

  // Iconic Stylized Chess Horse-Head Profile in (X, Z) — clear arched mane, alert ear, forehead, snout & jaw
  const horsePts: Array<[number, number]> = [
    [-0.084, -0.104],
    [0.048, -0.104],
    [0.028, -0.032],
    [0.046, 0.002],
    [0.112, -0.014],
    [0.122, 0.028],
    [0.058, 0.082],
    [0.034, 0.106],
    [0.038, 0.138],
    [0.004, 0.112],
    [-0.030, 0.134],
    [-0.086, 0.084],
    [-0.106, 0.004]
  ];

  markerList.push(
    extrudeHorizontalEmblem(horsePts, depth, yPoll + 0.009, detail, {
      scale: scale * 0.95,
      rotX: pitchX,
      offsetZ: zPoll,
      bevel: !isClassic
    })
  );
}

/**
 * BISHOP TOP EMBLEM — Arcane Cyan Sacred 4-Point Diamond nestled inside a cleft mitre/crystal.
 */
function addBishopTopDiamondEmblem(
  yCleft: number,
  scale: number,
  detail: PieceDetailLevel,
  goldList: THREE.BufferGeometry[],
  markerList: THREE.BufferGeometry[],
  isClassic = false
): void {
  const depth = isClassic ? 0.018 : 0.034;

  // Pointed diamond gold setting rim
  const rimPts: Array<[number, number]> = [
    [0, 0.156],
    [0.108, 0],
    [0, -0.156],
    [-0.108, 0]
  ];
  goldList.push(
    extrudeHorizontalEmblem(rimPts, 0.014, yCleft, detail, {
      scale,
      bevel: false
    })
  );

  // Bold Sacred Cyan Diamond
  const diamondPts: Array<[number, number]> = [
    [0, 0.138],
    [0.092, 0],
    [0, -0.138],
    [-0.092, 0]
  ];
  markerList.push(
    extrudeHorizontalEmblem(diamondPts, depth, yCleft + 0.012, detail, {
      scale,
      bevel: !isClassic
    })
  );

  // Upper faceted gemstone ridge for crisp top catchlights
  if (!isClassic) {
    markerList.push(
      prepGeo(new THREE.OctahedronGeometry(0.068 * scale, 0), {
        scale: [0.85, 0.42, 1.32],
        position: [0, yCleft + 0.012 + depth, 0],
        flatShaded: true
      })
    );
  }
}

/**
 * QUEEN TOP EMBLEM — Amethyst Purple Eight-Pointed Star inside the Queen's radial coronet.
 */
function addQueenTopEightPointStarEmblem(
  yDish: number,
  scale: number,
  detail: PieceDetailLevel,
  goldList: THREE.BufferGeometry[],
  markerList: THREE.BufferGeometry[],
  isClassic = false
): void {
  const segs = detail === 'high' ? 16 : 8;
  const depth = isClassic ? 0.018 : 0.034;

  // Gold jewel bezel ring beneath the 8-point star
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.132 * scale, 0.142 * scale, 0.014, segs), {
      position: [0, yDish + 0.006, 0]
    })
  );

  // Exact 16-vertex Eight-Pointed Star polygon
  const starPts: Array<[number, number]> = [];
  const outerR = 0.148;
  const innerR = 0.060;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const r = i % 2 === 0 ? outerR : innerR;
    starPts.push([Math.sin(a) * r, Math.cos(a) * r]);
  }

  markerList.push(
    extrudeHorizontalEmblem(starPts, depth, yDish + 0.013, detail, {
      scale,
      bevel: !isClassic
    })
  );

  // Faceted central amethyst star boss
  if (!isClassic) {
    markerList.push(
      prepGeo(new THREE.OctahedronGeometry(0.056 * scale, 0), {
        scale: [1.0, 0.55, 1.0],
        position: [0, yDish + 0.013 + depth, 0],
        flatShaded: true
      })
    );
  }
}

/**
 * KING TOP EMBLEM — Royal Gold Heraldic Cross Pattée + Sovereign Crown Crest.
 */
function addKingTopCrownCrossEmblem(
  yCrown: number,
  scale: number,
  detail: PieceDetailLevel,
  goldList: THREE.BufferGeometry[],
  steelList: THREE.BufferGeometry[],
  markerList: THREE.BufferGeometry[],
  includeVerticalFinial = true,
  isClassic = false
): void {
  const depth = isClassic ? 0.018 : 0.036;

  // Contrasting metallic sovereign escutcheon collar so Royal Gold stands out sharply on White & Black alike
  const collarList = isClassic ? goldList : steelList;
  collarList.push(
    prepGeo(new THREE.CylinderGeometry(0.146 * scale, 0.154 * scale, 0.016, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, yCrown + 0.006, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.152 * scale, 0.012 * scale, 6, 8), {
      rotation: [Math.PI / 2, 0, Math.PI / 8],
      position: [0, yCrown + 0.012, 0],
      flatShaded: true
    })
  );

  // Flared 4-Arm Heraldic Royal Cross Pattée in horizontal (X, Z) plane — unmistakable from 90° overhead!
  const wIn = 0.028;
  const wOut = 0.068;
  const arm = 0.142;
  const crossPts: Array<[number, number]> = [
    [-wOut, arm],
    [wOut, arm],
    [wIn, wIn],
    [arm, wOut],
    [arm, -wOut],
    [wIn, -wIn],
    [wOut, -arm],
    [-wOut, -arm],
    [-wIn, -wIn],
    [-arm, -wOut],
    [-arm, wOut],
    [-wIn, wIn]
  ];

  markerList.push(
    extrudeHorizontalEmblem(crossPts, depth, yCrown + 0.014, detail, {
      scale,
      bevel: !isClassic
    })
  );

  if (includeVerticalFinial) {
    // Structural physical sovereign vertical cross core in goldList so if Markers are toggled OFF,
    // the King retains its iconic vertical sovereign cross finial!
    const baseFinialY = yCrown + 0.012;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.036 * scale, 0.21 * scale, 0.036 * scale), {
        position: [0, baseFinialY + 0.105 * scale, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.142 * scale, 0.038 * scale, 0.036 * scale), {
        position: [0, baseFinialY + 0.142 * scale, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.036 * scale, 0.038 * scale, 0.142 * scale), {
        position: [0, baseFinialY + 0.142 * scale, 0],
        flatShaded: true
      })
    );

    // Royal Gold role-marker sheath/capping over the vertical Sovereign Cross finial
    markerList.push(
      prepGeo(new THREE.BoxGeometry(0.044 * scale, 0.19 * scale, 0.044 * scale), {
        position: [0, yCrown + 0.014 + depth + 0.088 * scale, 0],
        flatShaded: true
      })
    );
    markerList.push(
      prepGeo(new THREE.BoxGeometry(0.156 * scale, 0.046 * scale, 0.044 * scale), {
        position: [0, yCrown + 0.014 + depth + 0.118 * scale, 0],
        flatShaded: true
      })
    );
    markerList.push(
      prepGeo(new THREE.BoxGeometry(0.044 * scale, 0.046 * scale, 0.156 * scale), {
        position: [0, yCrown + 0.014 + depth + 0.118 * scale, 0],
        flatShaded: true
      })
    );
  }
}

function createSculptedLathe(
  points: Array<[number, number]>,
  radialSegments: number,
  splineSubdivisions = 3
): THREE.BufferGeometry {
  const vec2Points = points.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  const curve = new THREE.SplineCurve(vec2Points);
  const sampled = curve.getPoints(points.length * splineSubdivisions);
  sampled[0].copy(vec2Points[0]);
  sampled[1].copy(vec2Points[1]);
  const lathe = mergeVertices(new THREE.LatheGeometry(sampled, radialSegments), 1e-4);
  lathe.computeVertexNormals();
  return prepGeo(lathe);
}

function createLoftedOrganicMesh(
  sections: Array<{ x?: number; y: number; z: number; rx: number; rz: number; pitch?: number }>,
  ringSegments: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const rings: THREE.Vector3[][] = [];

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const ring: THREE.Vector3[] = [];
    const pitch = sec.pitch ?? 0;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    for (let i = 0; i <= ringSegments; i++) {
      const theta = (i / ringSegments) * Math.PI * 2;
      const lx = Math.cos(theta) * sec.rx;
      const lz = Math.sin(theta) * sec.rz;
      const wy = sec.y - lz * sinP;
      const wz = sec.z + lz * cosP;
      const wx = (sec.x ?? 0) + lx;
      ring.push(new THREE.Vector3(wx, wy, wz));
    }
    rings.push(ring);
  }

  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    const v0 = s / (rings.length - 1);
    const v1 = (s + 1) / (rings.length - 1);

    for (let i = 0; i < ringSegments; i++) {
      const p00 = r0[i];
      const p01 = r0[i + 1];
      const p10 = r1[i];
      const p11 = r1[i + 1];
      const u0 = i / ringSegments;
      const u1 = (i + 1) / ringSegments;

      positions.push(p00.x, p00.y, p00.z, p10.x, p10.y, p10.z, p11.x, p11.y, p11.z);
      uvs.push(u0, v0, u0, v1, u1, v1);

      positions.push(p00.x, p00.y, p00.z, p11.x, p11.y, p11.z, p01.x, p01.y, p01.z);
      uvs.push(u0, v0, u1, v1, u1, v0);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const welded = mergeVertices(geo, 1e-4);
  welded.computeVertexNormals();
  return prepGeo(welded);
}

/**
 * Builds the signature Wizard Chess Octagonal Stepped Pedestal with twin gleaming gold trim rings.
 */
function addOctagonalPedestal(
  radius: number,
  segs: number,
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[]
): void {
  // Crisp 8-sided octagonal bottom plinth matching the reference screenshots
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(radius * 0.94, radius, 0.08, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 0.04, 0]
    })
  );
  // Gold octagonal rim ring
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(radius * 0.96, radius * 0.98, 0.022, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 0.082, 0]
    })
  );
  // Second beveled circular tier
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(radius * 0.80, radius * 0.91, 0.075, segs), {
      position: [0, 0.125, 0]
    })
  );
  // Upper gold torus collar ring
  goldList.push(
    prepGeo(new THREE.TorusGeometry(radius * 0.79, 0.018, 10, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.165, 0]
    })
  );
}

/**
 * Adds a heater/kite shield with a raised Gold Crusader Cross on the front face.
 */
function addCrossHeaterShield(
  pos: [number, number, number],
  rot: [number, number, number],
  scale: number,
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[]
): void {
  const [px, py, pz] = pos;
  // Main shield body (curved hexagonal/kite silhouette)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.145 * scale, 0.065 * scale, 0.34 * scale, 6), {
      scale: [1.05, 1.0, 0.22],
      rotation: rot,
      position: [px, py, pz]
    })
  );
  // Gold shield rim border
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.153 * scale, 0.072 * scale, 0.352 * scale, 6), {
      scale: [1.05, 1.0, 0.16],
      rotation: rot,
      position: [px, py, pz - 0.006]
    })
  );
  // Raised Gold Cross vertical bar on front of shield
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.032 * scale, 0.29 * scale, 0.025 * scale), {
      rotation: rot,
      position: [px, py, pz + 0.024 * scale]
    })
  );
  // Raised Gold Cross horizontal bar
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.20 * scale, 0.032 * scale, 0.025 * scale), {
      rotation: rot,
      position: [px, py + 0.045 * scale, pz + 0.024 * scale]
    })
  );
  // Central shield boss rivet
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.028 * scale, 10, 10), {
      scale: [1.0, 1.0, 0.6],
      position: [px, py + 0.045 * scale, pz + 0.032 * scale]
    })
  );
}

/**
 * Adds a medieval broadsword with gold pommel/crossguard and tapered silver steel blade.
 */
function addMedievalSword(
  pos: [number, number, number],
  rot: [number, number, number],
  bladeLength: number,
  pointingDown: boolean,
  goldList: THREE.BufferGeometry[],
  steelList: THREE.BufferGeometry[]
): void {
  const [px, py, pz] = pos;
  const dir = pointingDown ? -1 : 1;

  // Gold pommel
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.032, 10, 10), {
      position: [px, py - dir * 0.11, pz]
    })
  );
  // Gold grip
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.10, 10), {
      position: [px, py - dir * 0.05, pz]
    })
  );
  // Wide gold crossguard with flared tips
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.18, 0.026, 0.036), {
      rotation: rot,
      position: [px, py, pz]
    })
  );
  for (const side of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.02, 8, 8), {
        position: [px + side * 0.09, py, pz]
      })
    );
  }

  // Tapered silver steel blade
  const bladeH = bladeLength * 0.82;
  steelList.push(
    prepGeo(new THREE.BoxGeometry(0.048, bladeH, 0.014), {
      rotation: rot,
      position: [px, py + dir * (bladeH * 0.5 + 0.01), pz]
    })
  );
  // Pointed sword tip
  const tipH = bladeLength * 0.18;
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.034, tipH, 4), {
      scale: [1.0, 1.0, 0.35],
      rotation: [pointingDown ? Math.PI : 0, Math.PI / 4, 0],
      position: [px, py + dir * (bladeH + tipH * 0.5 + 0.01), pz]
    })
  );
  // Gold central fuller inlay near hilt
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.012, bladeH * 0.55, 0.017), {
      rotation: rot,
      position: [px, py + dir * (bladeH * 0.3), pz]
    })
  );
}

/**
 * Adds rounded shoulder pauldrons with gleaming gold rims and articulated arms.
 */
function addPauldronsAndArms(
  shoulderX: number,
  shoulderY: number,
  handZ: number,
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[]
): void {
  for (const side of [-1, 1]) {
    // Spherical shoulder pauldron
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(0.105, 14, 12), {
        scale: [1.05, 0.92, 1.08],
        position: [side * shoulderX, shoulderY, 0.01]
      })
    );
    // Gold pauldron rim
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.098, 0.015, 8, 18), {
        rotation: [Math.PI / 2 + 0.15, side * 0.45, 0],
        position: [side * shoulderX, shoulderY - 0.03, 0.01]
      })
    );
    // Upper & forearm armor cylinder reaching forward
    bodyList.push(
      prepGeo(new THREE.CylinderGeometry(0.048, 0.042, 0.22, 10), {
        rotation: [0.65, 0, side * -0.15],
        position: [side * (shoulderX + 0.01), shoulderY - 0.11, handZ * 0.5]
      })
    );
    // Gauntlet hand sphere
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(0.048, 10, 10), {
        position: [side * (shoulderX + 0.01), shoulderY - 0.16, handZ]
      })
    );
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.044, 0.01, 8, 12), {
        rotation: [Math.PI / 2 + 0.5, 0, 0],
        position: [side * (shoulderX + 0.01), shoulderY - 0.13, handZ * 0.78]
      })
    );
  }
}

/**
 * Adds vertical gold robe/skirt trim strips around a conical lower body (matching the reference figures).
 */
function addSkirtGoldStrips(
  count: number,
  radiusBottom: number,
  radiusTop: number,
  yBottom: number,
  yTop: number,
  goldList: THREE.BufferGeometry[]
): void {
  const height = yTop - yBottom;
  const midY = (yBottom + yTop) * 0.5;
  const midR = (radiusBottom + radiusTop) * 0.5 + 0.014;
  const slopeAngle = Math.atan2(radiusBottom - radiusTop, height);

  for (let i = 0; i < count; i++) {
    const theta = (i * Math.PI * 2) / count + Math.PI / count;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.018, height, 0.018), {
        rotation: [-Math.sin(theta) * slopeAngle, -theta, Math.cos(theta) * slopeAngle],
        position: [Math.cos(theta) * midR, midY, Math.sin(theta) * midR]
      })
    );
  }
}

/**
 * 1. PAWN (ARCANE ROYALTY) — Compact Vanguard Foot-Soldier with Minimal Rounded Cap & Pearl Silver Medallion
 */
function buildPawnGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.32, segs, bodyList, goldList);

  // Compact Armored Skirt (Tassets) + Cuirass Torso + Rounded Kettle Cap
  bodyList.push(
    createSculptedLathe(
      [
        [0.24, 0.16],
        [0.21, 0.30],
        [0.165, 0.44],
        [0.175, 0.58],
        [0.135, 0.66],
        [0.162, 0.75],
        [0.145, 0.83],
        [0.092, 0.865],
        [0.001, 0.87]
      ],
      segs
    )
  );

  addSkirtGoldStrips(8, 0.236, 0.168, 0.17, 0.44, goldList);
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.17, 0.016, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.44, 0]
    })
  );
  // Compact Rounded Cap Rim (kept noticeably smaller than major pieces)
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.168, 0.014, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.74, 0]
    })
  );

  // Low Tucked Vanguard Arms, Heater Shield & Short Broadsword (kept well below cap for clean top silhouette)
  addPauldronsAndArms(0.165, 0.55, 0.12, bodyList, goldList);
  addCrossHeaterShield([-0.14, 0.42, 0.16], [0.06, -0.22, 0], 0.72, bodyList, goldList);
  addMedievalSword([0.16, 0.36, 0.13], [0.06, 0, 0], 0.34, false, goldList, steelList);

  // Top Identifier: Pearl Silver Single Dot Medallion in contrasting gold bezel
  addPawnTopDotEmblem(0.866, 1.0, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

/**
 * 2. ROOK (ARCANE ROYALTY) — Square Castellated Citadel Keep with Angular Battlements & Emerald Fortress Rune
 */
function buildRookGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.38, segs, bodyList, goldList);

  // Tapered Square Stone Citadel Tower Shaft (unmistakably square/angular rather than circular!)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.27, 0.33, 0.78, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 0.55, 0],
      flatShaded: detail === 'low'
    })
  );
  // Subtle sculpted round-corner buttress columns at the 4 corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bodyList.push(
        prepGeo(new THREE.CylinderGeometry(0.068, 0.082, 0.80, detail === 'high' ? 12 : 6), {
          position: [sx * 0.175, 0.56, sz * 0.175]
        })
      );
    }
  }

  // Horizontal Gold Fortress Bands
  for (const [by, bw] of [
    [0.34, 0.45],
    [0.66, 0.42],
    [0.95, 0.48]
  ]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(bw, 0.032, bw), {
        position: [0, by, 0]
      })
    );
  }

  // Front & Back Gothic Keep Gateways
  for (const dir of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.14, 0.32, 0.035), {
        position: [0, 0.36, dir * 0.235]
      })
    );
    steelList.push(
      prepGeo(new THREE.BoxGeometry(0.10, 0.28, 0.04), {
        position: [0, 0.35, dir * 0.238]
      })
    );
  }

  // Flared Square Battlement Cornice & Flat Parapet Deck (y = 1.04)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.49, 0.09, 0.49), {
      position: [0, 1.00, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.51, 0.026, 0.51), {
      position: [0, 1.038, 0]
    })
  );

  // 4 Prominent Square Corner Merlon Bastions (with wide open cardinal embrasures!)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mx = sx * 0.178;
      const mz = sz * 0.178;
      bodyList.push(
        prepGeo(new THREE.BoxGeometry(0.132, 0.14, 0.132), {
          position: [mx, 1.11, mz]
        })
      );
      goldList.push(
        prepGeo(new THREE.BoxGeometry(0.144, 0.026, 0.144), {
          position: [mx, 1.185, mz]
        })
      );
    }
  }

  // Top Identifier: Emerald Green Fortress / Tower Rune on the flat square parapet deck
  addRookTopFortressEmblem(1.046, 0.98, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

/**
 * 3. KNIGHT (ARCANE ROYALTY) — Armored Royal Destrier Warhorse with Directional Snout/Mane & Ember Red Horse Crest
 */
function buildKnightGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const ringSegs = detail === 'high' ? 18 : 10;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.38, segs, bodyList, goldList);

  // Lower Armored Caparison / Barding Skirt
  bodyList.push(
    createSculptedLathe(
      [
        [0.29, 0.16],
        [0.26, 0.34],
        [0.21, 0.48],
        [0.001, 0.50]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.285, 0.215, 0.17, 0.47, goldList);

  // Commanding Asymmetric Armored Warhorse Neck, Poll, Forehead & Forward-Projecting Snout (+Z)
  const horseSpine = [
    { y: 0.38, z: -0.02, rx: 0.175, rz: 0.195, pitch: -0.15 },
    { y: 0.62, z: 0.02, rx: 0.150, rz: 0.180, pitch: -0.18 },
    { y: 0.88, z: 0.04, rx: 0.132, rz: 0.165, pitch: 0.05 },
    { y: 1.09, z: 0.07, rx: 0.118, rz: 0.150, pitch: 0.42 }, // Poll / Crown
    { y: 1.04, z: 0.20, rx: 0.096, rz: 0.118, pitch: 1.08 }, // Forehead
    { y: 0.91, z: 0.31, rx: 0.072, rz: 0.086, pitch: 1.32 }, // Nasal bridge
    { y: 0.82, z: 0.37, rx: 0.056, rz: 0.066, pitch: 1.40 } // Tapered muzzle
  ];
  bodyList.push(createLoftedOrganicMesh(horseSpine, ringSegs));

  // Alert Twin Sculpted Horse Ears framing the crown
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.036, 0.15, 6), {
        rotation: [-0.22, 0, side * -0.22],
        position: [side * 0.095, 1.18, -0.02]
      })
    );
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.018, 8, 8), {
        position: [side * 0.092, 1.02, 0.16]
      })
    );
  }

  // Regal Golden Chamfron Nose-Armor + Ember-Red Nasal Accent Stripe
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.078, 0.30, 4), {
      scale: [0.95, 1.0, 0.34],
      rotation: [2.22, Math.PI / 4, 0],
      position: [0, 0.96, 0.28]
    })
  );
  markerList.push(
    prepGeo(new THREE.BoxGeometry(0.036, 0.024, 0.19), {
      rotation: [0.66, 0, 0],
      position: [0, 0.99, 0.265],
      flatShaded: true
    })
  );

  // Flowing Sculpted Mane Plates sweeping down the back spine (-Z) for dramatic asymmetric silhouette
  for (let m = 0; m < 6; m++) {
    const t = m / 5;
    const my = 0.48 + t * 0.58;
    const mz = -0.15 - Math.sin(t * Math.PI) * 0.055;
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.068, 0.13, 0.11), {
        rotation: [0.32 - t * 0.38, 0, 0],
        position: [0, my, mz]
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.032, 0.11, 0.035), {
        rotation: [0.32 - t * 0.38, 0, 0],
        position: [0, my + 0.01, mz - 0.048]
      })
    );
  }

  // Low Flank Crusader Shield (-X) & Couched Lance (+X) kept low so horse head dominates top-down view
  addCrossHeaterShield([-0.21, 0.52, 0.04], [0, -Math.PI * 0.42, 0], 0.72, bodyList, goldList);
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.020, 0.42, 8), {
      rotation: [1.18, 0, 0],
      position: [0.21, 0.54, 0.02]
    })
  );
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.032, 0.28, 8), {
      rotation: [1.18, 0, 0],
      position: [0.21, 0.65, 0.25]
    })
  );

  // Top Identifier: Ember Red Stylized Horse-Head Crest integrated onto the upper poll/crown
  addKnightTopHorseEmblem(1.155, 0.04, 0.96, 0.05, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

/**
 * 4. BISHOP (ARCANE ROYALTY) — Cathedral Prelate with Divided Cleft Mitre & Arcane Cyan Sacred Diamond
 */
function buildBishopGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.36, segs, bodyList, goldList);

  // Tall Pleated Ecclesiastical Cassock Robe
  bodyList.push(
    createSculptedLathe(
      [
        [0.28, 0.16],
        [0.24, 0.42],
        [0.20, 0.72],
        [0.21, 0.94],
        [0.145, 1.02],
        [0.001, 1.04]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.275, 0.205, 0.17, 0.72, goldList);

  // Gold Waist Cincture & Front Stole
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.208, 0.017, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.72, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.062, 0.46, 0.022), {
      rotation: [-0.08, 0, 0],
      position: [0, 0.48, 0.22]
    })
  );

  // Shoulder Pauldrons, Arms, Cleric Head & Face
  addPauldronsAndArms(0.195, 0.88, 0.14, bodyList, goldList);
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.112, 0.108, 0.16, 16), {
      position: [0, 1.08, 0.01]
    })
  );
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.SphereGeometry(0.014, 8, 8), {
        position: [side * 0.04, 1.10, 0.108]
      })
    );
  }

  // Pointed Angular Divided/Cleft Cathedral Mitre (physically split into two angled pointed mitre lobes!)
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.155, 0.018, 8, segs), {
      scale: [0.86, 1.12, 1.0],
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.16, 0]
    })
  );
  // Base cushion of the mitre (closed surface so Markers OFF still looks complete)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.135, 0.152, 0.16, segs), {
      scale: [0.85, 1.0, 1.14],
      position: [0, 1.24, 0]
    })
  );
  // Two Physically Split Pointed Mitre Crests separated by a clear diagonal cleft channel!
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.105, 0.24, 4), {
        scale: [0.72, 1.0, 1.38],
        rotation: [0, Math.PI / 4 + 0.35, side * -0.24],
        position: [side * 0.078, 1.33, side * 0.032],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.022, 0.21, 0.15), {
        rotation: [0, 0.35, side * -0.24],
        position: [side * 0.115, 1.31, side * 0.045]
      })
    );
  }

  // Tucked Spiraled Golden Crosier Staff (+X = 0.20, kept below y = 1.12 so mitre dominates overhead!)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.020, 0.86, 10), {
      position: [0.20, 0.58, 0.10]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.088, 0.020, 10, 18, Math.PI * 1.65), {
      rotation: [0, Math.PI / 2, Math.PI * 0.15],
      position: [0.20, 1.05, 0.10]
    })
  );

  // Scripture Tome held at chest (-X = -0.17)
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.14, 0.18, 0.042), {
      rotation: [-0.35, -0.25, 0],
      position: [-0.17, 0.74, 0.19]
    })
  );

  // Top Identifier: Arcane Cyan Sacred Diamond nestled inside the divided mitre cleft
  addBishopTopDiamondEmblem(1.322, 1.02, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

/**
 * 5. QUEEN (ARCANE ROYALTY) — Sovereign Empress with Wide 8-Point Radial Coronet & Amethyst 8-Point Star
 */
function buildQueenGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 32 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.39, segs, bodyList, goldList);

  // Sweeping Pleated Royal Gown + Cinched Waist + Upper Torso
  bodyList.push(
    createSculptedLathe(
      [
        [0.30, 0.16],
        [0.26, 0.48],
        [0.20, 0.80],
        [0.21, 1.04],
        [0.145, 1.13],
        [0.001, 1.15]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.295, 0.205, 0.17, 0.80, goldList);

  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.208, 0.018, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.80, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.158, 0.016, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.12, 0]
    })
  );

  // Shoulder Pauldrons, Arms, Sculpted Queen Head & Veil
  addPauldronsAndArms(0.21, 0.98, 0.14, bodyList, goldList);
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.112, 0.108, 0.19, 18), {
      position: [0, 1.23, 0.01]
    })
  );
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.SphereGeometry(0.013, 8, 8), {
        position: [side * 0.04, 1.25, 0.108]
      })
    );
  }

  // Wide Flared 8-Point Radial Sovereign Coronet (markedly more radial & starburst than King!)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.178, 0.132, 0.085, 16), {
      position: [0, 1.345, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.178, 0.017, 8, 24), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.385, 0]
    })
  );

  // 8 Prominent Outward-Flaring Radial Crown Petals / Points
  const crownPoints = 8;
  for (let i = 0; i < crownPoints; i++) {
    const angle = (i * Math.PI * 2) / crownPoints;
    const tilt = 0.52;
    const r = 0.192;
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.042, 0.145, 4), {
        rotation: [Math.cos(angle) * tilt, angle, -Math.sin(angle) * tilt],
        position: [Math.sin(angle) * r, 1.435, Math.cos(angle) * r],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.026, 0.155, 4), {
        rotation: [Math.cos(angle) * tilt, angle, -Math.sin(angle) * tilt],
        position: [Math.sin(angle) * (r + 0.012), 1.445, Math.cos(angle) * (r + 0.012)],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.016, 8, 8), {
        position: [Math.sin(angle) * 0.232, 1.495, Math.cos(angle) * 0.232]
      })
    );
  }

  // Tucked Royal Scepter (+X = 0.21, kept below y = 1.18 so the 8-point coronet is 100% unobstructed)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.020, 0.92, 8), {
      position: [0.21, 0.64, 0.10]
    })
  );
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.045, 0), {
      position: [0.21, 1.13, 0.10]
    })
  );

  // Royal Crest Plaque (-X = -0.18)
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.15, 0.22, 0.032), {
      rotation: [0.1, -0.2, 0],
      position: [-0.18, 0.80, 0.19]
    })
  );

  // Top Identifier: Amethyst Purple Eight-Pointed Gemstone Star in center of radial coronet
  addQueenTopEightPointStarEmblem(1.388, 1.04, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

/**
 * 6. KING (ARCANE ROYALTY) — Sovereign Monarch with Dominant 4-Arch Imperial Crown & Royal Gold Cross
 */
function buildKingGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 32 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.42, segs, bodyList, goldList);

  // Tall Broad Imperial Robe & Armored Chest
  bodyList.push(
    createSculptedLathe(
      [
        [0.34, 0.16],
        [0.30, 0.52],
        [0.25, 0.84],
        [0.27, 1.14],
        [0.18, 1.22],
        [0.001, 1.24]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.335, 0.252, 0.17, 0.84, goldList);

  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.255, 0.022, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.84, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.15, 0.18, 0.03), {
      position: [0, 1.03, 0.255]
    })
  );

  // Broad Imperial Shoulder Pauldrons & Arms Clasping the Royal Greatsword Hilt
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(0.122, 14, 12), {
        scale: [1.08, 0.92, 1.08],
        position: [side * 0.26, 1.10, 0.02]
      })
    );
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.114, 0.018, 8, 18), {
        rotation: [Math.PI / 2 + 0.15, side * 0.45, 0],
        position: [side * 0.26, 1.06, 0.02]
      })
    );
    bodyList.push(
      prepGeo(new THREE.CylinderGeometry(0.050, 0.046, 0.28, 10), {
        rotation: [0.85, 0, side * 0.65],
        position: [side * 0.15, 0.96, 0.16]
      })
    );
  }

  // Sculpted Bearded Monarch Head
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.132, 0.128, 0.21, 18), {
      position: [0, 1.33, 0.01]
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.18, 0.10, 0.11), {
      position: [0, 1.24, 0.092]
    })
  );
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.SphereGeometry(0.015, 8, 8), {
        position: [side * 0.046, 1.36, 0.132]
      })
    );
  }

  // Dominant Octagonal Sovereign Crown Cushion (uses faction body material so White vs Black is crystal clear!)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.185, 0.155, 0.11, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 1.46, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.162, 0.020, 8, 8), {
      rotation: [Math.PI / 2, 0, Math.PI / 8],
      position: [0, 1.415, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.188, 0.018, 8, 8), {
      rotation: [Math.PI / 2, 0, Math.PI / 8],
      position: [0, 1.515, 0]
    })
  );
  // 4 Bold Cardinal Sovereign Fleur-de-Lis Crown Bastions (0°, 90°, 180°, 270° — orthogonal vs Queen's 8-ray starburst!)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.075, 0.11, 0.042), {
        rotation: [0, -a, 0],
        position: [Math.sin(a) * 0.186, 1.555, Math.cos(a) * 0.186]
      })
    );
  }

  // Downward-Pointing Two-Handed Royal Greatsword in front (z = 0.27)
  addMedievalSword([0, 0.80, 0.27], [0, 0, 0], 0.60, true, goldList, steelList);

  // Top Identifier: Royal Gold Heraldic Cross Pattée + Vertical Sovereign Cross Crest
  addKingTopCrownCrossEmblem(1.516, 1.06, detail, goldList, steelList, markerList, true);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

// ============================================================================
// SKIN 2: RUNIC WARFORGED — Heavy Angular Battle-Construct Silhouettes
// ============================================================================

/**
 * Hexagonal forged-anvil pedestal with 6 projecting cog/gear teeth around the base
 * so Runic Warforged pieces have an unmistakable heavy gear-cog footprint from top-down.
 */
function addWarforgedPedestal(
  baseRadius: number,
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[],
  steelList: THREE.BufferGeometry[]
): void {
  // Lower 6-sided forged anvil base
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(baseRadius * 0.94, baseRadius * 1.02, 0.08, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.04, 0],
      flatShaded: true
    })
  );

  // 6 Projecting Iron & Gold Gear Cog Teeth around the perimeter
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    const rx = Math.cos(a) * (baseRadius * 0.96);
    const rz = Math.sin(a) * (baseRadius * 0.96);
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.09, 0.075, 0.09), {
        rotation: [0, -a, 0],
        position: [rx, 0.042, rz],
        flatShaded: true
      })
    );
    steelList.push(
      prepGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 6), {
        position: [rx, 0.05, rz]
      })
    );
  }

  // Upper beveled hexagonal plinth + thick runic bronze collar
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(baseRadius * 0.78, baseRadius * 0.88, 0.08, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.12, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(baseRadius * 0.80, 0.024, 6, 6), {
      rotation: [Math.PI / 2, 0, Math.PI / 6],
      position: [0, 0.16, 0],
      flatShaded: true
    })
  );
}

/**
 * Adds a heavy rectangular notched Tower-Pavise Shield with a forged runic chevron emblem.
 */
function addWarforgedTowerShield(
  pos: [number, number, number],
  rot: [number, number, number],
  scale: number,
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[],
  steelList: THREE.BufferGeometry[]
): void {
  const [px, py, pz] = pos;
  // Thick angular tower shield slab
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.25 * scale, 0.42 * scale, 0.05 * scale), {
      rotation: rot,
      position: [px, py, pz],
      flatShaded: true
    })
  );
  // Heavy gold outer frame & horizontal war-bars
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.275 * scale, 0.44 * scale, 0.036 * scale), {
      rotation: rot,
      position: [px, py, pz - 0.006 * scale],
      flatShaded: true
    })
  );
  // Diamond runic core boss in front of shield
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.075 * scale, 0), {
      rotation: rot,
      position: [px, py + 0.02 * scale, pz + 0.032 * scale],
      flatShaded: true
    })
  );
  steelList.push(
    prepGeo(new THREE.BoxGeometry(0.04 * scale, 0.34 * scale, 0.06 * scale), {
      rotation: rot,
      position: [px, py, pz + 0.008 * scale]
    })
  );
}

/**
 * Adds a double-bitted forged Runic Battleaxe / Warhammer.
 */
function addWarforgedBattleaxe(
  pos: [number, number, number],
  rot: [number, number, number],
  scale: number,
  goldList: THREE.BufferGeometry[],
  steelList: THREE.BufferGeometry[]
): void {
  const [px, py, pz] = pos;
  const [rx, ry, rz] = rot;
  // Heavy haft
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.022 * scale, 0.026 * scale, 0.72 * scale, 6), {
      rotation: [rx, ry, rz],
      position: [px, py + 0.24 * scale, pz]
    })
  );
  // Twin crescent/wedge axe blades at top
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.ConeGeometry(0.14 * scale, 0.18 * scale, 4), {
        scale: [0.28, 1.0, 1.15],
        rotation: [rx, ry, rz + side * (Math.PI / 2)],
        position: [px, py + 0.50 * scale, pz + side * 0.08 * scale],
        flatShaded: true
      })
    );
  }
  // Top armor-piercing spike
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.032 * scale, 0.16 * scale, 4), {
      rotation: [rx, ry, rz],
      position: [px, py + 0.66 * scale, pz],
      flatShaded: true
    })
  );
}

function buildWarforgedPawnGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 12 : 6;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.34, bodyList, goldList, steelList);

  // Compact 6-sided faceted construct torso & armored skirt (noticeably shorter & simpler than major pieces!)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.19, 0.26, 0.38, segs), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.35, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.31, 0.24, 0.26), {
      position: [0, 0.60, 0],
      flatShaded: true
    })
  );
  for (const y of [0.32, 0.52, 0.68]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.33, 0.03, 0.28), {
        position: [0, y, 0],
        flatShaded: true
      })
    );
  }

  // Compact tucked shoulder guards (no wide horns or spikes that could mimic King/Knight!)
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.11, 0.13, 0.17), {
        rotation: [0, 0, side * -0.18],
        position: [side * 0.18, 0.64, 0.01],
        flatShaded: true
      })
    );
  }

  // Clean Compact Forged Dome Greathelm Cap (unmistakable rounded-hex Pawn cap from overhead!)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.152, 0.158, 0.13, segs), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.78, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(0.156, segs, 6, 0, Math.PI * 2, 0, Math.PI * 0.52), {
      scale: [1.0, 0.42, 1.0],
      position: [0, 0.84, 0],
      flatShaded: true
    })
  );
  // Front visor slit
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.032, 0.036), {
      position: [0, 0.79, 0.145],
      flatShaded: true
    })
  );

  // Tucked Low Tower Pavise Shield & Compact Hand-Axe (strictly below helm height)
  addWarforgedTowerShield([-0.16, 0.45, 0.18], [-0.08, -0.22, 0], 0.78, bodyList, goldList, steelList);
  addWarforgedBattleaxe([0.19, 0.34, 0.15], [0.14, 0, 0], 0.72, goldList, steelList);

  // Top Identifier: Pearl Silver Forged Rivet Single Dot Medallion
  addPawnTopDotEmblem(0.895, 0.98, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildWarforgedRookGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 12 : 6;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.41, bodyList, goldList, steelList);

  // Massive Sloped Square Iron Juggernaut Citadel Tower
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.27, 0.34, 0.84, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 0.58, 0],
      flatShaded: true
    })
  );
  // Inner cylindrical structural drum for rich bevel highlights & LOD scaling
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.22, 0.25, 0.82, segs), {
      position: [0, 0.58, 0],
      flatShaded: true
    })
  );

  // Heavy Horizontal Forged Gold Armor Straps
  for (const y of [0.35, 0.64, 0.92]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.50, 0.042, 0.50), {
        position: [0, y, 0],
        flatShaded: true
      })
    );
  }

  // Broad Flat Square Citadel Parapet Deck (faction body material so White vs Black is unmistakable!)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.50, 0.09, 0.50), {
      position: [0, 1.01, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.53, 0.032, 0.53), {
      position: [0, 0.965, 0],
      flatShaded: true
    })
  );

  // 4 Bold Square Corner Fortress Buttress Pylons & Crenellated Merlons (90° square fortress silhouette!)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * 0.185;
      const cz = sz * 0.185;
      bodyList.push(
        prepGeo(new THREE.BoxGeometry(0.155, 0.94, 0.155), {
          position: [cx, 0.62, cz],
          flatShaded: true
        })
      );
      bodyList.push(
        prepGeo(new THREE.BoxGeometry(0.145, 0.13, 0.145), {
          position: [cx, 1.115, cz],
          flatShaded: true
        })
      );
      goldList.push(
        prepGeo(new THREE.BoxGeometry(0.158, 0.028, 0.158), {
          position: [cx, 1.185, cz],
          flatShaded: true
        })
      );
    }
  }

  // Top Identifier: Emerald Green Mechanical Fortress / Castle Tower Emblem on flat square deck
  addRookTopFortressEmblem(1.055, 1.02, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildWarforgedKnightGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 14 : 8;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.39, bodyList, goldList, steelList);

  // Armored Construct Base Chassis
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.24, 0.31, 0.36, segs), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.33, 0],
      flatShaded: true
    })
  );

  // Prominent Asymmetric Mechanized Warhorse Neck, Poll & Forward-Projecting Snout (+Z)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.25, 0.56, 0.32), {
      rotation: [0.22, 0, 0],
      position: [0, 0.72, 0.03],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.14, 0.15, 0.22, segs), {
      scale: [0.95, 1.0, 1.18],
      position: [0, 1.03, 0.04],
      flatShaded: true
    })
  );
  // Long Tapered Armored Horse Snout projecting forward to z = +0.37 (unmistakable horse profile from above!)
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.155, 0.44, 4), {
      scale: [0.85, 1.0, 0.92],
      rotation: [Math.PI * 0.58, Math.PI / 4, 0],
      position: [0, 0.94, 0.24],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.11, 0.055, 0.28), {
      rotation: [0.30, 0, 0],
      position: [0, 1.01, 0.22],
      flatShaded: true
    })
  );
  // Ember Red Forged Chamfron Nasal Accent Stripe along snout bridge
  markerList.push(
    prepGeo(new THREE.BoxGeometry(0.044, 0.032, 0.20), {
      rotation: [0.30, 0, 0],
      position: [0, 1.032, 0.24],
      flatShaded: true
    })
  );

  // Swept Armored Warhorse Ears at Crown
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.042, 0.19, 4), {
        rotation: [-0.28, 0, side * -0.22],
        position: [side * 0.095, 1.18, -0.03],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.02, 8, 8), {
        position: [side * 0.115, 1.00, 0.14]
      })
    );
  }

  // Prominent Saw-Toothed Dorsal Metal Mane Crest along back spine (-Z)
  for (let i = 0; i < 5; i++) {
    const fy = 0.54 + i * 0.135;
    const fz = -0.14 - Math.sin((i / 4) * Math.PI) * 0.05;
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.068, 0.12, 0.16), {
        rotation: [0.45, 0, 0],
        position: [0, fy, fz],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.036, 0.13, 0.17), {
        rotation: [0.45, 0, 0],
        position: [0, fy + 0.01, fz - 0.02],
        flatShaded: true
      })
    );
  }

  // Tucked Low Flank Shield & Lance (kept low at y <= 0.65 so horse silhouette dominates from top-down!)
  addWarforgedTowerShield([-0.21, 0.52, 0.06], [0, -Math.PI * 0.42, 0], 0.72, bodyList, goldList, steelList);
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.048, 0.42, 4), {
      rotation: [1.32, Math.PI / 4, 0],
      position: [0.21, 0.58, 0.16],
      flatShaded: true
    })
  );

  // Top Identifier: Ember Red Stylized Horse-Head Crest on upper horse poll
  addKnightTopHorseEmblem(1.135, 0.04, 0.96, 0.06, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildWarforgedBishopGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 12 : 6;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.38, bodyList, goldList, steelList);

  // Tall 6-sided Armored Runic Inquisitor Cassock
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.18, 0.28, 0.84, segs), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.57, 0],
      flatShaded: true
    })
  );
  for (const y of [0.36, 0.64, 0.90]) {
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.23 - (y - 0.36) * 0.08, 0.020, 6, 6), {
        rotation: [Math.PI / 2, 0, Math.PI / 6],
        position: [0, y, 0],
        flatShaded: true
      })
    );
  }

  // Compact Angular Inquisitor Shoulder Mantle
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.40, 0.14, 0.25), {
      position: [0, 0.96, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.42, 0.034, 0.27), {
      position: [0, 1.03, 0],
      flatShaded: true
    })
  );

  // Inquisitor Helm Collar + Physically Divided 2-Blade Split Forged Mitre (unmistakable cleft mitre!)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.145, 0.155, 0.15, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 1.12, 0],
      flatShaded: true
    })
  );
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.095, 0.28, 4), {
        scale: [0.85, 1.0, 1.25],
        rotation: [0, Math.PI / 4, side * -0.24],
        position: [side * 0.085, 1.28, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.032, 0.25, 0.15), {
        rotation: [0, 0, side * -0.24],
        position: [side * 0.125, 1.27, 0],
        flatShaded: true
      })
    );
  }
  // Closed cleft cradle deck between the twin mitre blades
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.08, 0.24), {
      position: [0, 1.23, 0],
      flatShaded: true
    })
  );

  // Tucked Runic Tuning-Fork Halberd (+X = 0.21, kept below y = 1.08 so split mitre dominates overhead!)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.020, 0.022, 0.90, 6), {
      position: [0.21, 0.60, 0.10]
    })
  );
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.BoxGeometry(0.026, 0.16, 0.04), {
        position: [0.21 + side * 0.048, 1.06, 0.10],
        flatShaded: true
      })
    );
  }
  // Left Hand: Forged Runic Stone Tablet
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.14, 0.20, 0.05), {
      rotation: [-0.22, -0.2, 0],
      position: [-0.18, 0.72, 0.17],
      flatShaded: true
    })
  );

  // Top Identifier: Arcane Cyan Sacred 4-Point Diamond nestled inside the split forged mitre cleft
  addBishopTopDiamondEmblem(1.272, 1.02, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildWarforgedQueenGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 16 : 8;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.40, bodyList, goldList, steelList);

  // Faceted Armored Valkyrie War-Gown & Cuirass
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.20, 0.30, 0.74, segs), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 0.52, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.21, 0.17, 0.32, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 0.98, 0],
      flatShaded: true
    })
  );

  // Compact Swept Valkyrie Shoulder Pauldrons (kept at y <= 1.12 so radial 8-blade crown shines cleanly!)
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.14, 0.16, 0.17), {
        position: [side * 0.21, 1.00, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.085, 0.28, 4), {
        scale: [0.35, 1.0, 0.85],
        rotation: [-0.22, 0, side * -0.48],
        position: [side * 0.26, 1.05, -0.04],
        flatShaded: true
      })
    );
  }

  // Valkyrie Helm + Wide Flared 8-Blade Radial War-Coronet around an Open Faction Crown Deck!
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.182, 0.138, 0.24, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 1.26, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.184, 0.018, 6, 8), {
      rotation: [Math.PI / 2, 0, Math.PI / 8],
      position: [0, 1.38, 0],
      flatShaded: true
    })
  );
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    const tilt = 0.54;
    const r = 0.196;
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.042, 0.15, 4), {
        rotation: [Math.cos(a) * tilt, a, -Math.sin(a) * tilt],
        position: [Math.sin(a) * r, 1.43, Math.cos(a) * r],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.028, 0.16, 4), {
        rotation: [Math.cos(a) * tilt, a, -Math.sin(a) * tilt],
        position: [Math.sin(a) * (r + 0.014), 1.44, Math.cos(a) * (r + 0.014)],
        flatShaded: true
      })
    );
  }

  // Tucked Runic War-Glaive (+X = 0.23, top <= 1.16) & Hexagonal Aegis Shield
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.020, 0.022, 0.94, 6), {
      position: [0.23, 0.62, 0.10]
    })
  );
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.065, 0.22, 4), {
      scale: [0.35, 1.0, 1.0],
      position: [0.23, 1.14, 0.10],
      flatShaded: true
    })
  );
  addWarforgedTowerShield([-0.20, 0.72, 0.16], [0.05, -0.25, 0], 0.74, bodyList, goldList, steelList);

  // Top Identifier: Amethyst Purple Eight-Pointed Star in center of radial war-coronet
  addQueenTopEightPointStarEmblem(1.382, 1.04, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildWarforgedKingGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 16 : 8;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.43, bodyList, goldList, steelList);

  // Colossal Faceted Runic War-Emperor Juggernaut Torso
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.24, 0.34, 0.84, segs), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 0.56, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.48, 0.34, 0.34), {
      position: [0, 1.06, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.095, 0), {
      position: [0, 1.06, 0.18],
      flatShaded: true
    })
  );

  // Heavy Fortress Shoulder Pauldrons (kept below crown deck so Sovereign Crown dominates overhead!)
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.18, 0.24, 0.30), {
        rotation: [0, 0, side * -0.15],
        position: [side * 0.28, 1.10, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.19, 0.04, 0.31), {
        rotation: [0, 0, side * -0.15],
        position: [side * 0.28, 1.22, 0],
        flatShaded: true
      })
    );
  }

  // Dominant Octagonal Forged Sovereign Crown + 4 Orthogonal Cardinal Crown Bastions
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.192, 0.162, 0.28, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 1.36, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.195, 0.020, 6, 8), {
      rotation: [Math.PI / 2, 0, Math.PI / 8],
      position: [0, 1.50, 0],
      flatShaded: true
    })
  );
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.082, 0.12, 0.048), {
        rotation: [0, -a, 0],
        position: [Math.sin(a) * 0.192, 1.545, Math.cos(a) * 0.192],
        flatShaded: true
      })
    );
  }

  // Broad-Bladed Runic Executioner Greatsword planted in front (z = 0.26)
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.28, 0.048, 0.055), {
      position: [0, 0.90, 0.26],
      flatShaded: true
    })
  );
  steelList.push(
    prepGeo(new THREE.BoxGeometry(0.11, 0.70, 0.034), {
      position: [0, 0.53, 0.26],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.032, 0.62, 0.040), {
      position: [0, 0.55, 0.26]
    })
  );

  // Top Identifier: Royal Gold Heraldic Cross Pattée + Sovereign Vertical Cross Crest
  addKingTopCrownCrossEmblem(1.502, 1.06, detail, goldList, steelList, markerList, true);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

// ============================================================================
// SKIN 3: MYSTIC SANCTUM — Spire-Like Celestial Wizard & Floating Ring Motifs
// ============================================================================

/**
 * Smooth chalice pedestal with a signature levitating golden astrolabe ring hovering
 * around the piece's waist so every Mystic Sanctum piece has an unmistakable celestial silhouette.
 */
function addSanctumPedestal(
  baseRadius: number,
  segs: number,
  ringHeight: number,
  ringRadius: number,
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[]
): void {
  bodyList.push(
    createSculptedLathe(
      [
        [baseRadius, 0.0],
        [baseRadius, 0.05],
        [baseRadius * 0.86, 0.09],
        [baseRadius * 0.76, 0.16],
        [0.001, 0.16]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(baseRadius * 0.97, 0.018, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.05, 0]
    })
  );
  // Signature Levitating Golden Astrolabe Ring hovering subtly around the lower waist (kept compact so overhead silhouettes stay crystal-clear!)
  goldList.push(
    prepGeo(new THREE.TorusGeometry(ringRadius, 0.015, 8, segs), {
      rotation: [Math.PI / 2 + 0.16, 0, 0.12],
      position: [0, ringHeight, 0]
    })
  );
}

function buildSanctumPawnGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.33, segs, 0.44, 0.26, bodyList, goldList);

  // Sleek Compact Arcane Acolyte Robe & Rounded Hood Cap (shortest piece — no tall cone hat!)
  bodyList.push(
    createSculptedLathe(
      [
        [0.24, 0.15],
        [0.17, 0.44],
        [0.135, 0.66],
        [0.165, 0.78],
        [0.155, 0.85],
        [0.09, 0.875],
        [0.001, 0.88]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.162, 0.013, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.77, 0]
    })
  );

  // Tucked Low Crystal Wand (+X = 0.18, kept strictly below y = 0.74) & Low Mana Sphere (-X = -0.17)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.016, 0.56, 8), {
      position: [0.18, 0.42, 0.10]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.048, 0), {
      scale: [0.75, 1.35, 0.75],
      position: [0.18, 0.72, 0.10]
    })
  );
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.052, 10, 10), {
      position: [-0.17, 0.62, 0.13]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.082, 0.010, 6, 14), {
      rotation: [0.8, 0.4, 0],
      position: [-0.17, 0.62, 0.13]
    })
  );

  // Top Identifier: Pearl Silver Arcane Sigil Single Dot Medallion
  addPawnTopDotEmblem(0.876, 0.96, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildSanctumRookGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.38, segs, 0.50, 0.30, bodyList, goldList);

  // 4-Sided Arcane Sanctum Bastion Tower Core
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.24, 0.29, 0.82, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 0.56, 0],
      flatShaded: true
    })
  );
  // Subtle Side Crystal Buttress Fins
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const fx = Math.cos(a) * 0.21;
    const fz = Math.sin(a) * 0.21;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.032, 0.54, 0.032), {
        position: [fx, 0.58, fz]
      })
    );
  }

  // Broad Square Astral Bastion Parapet Deck (0.48 x 0.48 — bold 90° square fortress top silhouette!)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.48, 0.09, 0.48), {
      position: [0, 1.01, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.51, 0.028, 0.51), {
      position: [0, 0.965, 0],
      flatShaded: true
    })
  );

  // 4 Square Corner Crystal-Capped Merlon Pylons at (±0.178, ±0.178)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * 0.178;
      const cz = sz * 0.178;
      bodyList.push(
        prepGeo(new THREE.BoxGeometry(0.125, 0.135, 0.125), {
          position: [cx, 1.115, cz],
          flatShaded: true
        })
      );
      goldList.push(
        prepGeo(new THREE.BoxGeometry(0.136, 0.024, 0.136), {
          position: [cx, 1.185, cz],
          flatShaded: true
        })
      );
      steelList.push(
        prepGeo(new THREE.OctahedronGeometry(0.042, 0), {
          scale: [0.85, 1.15, 0.85],
          position: [cx, 1.225, cz],
          flatShaded: true
        })
      );
    }
  }

  // Top Identifier: Emerald Green Astral Fortress / Castle Tower Emblem on square parapet deck
  addRookTopFortressEmblem(1.055, 1.0, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildSanctumKnightGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const ringSegs = detail === 'high' ? 16 : 10;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.37, segs, 0.44, 0.29, bodyList, goldList);

  // Graceful Prominent Astral Steed / Unicorn Neck, Broad Poll & Forward-Projecting Snout (+Z)
  const unicornSpine = [
    { y: 0.16, z: -0.02, rx: 0.23, rz: 0.23, pitch: 0 },
    { y: 0.46, z: 0.03, rx: 0.17, rz: 0.19, pitch: -0.14 },
    { y: 0.78, z: 0.06, rx: 0.145, rz: 0.175, pitch: 0.08 },
    { y: 1.03, z: 0.07, rx: 0.138, rz: 0.165, pitch: 0.36 },
    { y: 0.96, z: 0.22, rx: 0.105, rz: 0.125, pitch: 0.92 },
    { y: 0.88, z: 0.36, rx: 0.072, rz: 0.085, pitch: 1.28 }
  ];
  bodyList.push(createLoftedOrganicMesh(unicornSpine, ringSegs));

  // Spiraled Golden Unicorn Horn projecting forward from the steed's brow (+Z)
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.032, 0.26, 8), {
      rotation: [0.95, 0, 0],
      position: [0, 1.07, 0.26]
    })
  );
  // Ember Red Astral Nasal Crest along snout bridge
  markerList.push(
    prepGeo(new THREE.BoxGeometry(0.038, 0.028, 0.18), {
      rotation: [0.38, 0, 0],
      position: [0, 1.01, 0.22],
      flatShaded: true
    })
  );

  // Alert Sculpted Astral Steed Ears & Flowing Crystalline Mane (-Z)
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.038, 0.15, 6), {
        rotation: [-0.22, 0, side * -0.18],
        position: [side * 0.082, 1.15, -0.01]
      })
    );
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.018, 8, 8), {
        position: [side * 0.108, 1.00, 0.14]
      })
    );
  }
  for (let m = 0; m < 5; m++) {
    const t = m / 4;
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.052, 0.16, 4), {
        rotation: [-0.85, 0, 0],
        position: [0, 0.56 + t * 0.48, -0.14 - Math.sin(t * Math.PI) * 0.05],
        flatShaded: true
      })
    );
  }

  // Compact Swept-Back Ethereal Flank Wing-Blades (tucked low at y <= 0.72 so horse head dominates overhead!)
  for (const side of [-1, 1]) {
    for (let f = 0; f < 2; f++) {
      const len = 0.36 - f * 0.08;
      const wy = 0.56 + f * 0.11;
      const wz = -0.05 - f * 0.05;
      bodyList.push(
        prepGeo(new THREE.ConeGeometry(0.048, len, 4), {
          scale: [0.35, 1.0, 1.0],
          rotation: [-0.75 - f * 0.15, side * 0.22, side * -0.28],
          position: [side * 0.19, wy, wz],
          flatShaded: true
        })
      );
    }
  }

  // Top Identifier: Ember Red Stylized Horse-Head Crest on upper steed poll
  addKnightTopHorseEmblem(1.11, 0.05, 0.94, 0.06, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildSanctumBishopGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.36, segs, 0.50, 0.28, bodyList, goldList);

  // Slender Sweeping Astral Seer Vestments
  bodyList.push(
    createSculptedLathe(
      [
        [0.27, 0.15],
        [0.19, 0.48],
        [0.145, 0.80],
        [0.175, 1.00],
        [0.125, 1.10],
        [0.001, 1.12]
      ],
      segs
    )
  );

  // Seer Head + Physically Divided Twin-Crystal Pointed Mitre Spire (unmistakable split mitre cleft!)
  faceList.push(
    prepGeo(new THREE.SphereGeometry(0.102, 14, 12), {
      position: [0, 1.16, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.135, 0.016, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.19, 0]
    })
  );
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.088, 0.27, 4), {
        scale: [0.85, 1.0, 1.25],
        rotation: [0, Math.PI / 4, side * -0.24],
        position: [side * 0.082, 1.29, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.042, 0.25, 4), {
        rotation: [0, Math.PI / 4, side * -0.24],
        position: [side * 0.115, 1.29, 0],
        flatShaded: true
      })
    );
  }
  // Closed crystal mitre cradle underneath the diamond emblem
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.115, 0.125, 0.08, 8), {
      position: [0, 1.24, 0]
    })
  );

  // Tucked Crescent-Moon Staff (+X = 0.20, kept below y = 1.08 so split crystal mitre dominates overhead!)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.018, 0.88, 8), {
      position: [0.20, 0.58, 0.10]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.072, 0.015, 8, 16, Math.PI * 1.4), {
      rotation: [0, Math.PI / 2, Math.PI * 0.3],
      position: [0.20, 1.05, 0.10]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.036, 0), {
      position: [0.20, 1.05, 0.10]
    })
  );

  // Top Identifier: Arcane Cyan Sacred 4-Point Diamond nestled inside the twin-crystal cleft
  addBishopTopDiamondEmblem(1.28, 1.02, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildSanctumQueenGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.38, segs, 0.54, 0.30, bodyList, goldList);

  // High-Collared Flowing Celestial Arch-Sorceress Gown
  bodyList.push(
    createSculptedLathe(
      [
        [0.29, 0.15],
        [0.21, 0.52],
        [0.155, 0.86],
        [0.195, 1.10],
        [0.13, 1.18],
        [0.001, 1.20]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.22, 0.018, 8, 20, Math.PI * 1.2), {
      rotation: [-0.35, 0, -Math.PI * 0.1],
      position: [0, 1.12, -0.03]
    })
  );

  // Sorceress Head + Wide Flared 8-Rayed Astral Sunburst Coronet around Open Faction Crown Dish!
  faceList.push(
    prepGeo(new THREE.SphereGeometry(0.108, 14, 12), {
      position: [0, 1.25, 0]
    })
  );
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.178, 0.132, 0.085, 16), {
      position: [0, 1.345, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.180, 0.016, 8, 24), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.385, 0]
    })
  );
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    const tilt = 0.54;
    const r = 0.192;
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.038, 0.145, 4), {
        rotation: [Math.cos(a) * tilt, a, -Math.sin(a) * tilt],
        position: [Math.sin(a) * r, 1.435, Math.cos(a) * r],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.024, 0.16, 4), {
        rotation: [Math.cos(a) * tilt, a, -Math.sin(a) * tilt],
        position: [Math.sin(a) * (r + 0.014), 1.448, Math.cos(a) * (r + 0.014)],
        flatShaded: true
      })
    );
  }

  // Tucked Astral Armillary Scepter (+X = 0.21, kept below y = 1.15)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.018, 0.94, 8), {
      position: [0.21, 0.62, 0.10]
    })
  );
  for (const rotZ of [0.45, -0.45]) {
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.068, 0.012, 8, 16), {
        rotation: [0.3, 0.4, rotZ],
        position: [0.21, 1.12, 0.10]
      })
    );
  }
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.038, 0), {
      position: [0.21, 1.12, 0.10]
    })
  );

  // Top Identifier: Amethyst Purple Eight-Pointed Star in center of astral coronet
  addQueenTopEightPointStarEmblem(1.388, 1.04, detail, goldList, markerList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildSanctumKingGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.41, segs, 0.56, 0.32, bodyList, goldList);

  // Grand Archmage Hierophant Spire Vestments
  bodyList.push(
    createSculptedLathe(
      [
        [0.32, 0.15],
        [0.25, 0.56],
        [0.19, 0.92],
        [0.24, 1.18],
        [0.16, 1.26],
        [0.001, 1.28]
      ],
      segs
    )
  );

  // Archmage Head + Dominant Octagonal 4-Arch Astral Sovereign Crown (faction body crown + 4 cardinal bastions!)
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.122, 0.118, 0.20, 16), {
      position: [0, 1.35, 0]
    })
  );
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.188, 0.155, 0.12, 8), {
      rotation: [0, Math.PI / 8, 0],
      position: [0, 1.46, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.190, 0.018, 8, 8), {
      rotation: [Math.PI / 2, 0, Math.PI / 8],
      position: [0, 1.52, 0]
    })
  );
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.075, 0.115, 0.044), {
        rotation: [0, -a, 0],
        position: [Math.sin(a) * 0.188, 1.558, Math.cos(a) * 0.188]
      })
    );
  }

  // Tucked Staff of the Cosmos held in front (+Z = 0.24, top <= 1.14 so Sovereign Crown is 100% unobstructed!)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.020, 0.022, 0.96, 8), {
      position: [0, 0.58, 0.24]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.078, 0.014, 8, 18), {
      position: [0, 1.10, 0.24]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.045, 0), {
      position: [0, 1.10, 0.24]
    })
  );

  // Top Identifier: Royal Gold Heraldic Cross Pattée + Sovereign Vertical Cross Crest
  addKingTopCrownCrossEmblem(1.52, 1.06, detail, goldList, steelList, markerList, true);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

// ============================================================================
// SKIN 4: CLASSIC STAUNTON CHESS SET ('classic')
// Traditional turned Staunton silhouettes: Baluster bases, Spherical Pawn,
// Crenelated Tower Rook, Carved Horse-Bust Knight, Slotted Mitre Bishop,
// Scalloped Coronet Queen, and Cross-Finial Staunton King.
// ============================================================================

function makeLathe(
  points: Array<[number, number]>,
  radialSegments: number
): THREE.BufferGeometry {
  return createSculptedLathe(points, radialSegments);
}

function addClassicStauntonBase(
  bodyList: THREE.BufferGeometry[],
  goldList: THREE.BufferGeometry[],
  segs: number,
  scale = 1.0
): void {
  const s = scale;
  bodyList.push(
    makeLathe(
      [
        [0.001, 0.0],
        [0.37 * s, 0.0],
        [0.38 * s, 0.035],
        [0.35 * s, 0.065],
        [0.36 * s, 0.095],
        [0.31 * s, 0.135],
        [0.24 * s, 0.185],
        [0.25 * s, 0.215],
        [0.21 * s, 0.24]
      ],
      segs
    )
  );
  // Subtle classic brass felt-pad ring at bottom & upper pedestal collar
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.365 * s, 0.012, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.035, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.245 * s, 0.011, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.205, 0]
    })
  );
}

function buildClassicPawnGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addClassicStauntonBase(bodyList, goldList, segs, 0.88);

  // Turned Staunton Pawn stem, flared collar disc, and spherical ball finial
  bodyList.push(
    makeLathe(
      [
        [0.185, 0.22],
        [0.145, 0.36],
        [0.115, 0.52],
        [0.105, 0.64],
        [0.185, 0.675],
        [0.19, 0.70],
        [0.11, 0.725],
        [0.001, 0.73]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.185, 0.01, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.688, 0]
    })
  );
  // Classic spherical Pawn head (subtly flattened at upper pole for clean flush enamel inlay)
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(0.162, segs, Math.max(12, Math.floor(segs * 0.7))), {
      scale: [1.0, 0.96, 1.0],
      position: [0, 0.852, 0]
    })
  );

  // Restrained Top Inlay: Pearl Silver flush medallion at Pawn pole
  addPawnTopDotEmblem(1.002, 0.90, detail, goldList, markerList, true);

  // Minimal hidden anchors for steel/face so multi-material pipeline stays uniform
  steelList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));
  faceList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildClassicRookGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addClassicStauntonBase(bodyList, goldList, segs, 0.98);

  // Classic tapered Staunton tower column flaring into a flat recessed turret deck (y = 1.015)
  bodyList.push(
    makeLathe(
      [
        [0.215, 0.22],
        [0.195, 0.42],
        [0.175, 0.68],
        [0.17, 0.82],
        [0.225, 0.88],
        [0.238, 0.94],
        [0.238, 1.015],
        [0.001, 1.015]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.228, 0.011, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.90, 0]
    })
  );

  // 4 Broad Championship Staunton Castellated Corner Battlements (4-merlon Staunton turret silhouette!)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bodyList.push(
        prepGeo(new THREE.BoxGeometry(0.118, 0.125, 0.118), {
          position: [sx * 0.138, 1.072, sz * 0.138]
        })
      );
    }
  }

  // Restrained Top Inlay: Emerald Green Fortress / Tower Inlay flush-set into the turret deck
  addRookTopFortressEmblem(1.016, 0.84, detail, goldList, markerList, true);

  steelList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));
  faceList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildClassicKnightGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 26 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addClassicStauntonBase(bodyList, goldList, segs, 0.98);

  // Pedestal transition plinth for the carved Staunton horse bust
  bodyList.push(
    makeLathe(
      [
        [0.21, 0.22],
        [0.22, 0.28],
        [0.19, 0.33],
        [0.001, 0.34]
      ],
      segs
    )
  );

  // Classic carved Staunton Horse Bust (muscular chest, arched neck, sculpted head & muzzle)
  const neckSegments: Array<{ pos: [number, number, number]; rx: number; ry: number; rz: number }> = [
    { pos: [0, 0.40, -0.01], rx: 0.165, ry: 0.14, rz: 0.185 },
    { pos: [0, 0.52, 0.01], rx: 0.155, ry: 0.14, rz: 0.18 },
    { pos: [0, 0.65, 0.02], rx: 0.145, ry: 0.14, rz: 0.175 },
    { pos: [0, 0.78, 0.01], rx: 0.135, ry: 0.135, rz: 0.168 },
    { pos: [0, 0.91, -0.01], rx: 0.128, ry: 0.13, rz: 0.16 },
    { pos: [0, 1.01, 0.02], rx: 0.122, ry: 0.105, rz: 0.155 }
  ];
  for (const s of neckSegments) {
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(1.0, 16, 12), {
        scale: [s.rx, s.ry, s.rz],
        position: s.pos
      })
    );
  }

  // Sculpted Horse Forehead, Bridge of Nose, and Tapered Muzzle (+Z forward, strictly within z <= 0.32)
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(1.0, 16, 12), {
      scale: [0.115, 0.105, 0.165],
      rotation: [0.42, 0, 0],
      position: [0, 0.97, 0.11]
    })
  );
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.068, 0.098, 0.25, 14), {
      rotation: [Math.PI * 0.38, 0, 0],
      position: [0, 0.90, 0.20]
    })
  );
  // Sculpted Snout & Nostrils
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(0.072, 14, 10), {
      scale: [1.05, 0.88, 1.12],
      position: [0, 0.845, 0.285]
    })
  );
  // Lower Jaw / Cheekbone definition
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(0.095, 14, 10), {
      scale: [1.12, 0.75, 1.0],
      position: [0, 0.90, 0.06]
    })
  );

  // Twin Alert Pointed Horse Ears flanking the upper poll inlay
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.035, 0.13, 8), {
        rotation: [-0.18, 0, side * -0.18],
        position: [side * 0.092, 1.155, -0.02]
      })
    );
    // Subtle brass eye accent
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.017, 8, 8), {
        position: [side * 0.098, 0.975, 0.11]
      })
    );
  }

  // Classic Carved Flowing Mane along the back spine (-Z)
  for (let m = 0; m < 7; m++) {
    const t = m / 6;
    const my = 0.42 + t * 0.62;
    const mz = -0.14 - Math.sin(t * Math.PI) * 0.048;
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.055, 0.11, 0.088), {
        rotation: [0.25 - t * 0.35, 0, 0],
        position: [0, my, mz]
      })
    );
  }

  // Restrained Top Inlay: Ember Red Horse-Head Crest cleanly set onto the upper crown poll between the ears (zero overlap!)
  addKnightTopHorseEmblem(1.112, 0.02, 0.76, 0.05, detail, goldList, markerList, true);

  steelList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));
  faceList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildClassicBishopGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addClassicStauntonBase(bodyList, goldList, segs, 0.98);

  // Slender turned Staunton column, collar rings, and lower ovoid mitre cup
  bodyList.push(
    makeLathe(
      [
        [0.20, 0.22],
        [0.155, 0.38],
        [0.125, 0.58],
        [0.115, 0.78],
        [0.185, 0.82],
        [0.19, 0.85],
        [0.135, 0.88],
        [0.168, 0.95],
        [0.188, 1.05],
        [0.162, 1.15],
        [0.115, 1.22],
        [0.001, 1.23]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.188, 0.011, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.835, 0]
    })
  );

  // Authentic Slotted Staunton Mitre Upper Lobes (creating the classic angled Bishop cleft!)
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.088, 0.13, 12), {
      scale: [1.05, 1.0, 0.72],
      rotation: [-0.14, 0, 0],
      position: [0, 1.265, -0.042]
    })
  );
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.076, 0.10, 12), {
      scale: [1.02, 1.0, 0.68],
      rotation: [0.22, 0, 0],
      position: [0, 1.245, 0.052]
    })
  );
  // Classic small Staunton mitre finial pearl perched on the rear mitre peak
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(0.036, 12, 10), {
      position: [0, 1.335, -0.052]
    })
  );

  // Restrained Top Inlay: Arcane Cyan Sacred Diamond flush-set into the slotted Staunton mitre crown
  addBishopTopDiamondEmblem(1.235, 0.78, detail, goldList, markerList, true);

  steelList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));
  faceList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildClassicQueenGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 30 : 18;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addClassicStauntonBase(bodyList, goldList, segs, 1.05);

  // Regal turned Staunton Queen column, double collar, and flared scalloped coronet
  bodyList.push(
    makeLathe(
      [
        [0.215, 0.23],
        [0.17, 0.42],
        [0.138, 0.68],
        [0.128, 0.94],
        [0.205, 0.99],
        [0.215, 1.03],
        [0.155, 1.07],
        [0.185, 1.11],
        [0.16, 1.14],
        [0.218, 1.33],
        [0.165, 1.39],
        [0.115, 1.415],
        [0.001, 1.418]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.212, 0.012, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.01, 0]
    })
  );

  // 8 Classic Scalloped Staunton Coronet Points & Pearls flaring subtly outward around the Queen's crown rim
  const crownPoints = 8;
  for (let i = 0; i < crownPoints; i++) {
    const angle = (i * Math.PI * 2) / crownPoints;
    const tilt = 0.24;
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.036, 0.10, 8), {
        rotation: [Math.cos(angle) * tilt, angle, -Math.sin(angle) * tilt],
        position: [Math.sin(angle) * 0.202, 1.385, Math.cos(angle) * 0.202]
      })
    );
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.019, 8, 8), {
        position: [Math.sin(angle) * 0.214, 1.438, Math.cos(angle) * 0.214]
      })
    );
  }

  // Restrained Top Inlay: Amethyst Purple Eight-Pointed Star flush-set into the Queen's cushion dome
  addQueenTopEightPointStarEmblem(1.416, 0.88, detail, goldList, markerList, true);

  steelList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));
  faceList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

function buildClassicKingGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 32 : 18;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];
  const markerList: THREE.BufferGeometry[] = [];

  addClassicStauntonBase(bodyList, goldList, segs, 1.1);

  // Commanding Staunton King column, triple collar molding, and royal crown gallery
  bodyList.push(
    makeLathe(
      [
        [0.23, 0.24],
        [0.182, 0.46],
        [0.148, 0.76],
        [0.138, 1.04],
        [0.225, 1.09],
        [0.232, 1.13],
        [0.17, 1.17],
        [0.205, 1.21],
        [0.165, 1.25],
        [0.232, 1.46],
        [0.195, 1.53],
        [0.135, 1.56],
        [0.001, 1.562]
      ],
      segs
    )
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.228, 0.013, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.11, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.225, 0.012, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.46, 0]
    })
  );

  // Iconic Traditional Vertical Staunton Cross Pattée Finial at the King's Apex (y = 1.56..1.78)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.056, 0.22, 0.052), {
      position: [0, 1.67, 0]
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.172, 0.056, 0.052), {
      position: [0, 1.685, 0]
    })
  );

  // Restrained Top Inlay: Royal Gold Cross Pattée inset on the crown cushion + flush gold inlay on the vertical Cross crest
  addKingTopCrownCrossEmblem(1.562, 0.92, detail, goldList, steelList, markerList, false, true);
  markerList.push(
    prepGeo(new THREE.BoxGeometry(0.174, 0.014, 0.054), {
      position: [0, 1.716, 0],
      flatShaded: true
    })
  );
  markerList.push(
    prepGeo(new THREE.BoxGeometry(0.058, 0.016, 0.054), {
      position: [0, 1.782, 0],
      flatShaded: true
    })
  );

  steelList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));
  faceList.push(prepGeo(new THREE.BoxGeometry(0.01, 0.01, 0.01), { position: [0, 0.1, 0] }));

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList),
    marker: finalizeMerged(markerList)
  };
}

const geometryCache = new Map<string, PieceMeshParts>();

export function getPieceGeometryParts(
  type: PieceSymbol,
  detail: PieceDetailLevel = 'high',
  skinId: PieceSkinId = 'arcane_royalty'
): PieceMeshParts {
  const key = `${skinId}_${type}_${detail}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  let parts: PieceMeshParts;
  if (skinId === 'classic') {
    switch (type) {
      case 'p':
        parts = buildClassicPawnGeometry(detail);
        break;
      case 'r':
        parts = buildClassicRookGeometry(detail);
        break;
      case 'n':
        parts = buildClassicKnightGeometry(detail);
        break;
      case 'b':
        parts = buildClassicBishopGeometry(detail);
        break;
      case 'q':
        parts = buildClassicQueenGeometry(detail);
        break;
      case 'k':
        parts = buildClassicKingGeometry(detail);
        break;
    }
  } else if (skinId === 'runic_warforged') {
    switch (type) {
      case 'p':
        parts = buildWarforgedPawnGeometry(detail);
        break;
      case 'r':
        parts = buildWarforgedRookGeometry(detail);
        break;
      case 'n':
        parts = buildWarforgedKnightGeometry(detail);
        break;
      case 'b':
        parts = buildWarforgedBishopGeometry(detail);
        break;
      case 'q':
        parts = buildWarforgedQueenGeometry(detail);
        break;
      case 'k':
        parts = buildWarforgedKingGeometry(detail);
        break;
    }
  } else if (skinId === 'mystic_sanctum') {
    switch (type) {
      case 'p':
        parts = buildSanctumPawnGeometry(detail);
        break;
      case 'r':
        parts = buildSanctumRookGeometry(detail);
        break;
      case 'n':
        parts = buildSanctumKnightGeometry(detail);
        break;
      case 'b':
        parts = buildSanctumBishopGeometry(detail);
        break;
      case 'q':
        parts = buildSanctumQueenGeometry(detail);
        break;
      case 'k':
        parts = buildSanctumKingGeometry(detail);
        break;
    }
  } else {
    switch (type) {
      case 'p':
        parts = buildPawnGeometry(detail);
        break;
      case 'r':
        parts = buildRookGeometry(detail);
        break;
      case 'n':
        parts = buildKnightGeometry(detail);
        break;
      case 'b':
        parts = buildBishopGeometry(detail);
        break;
      case 'q':
        parts = buildQueenGeometry(detail);
        break;
      case 'k':
        parts = buildKingGeometry(detail);
        break;
    }
  }

  geometryCache.set(key, parts);
  return parts;
}
