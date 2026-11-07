import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PieceSkinId, PieceSymbol } from '../engine/types';

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

  // Right Flank: Couched Jousting Lance / Spear angled forward (+Z), kept cleanly within square bounds
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.48, 10), {
      rotation: [1.08, 0, 0],
      position: [0.24, 0.68, -0.02]
    })
  );
  // Gold Vamplate Hand-cone on Lance
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.065, 0.10, 12), {
      rotation: [1.08, 0, 0],
      position: [0.24, 0.74, 0.09]
    })
  );
  // Steel Lance Tip extending forward (within z <= 0.44)
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.038, 0.38, 8), {
      rotation: [1.08, 0, 0],
      position: [0.24, 0.84, 0.27]
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
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.36, bodyList, goldList, steelList);

  // Heavy 6-sided faceted construct torso & armored skirt
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.22, 0.29, 0.44, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.38, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.38, 0.32, 0.30), {
      position: [0, 0.70, 0],
      flatShaded: true
    })
  );
  // Runic rib bands
  for (const y of [0.34, 0.56, 0.76]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.41, 0.035, 0.33), {
        position: [0, y, 0],
        flatShaded: true
      })
    );
  }

  // Heavy angular dreadnought shoulder plates
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.16, 0.18, 0.22), {
        rotation: [0, 0, side * -0.25],
        position: [side * 0.24, 0.78, 0.02],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.04, 0.12, 4), {
        rotation: [0, Math.PI / 4, side * -0.35],
        position: [side * 0.27, 0.91, 0.02],
        flatShaded: true
      })
    );
  }

  // Hexagonal Greathelm with Glowing Visor Slit & Twin Curved Bull-Horns
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.14, 0.16, 0.24, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.96, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.18, 0.04, 0.04), {
      position: [0, 0.98, 0.14]
    })
  );
  for (const side of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.042, 0.24, 5), {
        rotation: [0.2, 0, side * -0.85],
        position: [side * 0.20, 1.07, 0],
        flatShaded: true
      })
    );
  }

  // Left Hand: Tower Pavise Shield; Right Hand: Double-Bitted Runic Battleaxe
  addWarforgedTowerShield([-0.19, 0.56, 0.22], [-0.08, -0.22, 0], 0.95, bodyList, goldList, steelList);
  addWarforgedBattleaxe([0.23, 0.44, 0.18], [0.12, 0, 0], 0.95, goldList, steelList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildWarforgedRookGeometry(_detail: PieceDetailLevel): PieceMeshParts {
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.41, bodyList, goldList, steelList);

  // Squat, massive sloped-armor Iron Juggernaut Citadel core
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.28, 0.35, 0.88, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 0.60, 0],
      flatShaded: true
    })
  );

  // 4 Massive Projecting Corner Fortress Buttress Pylons with Sloped Rams
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const cx = Math.cos(a) * 0.26;
    const cz = Math.sin(a) * 0.26;
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.18, 0.96, 0.18), {
        rotation: [0, -a, 0],
        position: [cx, 0.64, cz],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.20, 0.06, 0.20), {
        rotation: [0, -a, 0],
        position: [cx, 1.14, cz],
        flatShaded: true
      })
    );
    // Corner anvil spikes
    steelList.push(
      prepGeo(new THREE.ConeGeometry(0.065, 0.18, 4), {
        rotation: [0, -a + Math.PI / 4, 0],
        position: [cx, 1.25, cz],
        flatShaded: true
      })
    );
  }

  // Heavy Horizontal Forged Gold Armor Straps
  for (const y of [0.36, 0.68, 0.98]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.56, 0.045, 0.56), {
        position: [0, y, 0],
        flatShaded: true
      })
    );
  }

  // Central Spiked War-Brazier Crown on top of the Rook
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.16, 0), {
      position: [0, 1.18, 0],
      flatShaded: true
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildWarforgedKnightGeometry(_detail: PieceDetailLevel): PieceMeshParts {
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.39, bodyList, goldList, steelList);

  // Armored Construct Base Chassis
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.24, 0.31, 0.42, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.36, 0],
      flatShaded: true
    })
  );

  // Angular Mechanized War-Charger Neck & Head built from faceted armor plates
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.26, 0.56, 0.34), {
      rotation: [0.28, 0, 0],
      position: [0, 0.72, 0.06],
      flatShaded: true
    })
  );
  // Angular Armored Charger Snout projecting forward
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.18, 0.44, 4), {
      rotation: [Math.PI * 0.62, Math.PI / 4, 0],
      position: [0, 0.92, 0.28],
      flatShaded: true
    })
  );
  // Glowing Golden Chamfron Face-Plate & Brow Horns
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.10, 0.36), {
      rotation: [0.38, 0, 0],
      position: [0, 0.98, 0.24],
      flatShaded: true
    })
  );
  for (const side of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.045, 0.24, 4), {
        rotation: [-0.45, 0, side * -0.35],
        position: [side * 0.12, 1.16, 0.06],
        flatShaded: true
      })
    );
  }

  // Prominent Saw-Toothed Dorsal Metal Mane Crest (4 angled steel/gold fins along back of neck)
  for (let i = 0; i < 4; i++) {
    const fy = 0.62 + i * 0.15;
    const fz = -0.12 + i * 0.04;
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.05, 0.14, 0.18), {
        rotation: [0.55, 0, 0],
        position: [0, fy, fz],
        flatShaded: true
      })
    );
  }

  // Twin Flank Weapons: Left Tower Shield + Right Heavy Diamond War-Lance
  addWarforgedTowerShield([-0.24, 0.66, 0.08], [0, -Math.PI * 0.38, 0], 0.85, bodyList, goldList, steelList);
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.06, 0.52, 4), {
      rotation: [1.12, Math.PI / 4, 0],
      position: [0.24, 0.78, 0.18],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.085, 0), {
      position: [0.24, 0.68, 0.04],
      flatShaded: true
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildWarforgedBishopGeometry(_detail: PieceDetailLevel): PieceMeshParts {
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.38, bodyList, goldList, steelList);

  // Tall 6-sided Armored Runic Inquisitor Cassock
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.19, 0.29, 0.86, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.58, 0],
      flatShaded: true
    })
  );
  for (const y of [0.36, 0.64, 0.90]) {
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.24 - (y - 0.36) * 0.08, 0.022, 6, 6), {
        rotation: [Math.PI / 2, 0, Math.PI / 6],
        position: [0, y, 0],
        flatShaded: true
      })
    );
  }

  // Wide Angular Dreadnought Shoulder Mantles
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.52, 0.16, 0.28), {
      position: [0, 0.96, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.55, 0.04, 0.30), {
      position: [0, 1.04, 0],
      flatShaded: true
    })
  );

  // Tall Split-Horned Iron Inquisitor Crown/Hood
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.16, 0.42, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 1.24, 0],
      flatShaded: true
    })
  );
  for (const side of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.045, 0.36, 0.08), {
        rotation: [0, 0, side * -0.22],
        position: [side * 0.11, 1.32, 0.02],
        flatShaded: true
      })
    );
  }

  // Right Hand (+X = 0.25): Tall Twin-Pronged Runic Tuning-Fork War-Halberd
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.024, 0.026, 1.32, 6), {
      position: [0.25, 0.78, 0.12]
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.18, 0.04, 0.05), {
      position: [0.25, 1.40, 0.12],
      flatShaded: true
    })
  );
  for (const side of [-1, 1]) {
    steelList.push(
      prepGeo(new THREE.BoxGeometry(0.032, 0.26, 0.05), {
        position: [0.25 + side * 0.065, 1.53, 0.12],
        flatShaded: true
      })
    );
  }

  // Left Hand (-X = -0.20): Forged Runic Stone Tablet
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.16, 0.24, 0.06), {
      rotation: [-0.25, -0.2, 0],
      position: [-0.20, 0.78, 0.20],
      flatShaded: true
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildWarforgedQueenGeometry(_detail: PieceDetailLevel): PieceMeshParts {
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.40, bodyList, goldList, steelList);

  // Faceted Armored Valkyrie War-Gown & Cuirass
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.20, 0.31, 0.74, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.52, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.23, 0.18, 0.34, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.98, 0],
      flatShaded: true
    })
  );

  // Iconic Sweeping Valhallan Winged Shoulder-Blades flaring outward & upward!
  for (const side of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.14, 0.52, 4), {
        scale: [0.35, 1.0, 0.85],
        rotation: [-0.15, 0, side * -0.58],
        position: [side * 0.30, 1.18, -0.04],
        flatShaded: true
      })
    );
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.15, 0.18, 0.18), {
        position: [side * 0.22, 1.02, 0],
        flatShaded: true
      })
    );
  }

  // Valkyrie Helm & Jagged 6-Blade Iron/Gold War-Crown
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.13, 0.14, 0.24, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 1.24, 0],
      flatShaded: true
    })
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.036, 0.24, 4), {
        rotation: [Math.sin(a) * 0.22, -a, -Math.cos(a) * 0.22],
        position: [Math.cos(a) * 0.14, 1.44, Math.sin(a) * 0.14],
        flatShaded: true
      })
    );
  }

  // Right Hand (+X = 0.26): Twin-Bladed Runic War-Glaive
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.024, 1.42, 6), {
      position: [0.26, 0.84, 0.12]
    })
  );
  steelList.push(
    prepGeo(new THREE.ConeGeometry(0.09, 0.34, 4), {
      scale: [0.35, 1.0, 1.0],
      position: [0.26, 1.62, 0.12],
      flatShaded: true
    })
  );
  // Left Hand (-X = -0.22): Hexagonal Runic Aegis Shield
  addWarforgedTowerShield([-0.22, 0.82, 0.18], [0.05, -0.25, 0], 0.82, bodyList, goldList, steelList);

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildWarforgedKingGeometry(_detail: PieceDetailLevel): PieceMeshParts {
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addWarforgedPedestal(0.43, bodyList, goldList, steelList);

  // Colossal 6-Sided Runic War-Emperor Juggernaut Torso
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.25, 0.34, 0.84, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 0.56, 0],
      flatShaded: true
    })
  );
  bodyList.push(
    prepGeo(new THREE.BoxGeometry(0.56, 0.36, 0.36), {
      position: [0, 1.06, 0],
      flatShaded: true
    })
  );
  // Golden Runic Chest Forge-Core
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.11, 0), {
      position: [0, 1.06, 0.19],
      flatShaded: true
    })
  );

  // Towering Fortress Shoulder Pauldrons with Spikes
  for (const side of [-1, 1]) {
    bodyList.push(
      prepGeo(new THREE.BoxGeometry(0.20, 0.28, 0.34), {
        rotation: [0, 0, side * -0.18],
        position: [side * 0.32, 1.12, 0],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.055, 0.22, 4), {
        rotation: [0, Math.PI / 4, side * -0.28],
        position: [side * 0.36, 1.32, 0],
        flatShaded: true
      })
    );
  }

  // Great Horned Iron-and-Gold War-Emperor Helm & Crown
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.15, 0.16, 0.26, 6), {
      rotation: [0, Math.PI / 6, 0],
      position: [0, 1.35, 0],
      flatShaded: true
    })
  );
  // Massive Twin Sovereign War-Horns + Central Runic Cross-Anvil Crest
  for (const side of [-1, 1]) {
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.055, 0.38, 4), {
        rotation: [0.15, 0, side * -0.52],
        position: [side * 0.22, 1.56, 0],
        flatShaded: true
      })
    );
  }
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.06, 0.32, 0.06), {
      position: [0, 1.64, 0],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.22, 0.06, 0.06), {
      position: [0, 1.70, 0],
      flatShaded: true
    })
  );

  // Colossal Broad-Bladed Runic Executioner Greatsword planted in front (z = 0.28)
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.32, 0.05, 0.06), {
      position: [0, 0.92, 0.28],
      flatShaded: true
    })
  );
  steelList.push(
    prepGeo(new THREE.BoxGeometry(0.12, 0.72, 0.035), {
      position: [0, 0.54, 0.28],
      flatShaded: true
    })
  );
  goldList.push(
    prepGeo(new THREE.BoxGeometry(0.035, 0.64, 0.042), {
      position: [0, 0.56, 0.28]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
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
  // Signature Levitating Golden Astrolabe Ring hovering in mid-air around the piece!
  goldList.push(
    prepGeo(new THREE.TorusGeometry(ringRadius, 0.020, 8, segs), {
      rotation: [Math.PI / 2 + 0.22, 0, 0.15],
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

  addSanctumPedestal(0.34, segs, 0.52, 0.31, bodyList, goldList);

  // Sleek Flared Arcane Acolyte Robe
  bodyList.push(
    createSculptedLathe(
      [
        [0.25, 0.15],
        [0.18, 0.45],
        [0.14, 0.72],
        [0.17, 0.86],
        [0.001, 0.88]
      ],
      segs
    )
  );

  // Wide-Brimmed Pointed Wizard Hat with Curved Apex!
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.26, 0.28, 0.025, segs), {
      rotation: [-0.12, 0, 0],
      position: [0, 0.94, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.27, 0.014, 8, segs), {
      rotation: [Math.PI / 2 - 0.12, 0, 0],
      position: [0, 0.94, 0]
    })
  );
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.14, 0.42, segs), {
      rotation: [-0.18, 0, 0],
      position: [0, 1.14, -0.03]
    })
  );
  // Star finial at tip of wizard hat
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.038, 0), {
      position: [0, 1.35, -0.07]
    })
  );

  // Right Hand (+X = 0.22): Crystal-Tipped Arcane Wand / Stave
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.018, 0.88, 8), {
      position: [0.22, 0.56, 0.12]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.065, 0), {
      scale: [0.75, 1.45, 0.75],
      position: [0.22, 1.04, 0.12]
    })
  );

  // Left Hand (-X = -0.20): Levitating Golden Mana Sphere + Orbiting Ring
  goldList.push(
    prepGeo(new THREE.SphereGeometry(0.068, 12, 12), {
      position: [-0.20, 0.82, 0.16]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.105, 0.012, 8, 16), {
      rotation: [0.8, 0.4, 0],
      position: [-0.20, 0.82, 0.16]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildSanctumRookGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.38, segs, 0.58, 0.35, bodyList, goldList);

  // Second intersecting tilted astrolabe ring for the Obelisk Spire!
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.34, 0.020, 8, segs), {
      rotation: [Math.PI / 2 - 0.38, 0, -0.35],
      position: [0, 0.76, 0]
    })
  );

  // Tall Tapered 4-Sided Arcane Obelisk Needle Spire
  bodyList.push(
    prepGeo(new THREE.CylinderGeometry(0.11, 0.25, 0.96, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 0.62, 0],
      flatShaded: true
    })
  );
  // 4 Floating Side Crystal Fins flanking the Obelisk
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const fx = Math.cos(a) * 0.23;
    const fz = Math.sin(a) * 0.23;
    bodyList.push(
      prepGeo(new THREE.ConeGeometry(0.055, 0.48, 4), {
        rotation: [0, -a, 0],
        position: [fx, 0.48, fz],
        flatShaded: true
      })
    );
    goldList.push(
      prepGeo(new THREE.BoxGeometry(0.03, 0.52, 0.03), {
        position: [fx * 0.82, 0.62, fz * 0.82]
      })
    );
  }

  // Pyramidion Obelisk Capstone + Levitating Mana Crystal at the Apex
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.155, 0.20, 4), {
      rotation: [0, Math.PI / 4, 0],
      position: [0, 1.18, 0],
      flatShaded: true
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.11, 0), {
      scale: [0.8, 1.5, 0.8],
      position: [0, 1.40, 0],
      flatShaded: true
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildSanctumKnightGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const ringSegs = detail === 'high' ? 16 : 10;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.37, segs, 0.48, 0.34, bodyList, goldList);

  // Graceful Astral Unicorn / Pegasus Spirit-Steed Neck & Head
  const unicornSpine = [
    { y: 0.16, z: -0.02, rx: 0.22, rz: 0.22, pitch: 0 },
    { y: 0.46, z: 0.05, rx: 0.16, rz: 0.18, pitch: -0.18 },
    { y: 0.78, z: 0.12, rx: 0.12, rz: 0.15, pitch: 0.1 },
    { y: 0.98, z: 0.16, rx: 0.10, rz: 0.13, pitch: 0.55 },
    { y: 0.92, z: 0.30, rx: 0.065, rz: 0.08, pitch: 1.25 }
  ];
  bodyList.push(createLoftedOrganicMesh(unicornSpine, ringSegs));

  // Long Spiraled Golden Unicorn Horn projecting from the steed's brow!
  goldList.push(
    prepGeo(new THREE.ConeGeometry(0.038, 0.38, 8), {
      rotation: [0.74, 0, 0],
      position: [0, 1.14, 0.27]
    })
  );

  // Swept-Back Ethereal Pegasus Wing-Blades on Left & Right Flanks!
  for (const side of [-1, 1]) {
    for (let f = 0; f < 3; f++) {
      const len = 0.54 - f * 0.10;
      const wy = 0.78 + f * 0.13;
      const wz = -0.06 - f * 0.06;
      bodyList.push(
        prepGeo(new THREE.ConeGeometry(0.065, len, 4), {
          scale: [0.35, 1.0, 1.1],
          rotation: [-0.68 - f * 0.15, side * 0.28, side * -0.35],
          position: [side * 0.22, wy, wz],
          flatShaded: true
        })
      );
      goldList.push(
        prepGeo(new THREE.ConeGeometry(0.035, len * 0.9, 4), {
          scale: [0.35, 1.0, 1.1],
          rotation: [-0.68 - f * 0.15, side * 0.28, side * -0.35],
          position: [side * 0.24, wy + 0.02, wz],
          flatShaded: true
        })
      );
    }
  }

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildSanctumBishopGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 24 : 12;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.36, segs, 0.56, 0.33, bodyList, goldList);

  // Slender Sweeping Astral Seer Vestments
  bodyList.push(
    createSculptedLathe(
      [
        [0.27, 0.15],
        [0.20, 0.48],
        [0.15, 0.82],
        [0.18, 1.02],
        [0.11, 1.12],
        [0.001, 1.14]
      ],
      segs
    )
  );

  // Vertical Floating Golden Halo Ring behind the Seer's shoulders & head
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.24, 0.018, 8, segs), {
      position: [0, 1.18, -0.06]
    })
  );

  // Seer Head + Tall Crescent-Moon Headdress cradling a Levitating Star-Orb
  faceList.push(
    prepGeo(new THREE.SphereGeometry(0.105, 14, 12), {
      position: [0, 1.22, 0]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.145, 0.024, 8, 20, Math.PI * 1.35), {
      rotation: [0, 0, Math.PI * 0.82],
      position: [0, 1.42, 0]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.065, 0), {
      position: [0, 1.44, 0]
    })
  );

  // Right Hand (+X = 0.23): Tall Crescent-Moon & Star Staff
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.020, 1.28, 8), {
      position: [0.23, 0.78, 0.10]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.11, 0.022, 8, 18, Math.PI * 1.4), {
      rotation: [0, Math.PI / 2, Math.PI * 0.3],
      position: [0.23, 1.48, 0.10]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.048, 0), {
      position: [0.23, 1.48, 0.10]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildSanctumQueenGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.38, segs, 0.62, 0.36, bodyList, goldList);

  // High-Collared Flowing Celestial Arch-Sorceress Gown
  bodyList.push(
    createSculptedLathe(
      [
        [0.29, 0.15],
        [0.22, 0.52],
        [0.16, 0.86],
        [0.20, 1.10],
        [0.12, 1.18],
        [0.001, 1.20]
      ],
      segs
    )
  );

  // Floating Golden Crescent Shoulder-Mantle Arcs & High flared collar
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.28, 0.022, 8, 22, Math.PI * 1.2), {
      rotation: [-0.35, 0, -Math.PI * 0.1],
      position: [0, 1.16, -0.04]
    })
  );

  // Sorceress Head + Radiant Sunburst & Crescent Diadem Crown
  faceList.push(
    prepGeo(new THREE.SphereGeometry(0.11, 14, 12), {
      position: [0, 1.28, 0]
    })
  );
  // 7 Radiant Sunburst Rays fanning out above the brow
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.28;
    const len = 0.26 - Math.abs(i) * 0.03;
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.022, len, 4), {
        rotation: [0, 0, -a],
        position: [Math.sin(a) * 0.16, 1.46 + Math.cos(a) * 0.06, 0.02]
      })
    );
  }

  // Right Hand (+X = 0.25): Twin-Ringed Astral Armillary Scepter
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.020, 1.38, 8), {
      position: [0.25, 0.84, 0.10]
    })
  );
  for (const rotZ of [0.45, -0.45]) {
    goldList.push(
      prepGeo(new THREE.TorusGeometry(0.10, 0.016, 8, 18), {
        rotation: [0.3, 0.4, rotZ],
        position: [0.25, 1.56, 0.10]
      })
    );
  }
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.055, 0), {
      position: [0.25, 1.56, 0.10]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
  };
}

