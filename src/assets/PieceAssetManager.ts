import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Color, MapId, PieceSkinId, PieceSymbol, Square } from '../engine/types';
import { getPieceGeometryParts, type PieceMeshParts } from './PieceGeometryBuilder';
import { createMarbleTextures, getAdaptiveTextureSize, type QualityTier } from './ProceduralTextures';

const SYMBOL_TO_GLB_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  r: 'rook',
  n: 'knight',
  b: 'bishop',
  q: 'queen',
  k: 'king'
};

export interface FactionMaterialSet {
  body: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
}

const HITBOX_TOP_BY_PIECE: Record<PieceSymbol, number> = {
  p: 0.92,
  r: 1.14,
  n: 1.20,
  b: 1.24,
  q: 1.34,
  k: 1.44
};

const NOOP_RAYCAST = (): void => {
  // Decorative visual sub-meshes delegate picking to the piece's bounded selection hitbox
};

export class PieceAssetManager {
  private glbParts = new Map<PieceSymbol, PieceMeshParts>();
  private hitboxGeos = new Map<PieceSymbol, THREE.BufferGeometry>();
  private hitboxMat: THREE.MeshBasicMaterial;
  private glbLoaded = false;
  private materials: Record<Color, FactionMaterialSet>;
  private contactShadowGeo: THREE.RingGeometry;
  private contactShadowMat: THREE.MeshBasicMaterial;
  private idleClip: THREE.AnimationClip;
  private attackClip: THREE.AnimationClip;
  private texSize: number;
  private quality: QualityTier;
  private isMobile: boolean;
  private currentMap: MapId = 'cathedral';
  private currentSkin: PieceSkinId = 'arcane_royalty';

