import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PieceSymbol } from '../engine/types';

export type PieceDetailLevel = 'high' | 'low';

export interface PieceMeshParts {
  body: THREE.BufferGeometry;
  gold: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
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
 * 1. PAWN — Kettle-Helm Vanguard Foot-Soldier with Cross Shield & Upright Broadsword
 * Matches Images 1, 3, 4, 5.
 */
function buildPawnGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.35, segs, bodyList, goldList);

  // Armored Skirt (Tassets) + Cuirass Torso + Neck
  bodyList.push(
    createSculptedLathe(
      [
        [0.27, 0.16],
        [0.24, 0.30],
        [0.19, 0.45], // Waist
        [0.20, 0.62], // Chest cuirass
        [0.14, 0.70], // Neck gorget
        [0.14, 0.80], // Head core
        [0.001, 0.84]
      ],
      segs
    )
  );

  // 8 Vertical Gold Trim Strips on Armored Skirt + Gold Waist Belt & Neck Collar
  addSkirtGoldStrips(8, 0.265, 0.192, 0.17, 0.45, goldList);
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.195, 0.02, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.45, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.155, 0.016, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.71, 0]
    })
  );

  // Shoulder Pauldrons & Arms
  addPauldronsAndArms(0.195, 0.62, 0.15, bodyList, goldList);

  // Iconic Wide-Brimmed Kettle Hat Helmet (Chapel-de-Fer) matching reference screenshots
  // Sloped wide brim
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.155, 0.255, 0.055, segs), {
      position: [0, 0.79, 0]
    })
  );
  // Gleaming Gold Outer Brim Ring
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.255, 0.018, 10, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.768, 0]
    })
  );
  // Rounded Kettle Helmet Dome
  bodyList.push(
    prepGeo(new THREE.SphereGeometry(0.158, segs, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), {
      position: [0, 0.79, 0]
    })
  );
  // Gold Cross Crest Finial on top of Kettle Helmet Dome (visible in Images 1, 4, 5)
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.026, 0.065, 0.16), {
      position: [0, 0.945, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.065, 0.026), {
      position: [0, 0.945, 0]
    })
  );

  // Left Hand: Kite/Heater Shield with Gold Cross held in front-left
  addCrossHeaterShield([-0.11, 0.49, 0.21], [0.06, -0.22, 0], 0.92, bodyList, goldList);

  // Right Hand: Upright Steel Broadsword with Gold Hilt held on right side
  addMedievalSword([0.21, 0.48, 0.16], [0.05, 0, 0], 0.54, false, goldList, steelList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

/**
 * 2. ROOK — Castellated Fortress Keep with Twin Side Turrets & Gold-Capped Battlements
 * Matches Images 1, 3, 4, 5.
 */
function buildRookGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.39, segs, bodyList, goldList);

  // Stout Fortress Keep Column with Masonry Grooves & Corbeled Battlement Rim
  bodyList.push(
    createSculptedLathe(
      [
        [0.31, 0.16],
        [0.29, 0.30],
        [0.27, 0.52],
        [0.26, 0.78],
        [0.28, 0.92],
        [0.32, 1.00], // Corbel flare
        [0.32, 1.12], // Battlement parapet wall
        [0.22, 1.12], // Inner turret roof
        [0.001, 1.10]
      ],
      segs
    )
  );

  // Gold horizontal tower bands
  for (const y of [0.32, 0.64, 0.96, 1.12]) {
    const r = y > 0.95 ? 0.322 : 0.275;
    goldList.push(
      prepGeo(new THREE.TorusGeometry(r, 0.017, 8, segs), {
        rotation: [Math.PI / 2, 0, 0],
        position: [0, y, 0]
      })
    );
  }

  // Twin Projecting Side Bastions / Turrets (Left -X and Right +X, matching Image 1 & 3)
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.16, 0.62, 0.22), {
        position: [side * 0.26, 0.56, 0]
      })
    );
    // Gold-trimmed side turret roof cap
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.18, 0.04, 0.24), {
        position: [side * 0.26, 0.88, 0]
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.09, 0.14, 4), {
        rotation: [0, Math.PI / 4, 0],
        position: [side * 0.26, 0.97, 0]
      })
    );
  }

  // Front & Back Gothic Arched Keep Gateways + Arrow Slits with Gold Frames
  for (const dir of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.14, 0.34, 0.04), {
        position: [0, 0.38, dir * 0.275]
      })
    );
    steelList.push(
      prepGeo(new THREE.BoxGeometry(0.10, 0.30, 0.045), {
        position: [0, 0.37, dir * 0.278]
      })
    );
  }

  // 8 Crenellated Merlons around the top rim, each with a Gold Cap and Finial Spike
  const merlonCount = 8;
  for (let i = 0; i < merlonCount; i++) {
    const angle = (i * Math.PI * 2) / merlonCount;
    const r = 0.275;
    const mx = Math.cos(angle) * r;
    const mz = Math.sin(angle) * r;

    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.10, 0.14, 0.08), {
        rotation: [0, -angle + Math.PI / 2, 0],
        position: [mx, 1.19, mz]
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.11, 0.028, 0.09), {
        rotation: [0, -angle + Math.PI / 2, 0],
        position: [mx, 1.265, mz]
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.024, 0.06, 6), {
        position: [mx, 1.305, mz]
      })
    );
  }

  // Central turret gold dome boss (visible in top-down Image 5)
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), {
      position: [0, 1.10, 0]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

/**
 * 3. KNIGHT — Armored Warhorse + Crusader Knight Rider in Great-Helm with Shield & Jousting Lance
 * Matches Images 1, 3, 4, 5.
 */
function buildKnightGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const ringSegs = detail === 'high' ? 18 : 10;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.38, segs, bodyList, goldList);

  // Lower Armored Barding Skirt
  bodyList.push(
    createSculptedLathe(
      [
        [0.30, 0.16],
        [0.27, 0.36],
        [0.23, 0.54],
        [0.001, 0.56]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.295, 0.235, 0.17, 0.52, goldList);

  // Sculpted Armored Warhorse Head & Neck projecting forward (+Z)
  const horseSpine = [
    { y: 0.44, z: 0.06, rx: 0.16, rz: 0.18, pitch: -0.2 },
    { y: 0.64, z: 0.12, rx: 0.135, rz: 0.16, pitch: -0.1 },
    { y: 0.84, z: 0.14, rx: 0.115, rz: 0.145, pitch: 0.35 }, // Horse poll
    { y: 0.88, z: 0.22, rx: 0.105, rz: 0.125, pitch: 1.05 }, // Horse forehead
    { y: 0.77, z: 0.32, rx: 0.075, rz: 0.09, pitch: 1.35 }, // Nasal bridge
    { y: 0.68, z: 0.39, rx: 0.055, rz: 0.065, pitch: 1.42 } // Muzzle
  ];
  bodyList.push(createLoftedOrganicMesh(horseSpine, ringSegs));

  // Horse Ears & Gold Chamfron Face-Armor
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.032, 0.13, 6), {
        rotation: [-0.25, 0, side * -0.18],
        position: [side * 0.065, 0.96, 0.13]
      })
    );
  }
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.068, 0.26, 4), {
      scale: [0.95, 1.0, 0.32],
      rotation: [2.25, Math.PI / 4, 0],
      position: [0, 0.80, 0.30]
    })
  );

  // Crusader Rider Torso & Flat-Topped Great Helm rising above/behind the horse (z = -0.05)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.175, 0.195, 0.46, segs), {
      position: [0, 0.74, -0.05]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.185, 0.018, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.56, -0.05]
    })
  );

  // Crusader Great Helm (Cylinder with Gold Rim, Vertical Crest Fin, and Gold Face Cross)
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.145, 0.152, 0.30, segs), {
      position: [0, 1.14, -0.04]
    })
  );
  // Gold Great-Helm Top & Bottom Rings
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.148, 0.016, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.28, -0.04]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.154, 0.016, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.00, -0.04]
    })
  );
  // Gold Crusader Cross on front of Great Helm
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.028, 0.24, 0.025), {
      position: [0, 1.14, 0.108]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.028, 0.025), {
      position: [0, 1.17, 0.108]
    })
  );
  // Helm top sagittal crest fin (visible in Image 3 foreground)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.032, 0.14, 0.22), {
      rotation: [0.15, 0, 0],
      position: [0, 1.35, -0.04]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.036, 0.025, 0.23), {
      rotation: [0.15, 0, 0],
      position: [0, 1.42, -0.04]
    })
  );

  // Crusader Shoulder Pauldrons & Arms
  addPauldronsAndArms(0.215, 0.88, 0.08, bodyList, goldList);

  // Left Flank: Crusader Heater Shield
  addCrossHeaterShield([-0.25, 0.72, 0.06], [0, -Math.PI * 0.42, 0], 0.88, bodyList, goldList);

  // Right Flank: Couched Jousting Lance / Spear angled forward (+Z)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.55, 10), {
      rotation: [1.15, 0, 0],
      position: [0.24, 0.68, 0.02]
    })
  );
  // Gold Vamplate Hand-cone on Lance
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.065, 0.10, 12), {
      rotation: [1.15, 0, 0],
      position: [0.24, 0.74, 0.14]
    })
  );
  // Steel Lance Tip extending forward
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.038, 0.46, 8), {
      rotation: [1.15, 0, 0],
      position: [0.24, 0.84, 0.36]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

/**
 * 4. BISHOP — Mitred Cleric with Sculpted Face, Tall Spiraled Golden Crosier Staff & Gold-Bound Tome
 * Matches Images 1, 3, 4, 5.
 */
function buildBishopGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.37, segs, bodyList, goldList);

  // Tall Pleated Ecclesiastical Cassock Robe
  bodyList.push(
    createSculptedLathe(
      [
        [0.29, 0.16],
        [0.25, 0.42],
        [0.21, 0.72],
        [0.22, 0.94],
        [0.15, 1.02],
        [0.001, 1.04]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.285, 0.212, 0.17, 0.72, goldList);

  // Gold Waist Cincture & Front Stole
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.215, 0.018, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.72, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.065, 0.48, 0.022), {
      rotation: [-0.08, 0, 0],
      position: [0, 0.48, 0.23]
    })
  );

  // Shoulder Pauldrons & Arms
  addPauldronsAndArms(0.21, 0.90, 0.16, bodyList, goldList);

  // Sculpted Cleric Head & Face (visible under Mitre in Image 1 & 4)
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.115, 0.11, 0.18, 18), {
      position: [0, 1.09, 0.01]
    })
  );
  // Sculpted Nose & Brow
  faceList.push(
    prepGeo(new THREE.ConeGeometry(0.024, 0.06, 4), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.09, 0.125]
    })
  );
  // Dark Eyes
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.SphereGeometry(0.014, 8, 8), {
        position: [side * 0.042, 1.11, 0.112]
      })
    );
  }

  // Tall Pointed Bishop's Mitre Hat with Gold Rim & Front Gold Cross
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.148, 0.40, segs), {
      scale: [1.0, 1.0, 0.76],
      position: [0, 1.37, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.145, 0.018, 8, segs), {
      scale: [1.0, 0.78, 1.0],
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.18, 0]
    })
  );
  // Gold Cross on Front of Mitre
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.024, 0.24, 0.025), {
      rotation: [0.26, 0, 0],
      position: [0, 1.33, 0.082]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.13, 0.024, 0.025), {
      rotation: [0.26, 0, 0],
      position: [0, 1.34, 0.08]
    })
  );
  // Mitre Peak Gold Finial
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.024, 8, 8), {
      position: [0, 1.57, 0]
    })
  );

  // Iconic Tall Spiraled Golden Crosier Staff (Right side of screen / piece's left hand at +X = 0.23)
  // Matches the giant golden spiral crook in the right foreground of Image 1 & 4!
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.024, 1.24, 12), {
      position: [0.23, 0.76, 0.12]
    })
  );
  // Collar rings on Crosier shaft
  for (const cy of [0.35, 0.85, 1.34]) {
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.032, 0.01, 8, 14), {
        rotation: [Math.PI / 2, 0, 0],
        position: [0.23, cy, 0.12]
      })
    );
  }
  // Outer Spiral Crook Loop
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.125, 0.026, 12, 24, Math.PI * 1.65), {
      rotation: [0, Math.PI / 2, Math.PI * 0.15],
      position: [0.23, 1.48, 0.12]
    })
  );
  // Inner Spiral Crook Curl
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.068, 0.022, 10, 18, Math.PI * 1.5), {
      rotation: [0, Math.PI / 2, -Math.PI * 0.6],
      position: [0.23, 1.47, 0.12]
    })
  );
  // Central Golden Orb inside the Spiral Crook
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.036, 12, 12), {
      position: [0.23, 1.47, 0.12]
    })
  );

  // Other Hand (-X = -0.18): Gold-Bound Scripture Book / Tome held at chest
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.15, 0.19, 0.045), {
      rotation: [-0.35, -0.25, 0],
      position: [-0.18, 0.78, 0.21]
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.125, 0.165, 0.052), {
      rotation: [-0.35, -0.25, 0],
      position: [-0.18, 0.78, 0.214]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.02, 0.11, 0.058), {
      rotation: [-0.35, -0.25, 0],
      position: [-0.18, 0.78, 0.216]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

/**
 * 5. QUEEN — Crowned Sovereign with Sculpted Face, Veil, Spiked Gold Crown, Trident Scepter & Royal Plaque
 * Matches Images 1, 3, 4, 5.
 */
function buildQueenGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 32 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.39, segs, bodyList, goldList);

  // Sweeping Pleated Royal Gown + Cinched Waist + Upper Torso
  bodyList.push(
    createSculptedLathe(
      [
        [0.31, 0.16],
        [0.27, 0.48],
        [0.21, 0.80], // Waist
        [0.22, 1.06], // Upper bust
        [0.15, 1.14], // Neck
        [0.001, 1.16]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.305, 0.212, 0.17, 0.80, goldList);

  // Sculpted Royal Bust Relief in front (+Z) matching Image 1 & 4
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(0.078, 12, 12), {
        position: [side * 0.075, 0.96, 0.165]
      })
    );
  }

  // Gold Waist Belt & Collar
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.215, 0.02, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.80, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.165, 0.018, 8, segs), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.13, 0]
    })
  );

  // Shoulder Pauldrons & Arms
  addPauldronsAndArms(0.225, 1.02, 0.16, bodyList, goldList);

  // Sculpted Queen Head & Face + Draped Royal Veil
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.115, 0.11, 0.20, 18), {
      position: [0, 1.24, 0.01]
    })
  );
  faceList.push(
    prepGeo(new THREE.ConeGeometry(0.022, 0.055, 4), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.24, 0.125]
    })
  );
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.SphereGeometry(0.014, 8, 8), {
        position: [side * 0.042, 1.26, 0.112]
      })
    );
    // Side veil lappets framing the face
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.045, 0.24, 0.14), {
        rotation: [0, 0, side * -0.12],
        position: [side * 0.125, 1.22, -0.01]
      })
    );
  }
  // Back veil drape
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.125, 0.16, 0.26, 12, 1, false, Math.PI * 0.6, Math.PI * 0.8), {
      position: [0, 1.22, 0]
    })
  );

  // Open Multi-Spiked Golden Queen's Crown (matching Image 1 & 4)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.142, 0.132, 0.08, 16), {
      position: [0, 1.37, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.142, 0.018, 8, 20), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.34, 0]
    })
  );
  const spikeCount = 8;
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i * Math.PI * 2) / spikeCount;
    const r = 0.135;
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.022, 0.18, 6), {
        rotation: [Math.sin(angle) * 0.1, 0, -Math.cos(angle) * 0.1],
        position: [Math.cos(angle) * r, 1.48, Math.sin(angle) * r]
      })
    );
    goldList.push(
      prepGeo(new THREE.SphereGeometry(0.014, 6, 6), {
        position: [Math.cos(angle) * (r + 0.01), 1.57, Math.sin(angle) * (r + 0.01)]
      })
    );
  }

  // Left Hand (+X = 0.24): Tall Golden Three-Pronged Royal Scepter / Trident
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.022, 1.32, 10), {
      rotation: [0, 0, -0.05],
      position: [0.24, 0.82, 0.12]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.12, 0.024, 0.028), {
      position: [0.26, 1.48, 0.12]
    })
  );
  for (const offset of [-0.05, 0, 0.05]) {
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.016, 0.18, 6), {
        position: [0.26 + offset, 1.57, 0.12]
      })
    );
  }

  // Right Hand (-X = -0.19): Royal Crest Shield Plaque
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.24, 0.036), {
      rotation: [0.1, -0.2, 0],
      position: [-0.19, 0.84, 0.21]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.172, 0.252, 0.028), {
      rotation: [0.1, -0.2, 0],
      position: [-0.19, 0.84, 0.205]
    })
  );
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.038, 0), {
      rotation: [0.1, -0.2, 0],
      position: [-0.19, 0.84, 0.23]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

/**
 * 6. KING — Bearded Monarch with Broad Pauldrons, Arched Imperial Crown with Cross & Downward Royal Greatsword
 * Matches Images 1, 3, 4, 5.
 */
function buildKingGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 32 : 16;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addOctagonalPedestal(0.42, segs, bodyList, goldList);

  // Tall Broad Imperial Robe & Armored Chest
  bodyList.push(
    createSculptedLathe(
      [
        [0.34, 0.16],
        [0.30, 0.52],
        [0.25, 0.84],
        [0.27, 1.14], // Broad chest
        [0.18, 1.22], // Collar
        [0.001, 1.24]
      ],
      segs
    )
  );
  addSkirtGoldStrips(8, 0.335, 0.252, 0.17, 0.84, goldList);

  // Gold Waist Belt & Square Golden Chest Tabard Plaque (visible in Image 1 & 4)
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

  // Broad Imperial Shoulder Pauldrons & Arms reaching inward to clasp the Greatsword Hilt
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(0.125, 14, 12), {
        scale: [1.1, 0.92, 1.1],
        position: [side * 0.27, 1.10, 0.02]
      })
    );
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.118, 0.018, 8, 18), {
        rotation: [Math.PI / 2 + 0.15, side * 0.45, 0],
        position: [side * 0.27, 1.06, 0.02]
      })
    );
    // Forearms angled inward toward x = 0, y = 0.88, z = 0.28
    bodyList.push(
      prepGeo(new THREE.CylinderGeometry(0.052, 0.048, 0.28, 10), {
        rotation: [0.85, 0, side * 0.65],
        position: [side * 0.15, 0.96, 0.16]
      })
    );
    // Clasped gauntlets on sword hilt
    bodyList.push(
      prepGeo(new THREE.SphereGeometry(0.052, 10, 10), {
        position: [side * 0.035, 0.89, 0.27]
      })
    );
  }

  // Sculpted Bearded Monarch Head (matching Image 1, 3, 4)
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.135, 0.13, 0.22, 18), {
      position: [0, 1.33, 0.01]
    })
  );
  // Sculpted Nose
  faceList.push(
    prepGeo(new THREE.ConeGeometry(0.026, 0.06, 4), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.34, 0.145]
    })
  );
  // Sculpted Beard & Mustache (in ivory/obsidian body material, matching reference)
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.19, 0.11, 0.12), {
      position: [0, 1.24, 0.095]
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.13, 0.032, 0.04), {
      position: [0, 1.30, 0.145]
    })
  );
  // Dark Eyes & Brow
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.SphereGeometry(0.016, 8, 8), {
        position: [side * 0.048, 1.36, 0.135]
      })
    );
  }

  // High Imperial Arched Gold Crown with Cross Finial
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.165, 0.152, 0.09, 20), {
      position: [0, 1.47, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.162, 0.022, 10, 24), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.43, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.168, 0.018, 10, 24), {
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 1.51, 0]
    })
  );
  // 4 Imperial Crown Arches meeting at top monde orb
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.155, 0.018, 8, 18, Math.PI), {
        rotation: [0, angle, 0],
        position: [0, 1.51, 0]
      })
    );
  }
  // Crown Monde Orb & Sovereign Cross Finial
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.038, 10, 10), {
      position: [0, 1.69, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.036, 0.16, 0.036), {
      position: [0, 1.79, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.13, 0.036, 0.036), {
      position: [0, 1.80, 0]
    })
  );

  // Downward-Pointing Two-Handed Royal Greatsword in front (z = 0.28)
  addMedievalSword([0, 0.80, 0.28], [0, 0, 0], 0.62, true, goldList, steelList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

const geometryCache = new Map<string, PieceMeshParts>();

export function getPieceGeometryParts(type: PieceSymbol, detail: PieceDetailLevel = 'high'): PieceMeshParts {
  const key = `${type}_${detail}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  let parts: PieceMeshParts;
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

  geometryCache.set(key, parts);
  return parts;
}