function buildSanctumKingGeometry(detail: PieceDetailLevel): PieceMeshParts {
  const segs = detail === 'high' ? 28 : 14;
  const bodyList: THREE.BufferGeometry[] = [];
  const goldList: THREE.BufferGeometry[] = [];
  const steelList: THREE.BufferGeometry[] = [];
  const faceList: THREE.BufferGeometry[] = [];

  addSanctumPedestal(0.41, segs, 0.66, 0.39, bodyList, goldList);

  // Grand Archmage Hierophant Spire Vestments
  bodyList.push(
    createSculptedLathe(
      [
        [0.32, 0.15],
        [0.25, 0.56],
        [0.19, 0.92],
        [0.24, 1.18],
        [0.15, 1.26],
        [0.001, 1.28]
      ],
      segs
    )
  );

  // Giant Vertical Astrolabe Halo Ring + 4 Cardinal Star Spikes behind the Archmage King!
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.34, 0.024, 8, segs), {
      position: [0, 1.28, -0.08]
    })
  );
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    goldList.push(
      prepGeo(new THREE.ConeGeometry(0.025, 0.14, 4), {
        rotation: [0, 0, -a + Math.PI / 2],
        position: [Math.cos(a) * 0.40, 1.28 + Math.sin(a) * 0.40, -0.08]
      })
    );
  }

  // Archmage Head + Towering Triple-Tiered Astral Spire Crown
  faceList.push(
    prepGeo(new THREE.CylinderGeometry(0.115, 0.11, 0.20, 16), {
      position: [0, 1.35, 0]
    })
  );
  bodyList.push(
    prepGeo(new THREE.ConeGeometry(0.15, 0.48, 8), {
      position: [0, 1.62, 0]
    })
  );
  for (const [cy, cr] of [
    [1.44, 0.15],
    [1.58, 0.115],
    [1.72, 0.075]
  ]) {
    goldList.push(
      prepGeo(new THREE.TorusGeometry(cr, 0.018, 8, 18), {
        rotation: [Math.PI / 2, 0, 0],
        position: [0, cy, 0]
      })
    );
  }
  // Levitating Astral Cross-Star Finial at Crown Apex
  goldList.push(
    prepGeo(new THREE.OctahedronGeometry(0.065, 0), {
      scale: [1.0, 1.6, 1.0],
      position: [0, 1.92, 0]
    })
  );

  // Staff of the Cosmos held in front (+Z = 0.26)
  goldList.push(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.024, 1.48, 8), {
      position: [0, 0.82, 0.26]
    })
  );
  goldList.push(
    prepGeo(new THREE.TorusGeometry(0.12, 0.018, 8, 20), {
      position: [0, 1.56, 0.26]
    })
  );
  steelList.push(
    prepGeo(new THREE.OctahedronGeometry(0.065, 0), {
      position: [0, 1.56, 0.26]
    })
  );

  return {
    body: finalizeMerged(bodyList),
    gold: finalizeMerged(goldList),
    steel: finalizeMerged(steelList),
    face: finalizeMerged(faceList)
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
  if (skinId === 'runic_warforged') {
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