  constructor(quality: QualityTier = 'high', isMobile = false) {
    this.quality = quality;
    this.isMobile = isMobile;
    this.texSize = getAdaptiveTextureSize(quality, isMobile);
    const whiteMarble = createMarbleTextures('white', Math.min(512, this.texSize), 'cathedral');
    const blackMarble = createMarbleTextures('black', Math.min(512, this.texSize), 'cathedral');

    this.materials = {
      w: {
        body: new THREE.MeshPhysicalMaterial({
          name: 'WhiteAlabasterBody',
          color: new THREE.Color('#efe7d8'),
          map: whiteMarble.map,
          roughnessMap: whiteMarble.roughnessMap,
          roughness: 0.24,
          metalness: 0.04,
          clearcoat: 0.28,
          clearcoatRoughness: 0.18
        }),
        gold: new THREE.MeshStandardMaterial({
          name: 'WhiteRoyalGold',
          color: new THREE.Color('#ebb138'),
          roughness: 0.22,
          metalness: 0.92
        }),
        steel: new THREE.MeshStandardMaterial({
          name: 'WhiteBrushedSteel',
          color: new THREE.Color('#c8d0d8'),
          roughness: 0.24,
          metalness: 0.88
        }),
        face: new THREE.MeshStandardMaterial({
          name: 'WhiteSculptedFace',
          color: new THREE.Color('#e8c4a8'),
          roughness: 0.38,
          metalness: 0.02
        })
      },
      b: {
        body: new THREE.MeshPhysicalMaterial({
          name: 'BlackObsidianBody',
          color: new THREE.Color('#13161d'),
          map: blackMarble.map,
          roughnessMap: blackMarble.roughnessMap,
          roughness: 0.24,
          metalness: 0.22,
          clearcoat: 0.34,
          clearcoatRoughness: 0.16
        }),
        gold: new THREE.MeshStandardMaterial({
          name: 'BlackImperialGold',
          color: new THREE.Color('#f0b436'),
          roughness: 0.20,
          metalness: 0.93
        }),
        steel: new THREE.MeshStandardMaterial({
          name: 'BlackBrushedSteel',
          color: new THREE.Color('#bfc7d0'),
          roughness: 0.24,
          metalness: 0.88
        }),
        face: new THREE.MeshStandardMaterial({
          name: 'BlackSculptedFace',
          color: new THREE.Color('#232630'),
          roughness: 0.34,
          metalness: 0.14
        })
      }
    };

    this.contactShadowGeo = new THREE.RingGeometry(0.01, 0.36, 24);
    this.contactShadowGeo.rotateX(-Math.PI / 2);
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    });

    this.hitboxMat = new THREE.MeshBasicMaterial({
      name: 'PieceSelectionHitboxMaterial',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      side: THREE.DoubleSide
    });

    for (const sym of ['p', 'r', 'n', 'b', 'q', 'k'] as PieceSymbol[]) {
      const topY = HITBOX_TOP_BY_PIECE[sym];
      const profile = [
        new THREE.Vector2(0.001, 0.0),
        new THREE.Vector2(0.41, 0.0),
        new THREE.Vector2(0.41, 0.26),
        new THREE.Vector2(0.32, 0.56),
        new THREE.Vector2(0.25, topY),
        new THREE.Vector2(0.001, topY)
      ];
      const geo = new THREE.LatheGeometry(profile, 12);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      this.hitboxGeos.set(sym, geo);
    }

    this.idleClip = this.createIdleAnimationClip();
    this.attackClip = this.createAttackAnimationClip();
    this.syncMaterialQualityAndSkin();
  }

  public getSkin(): PieceSkinId {
    return this.currentSkin;
  }

  public setSkin(skinId: PieceSkinId): void {
    this.currentSkin = skinId;
    this.syncMaterialQualityAndSkin();
  }

  public setQuality(quality: QualityTier): void {
    this.quality = quality;
    this.texSize = getAdaptiveTextureSize(quality, this.isMobile);
    this.syncMaterialQualityAndSkin();
  }

  private syncMaterialQualityAndSkin(): void {
    const isLow = this.quality === 'low';
    const isMed = this.quality === 'medium';

    // Skin-specific tint nuances while preserving clear White vs Black readability
    if (this.currentSkin === 'classic') {
      this.materials.w.body.color.set('#f6f1e6');
      this.materials.w.gold.color.set('#d4a84f');
      this.materials.w.steel.color.set('#d8dde4');
      this.materials.b.body.color.set('#18181d');
      this.materials.b.gold.color.set('#c89c42');
      this.materials.b.steel.color.set('#7a828e');
    } else if (this.currentSkin === 'runic_warforged') {
      this.materials.w.body.color.set('#e3dfd7');
      this.materials.w.gold.color.set('#df9b2e');
      this.materials.w.steel.color.set('#b4c0cc');
      this.materials.b.body.color.set('#161920');
      this.materials.b.gold.color.set('#e69f2c');
      this.materials.b.steel.color.set('#8f9aa8');
    } else if (this.currentSkin === 'mystic_sanctum') {
      this.materials.w.body.color.set('#edf2fc');
      this.materials.w.gold.color.set('#f5cb5c');
      this.materials.w.steel.color.set('#5ce1ff');
      this.materials.b.body.color.set('#111326');
      this.materials.b.gold.color.set('#f0c24b');
      this.materials.b.steel.color.set('#44d2ff');
    } else {
      // arcane_royalty
      if (this.currentMap === 'warhall') {
        this.materials.w.body.color.set('#eadbc4');
        this.materials.w.gold.color.set('#df9d2e');
        this.materials.b.body.color.set('#1a1412');
        this.materials.b.gold.color.set('#e5a232');
      } else if (this.currentMap === 'sanctum') {
        this.materials.w.body.color.set('#e4ecf8');
        this.materials.w.gold.color.set('#f4c855');
        this.materials.b.body.color.set('#101322');
        this.materials.b.gold.color.set('#eab844');
      } else {
        this.materials.w.body.color.set('#efe7d8');
        this.materials.w.gold.color.set('#ebb138');
        this.materials.b.body.color.set('#13161d');
        this.materials.b.gold.color.set('#f0b436');
      }
      this.materials.w.steel.color.set('#c8d0d8');
      this.materials.b.steel.color.set('#bfc7d0');
    }

    if (isLow) {
      // True Low Graphics Mode: flat, matte, zero clearcoat, zero environment reflection complexity
      for (const c of ['w', 'b'] as const) {
        this.materials[c].body.roughness = 0.88;
        this.materials[c].body.metalness = 0.04;
        this.materials[c].body.clearcoat = 0.0;
        this.materials[c].body.envMapIntensity = 0.0;
        this.materials[c].gold.roughness = 0.56;
        this.materials[c].gold.metalness = 0.42;
        this.materials[c].gold.envMapIntensity = 0.0;
        this.materials[c].steel.roughness = 0.58;
        this.materials[c].steel.metalness = 0.38;
        this.materials[c].steel.envMapIntensity = 0.0;
        this.materials[c].face.envMapIntensity = 0.0;
      }
    } else if (isMed) {
      for (const c of ['w', 'b'] as const) {
        this.materials[c].body.roughness = 0.34;
        this.materials[c].body.metalness = c === 'w' ? 0.04 : 0.16;
        this.materials[c].body.clearcoat = 0.12;
        this.materials[c].body.envMapIntensity = 0.22;
        this.materials[c].gold.roughness = 0.28;
        this.materials[c].gold.metalness = 0.85;
        this.materials[c].gold.envMapIntensity = 0.24;
        this.materials[c].steel.roughness = 0.30;
        this.materials[c].steel.metalness = 0.80;
        this.materials[c].steel.envMapIntensity = 0.22;
      }
    } else {
      // High Graphics Mode
      for (const c of ['w', 'b'] as const) {
        this.materials[c].body.roughness = 0.24;
        this.materials[c].body.metalness = c === 'w' ? 0.04 : 0.22;
        this.materials[c].body.clearcoat = c === 'w' ? 0.28 : 0.34;
        this.materials[c].body.envMapIntensity = 0.38;
        this.materials[c].gold.roughness = 0.20;
        this.materials[c].gold.metalness = 0.92;
        this.materials[c].gold.envMapIntensity = 0.42;
        this.materials[c].steel.roughness = 0.22;
        this.materials[c].steel.metalness = 0.88;
        this.materials[c].steel.envMapIntensity = 0.38;
      }
    }

    for (const c of ['w', 'b'] as const) {
      this.materials[c].body.needsUpdate = true;
      this.materials[c].gold.needsUpdate = true;
      this.materials[c].steel.needsUpdate = true;
    }
  }

  /**
   * Updates piece faction materials to complement the active map's palette and lighting mood.
   */
  public applyMapTheme(mapId: MapId): void {
    this.currentMap = mapId;
    const res = Math.min(512, this.texSize);
    const whiteMarble = createMarbleTextures('white', res, mapId);
    const blackMarble = createMarbleTextures('black', res, mapId);

    this.materials.w.body.map = whiteMarble.map;
    this.materials.w.body.roughnessMap = whiteMarble.roughnessMap;
    this.materials.b.body.map = blackMarble.map;
    this.materials.b.body.roughnessMap = blackMarble.roughnessMap;

    this.syncMaterialQualityAndSkin();
  }

  private createIdleAnimationClip(): THREE.AnimationClip {
    const times = [0, 1.5, 3.0];
    const scaleValues = [
      1, 1, 1,
      1, 1.014, 1,
      1, 1, 1
    ];
    const scaleTrack = new THREE.VectorKeyframeTrack('.scale', times, scaleValues);

    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
    const qMid = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.012, 0.018, -0.008));
    const quatValues = [
      q0.x, q0.y, q0.z, q0.w,
      qMid.x, qMid.y, qMid.z, qMid.w,
      q0.x, q0.y, q0.z, q0.w
    ];
    const quatTrack = new THREE.QuaternionKeyframeTrack('.quaternion', times, quatValues);

    return new THREE.AnimationClip('IdleBreathing', 3.0, [scaleTrack, quatTrack]);
  }

  private createAttackAnimationClip(): THREE.AnimationClip {
    const times = [0, 0.18, 0.38, 0.65];
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
    const qWindup = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.26, 0, 0));
    const qStrike = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.36, 0, 0));
    const values = [
      q0.x, q0.y, q0.z, q0.w,
      qWindup.x, qWindup.y, qWindup.z, qWindup.w,
      qStrike.x, qStrike.y, qStrike.z, qStrike.w,
      q0.x, q0.y, q0.z, q0.w
    ];
    const quatTrack = new THREE.QuaternionKeyframeTrack('.quaternion', times, values);
    return new THREE.AnimationClip('WeaponStrike', 0.65, [quatTrack]);
  }

  public async loadGLBAssets(url = './models/arcane_pieces.glb'): Promise<boolean> {
    if (this.glbLoaded) return true;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return false;
    }

    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(url);
      for (const [symbol, name] of Object.entries(SYMBOL_TO_GLB_NAME) as Array<[PieceSymbol, string]>) {
        const pieceNode = gltf.scene.getObjectByName(name);
        if (!pieceNode) continue;

        let bodyGeo: THREE.BufferGeometry | null = null;
        let goldGeo: THREE.BufferGeometry | null = null;
        let steelGeo: THREE.BufferGeometry | null = null;
        let faceGeo: THREE.BufferGeometry | null = null;

        pieceNode.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const n = child.name.toLowerCase();
            if (n === 'body' || n.startsWith('body_') || n.includes('_body')) bodyGeo = mesh.geometry;
            else if (n === 'gold' || n.startsWith('gold_') || n.includes('_gold')) goldGeo = mesh.geometry;
            else if (n === 'steel' || n.startsWith('steel_') || n.includes('_steel')) steelGeo = mesh.geometry;
            else if (n === 'face' || n.startsWith('face_') || n.includes('_face')) faceGeo = mesh.geometry;
          }
        });

        if (bodyGeo && goldGeo && steelGeo && faceGeo) {
          this.glbParts.set(symbol, {
            body: bodyGeo,
            gold: goldGeo,
            steel: steelGeo,
            face: faceGeo
          });
        }
      }

      this.glbLoaded = this.glbParts.size === 6;
      return this.glbLoaded;
    } catch {
      return false;
    }
  }

  public isGLBLoaded(): boolean {
    return this.glbLoaded;
  }

  public getMaterials(color: Color): FactionMaterialSet {
    return this.materials[color];
  }

  public createPieceInstance(
    type: PieceSymbol,
    color: Color,
    square: Square,
    castShadows = true
  ): THREE.Group {
    const root = new THREE.Group();
    root.name = `piece_${color}_${type}_${square}`;

    const useGlb = this.currentSkin === 'arcane_royalty' && this.glbParts.has(type);
    const highParts = useGlb
      ? this.glbParts.get(type)!
      : getPieceGeometryParts(type, 'high', this.currentSkin);
    const lowParts = getPieceGeometryParts(type, 'low', this.currentSkin);
    const matSet = this.materials[color];

    // Inner rig group driven by THREE.AnimationMixer & combat articulation so root position/yaw remain cleanly controlled by board coordinates
    const rigGroup = new THREE.Group();
    rigGroup.name = 'piece_rig';

    const lod = new THREE.LOD();
    lod.name = 'piece_lod';

    if (this.quality === 'low') {
      // In Low Graphics Mode, exclusively use the lightweight low-segment mesh at all distances with shadows off
      const lowGroup = this.buildMeshGroup(lowParts, matSet, false, 'lod1');
      lod.addLevel(lowGroup, 0);
    } else {
      const highGroup = this.buildMeshGroup(highParts, matSet, castShadows, 'lod0');
      const lowGroup = this.buildMeshGroup(lowParts, matSet, false, 'lod1');
      lod.addLevel(highGroup, 0);
      lod.addLevel(lowGroup, 22);
    }

    rigGroup.add(lod);
    root.add(rigGroup);

    // Set up Three.js AnimationMixer on rigGroup
    const mixer = new THREE.AnimationMixer(rigGroup);
    const idleAction = mixer.clipAction(this.idleClip);
    idleAction.time = (square.charCodeAt(0) * 0.37 + square.charCodeAt(1) * 0.53) % 3.0;
    idleAction.play();
    const attackAction = mixer.clipAction(this.attackClip);
    attackAction.setLoop(THREE.LoopOnce, 1);
    attackAction.clampWhenFinished = false;

    const contactShadow = new THREE.Mesh(this.contactShadowGeo, this.contactShadowMat);
    contactShadow.position.y = 0.006;
    contactShadow.name = 'contact_shadow';
    contactShadow.raycast = NOOP_RAYCAST;
    root.add(contactShadow);

    // Dedicated watertight, skin-invariant selection hitbox centered on the square
    const hitboxGeo = this.hitboxGeos.get(type)!;
    const hitboxMesh = new THREE.Mesh(hitboxGeo, this.hitboxMat);
    hitboxMesh.name = 'piece_hitbox';
    hitboxMesh.userData.isPieceHitbox = true;
    root.add(hitboxMesh);

    const facingYaw = color === 'w' ? Math.PI : 0;
    root.rotation.y = facingYaw;

    root.userData.mixer = mixer;
    root.userData.idleAction = idleAction;
    root.userData.attackAction = attackAction;
    root.userData.rigGroup = rigGroup;
    root.userData.hitboxMesh = hitboxMesh;

    this.tagPieceMetadata(root, type, color, square, facingYaw);
    return root;
  }

  private buildMeshGroup(
    parts: PieceMeshParts,
    matSet: FactionMaterialSet,
    castShadows: boolean,
    levelName: string
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = levelName;

    const bodyMesh = new THREE.Mesh(parts.body, matSet.body);
    bodyMesh.name = 'body';
    bodyMesh.castShadow = castShadows;
    bodyMesh.receiveShadow = true;
    bodyMesh.raycast = NOOP_RAYCAST;

    const goldMesh = new THREE.Mesh(parts.gold, matSet.gold);
    goldMesh.name = 'gold';
    goldMesh.castShadow = castShadows;
    goldMesh.receiveShadow = true;
    goldMesh.raycast = NOOP_RAYCAST;

    const steelMesh = new THREE.Mesh(parts.steel, matSet.steel);
    steelMesh.name = 'steel';
    steelMesh.castShadow = castShadows;
    steelMesh.receiveShadow = true;
    steelMesh.raycast = NOOP_RAYCAST;

    const faceMesh = new THREE.Mesh(parts.face, matSet.face);
    faceMesh.name = 'face';
    faceMesh.castShadow = castShadows;
    faceMesh.receiveShadow = true;
    faceMesh.raycast = NOOP_RAYCAST;

    group.add(bodyMesh, goldMesh, steelMesh, faceMesh);
    return group;
  }

  public tagPieceMetadata(
    root: THREE.Object3D,
    type: PieceSymbol,
    color: Color,
    square: Square,
    baseYaw?: number
  ): void {
    const yaw = baseYaw ?? root.userData.baseYaw ?? (color === 'w' ? Math.PI : 0);
    root.userData = {
      ...root.userData,
      isChessPiece: true,
      type,
      color,
      square,
      baseYaw: yaw
    };

    root.traverse((child) => {
      if (child !== root) {
        child.userData = {
          ...child.userData,
          isChessPiecePart: true,
          pieceRoot: root,
          type,
          color,
          square
        };
      }
    });
  }
}
