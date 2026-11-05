import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Color, MapId, PieceSymbol, Square } from '../engine/types';
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

export class PieceAssetManager {
  private glbParts = new Map<PieceSymbol, PieceMeshParts>();
  private glbLoaded = false;
  private materials: Record<Color, FactionMaterialSet>;
  private contactShadowGeo: THREE.RingGeometry;
  private contactShadowMat: THREE.MeshBasicMaterial;
  private idleClip: THREE.AnimationClip;
  private attackClip: THREE.AnimationClip;
  private texSize: number;

  constructor(quality: QualityTier = 'high', isMobile = false) {
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

    this.idleClip = this.createIdleAnimationClip();
    this.attackClip = this.createAttackAnimationClip();
  }

  /**
   * Updates piece faction materials to complement the active map's palette and lighting mood.
   */
  public applyMapTheme(mapId: MapId): void {
    const res = Math.min(512, this.texSize);
    const whiteMarble = createMarbleTextures('white', res, mapId);
    const blackMarble = createMarbleTextures('black', res, mapId);

    this.materials.w.body.map = whiteMarble.map;
    this.materials.w.body.roughnessMap = whiteMarble.roughnessMap;
    this.materials.b.body.map = blackMarble.map;
    this.materials.b.body.roughnessMap = blackMarble.roughnessMap;

    if (mapId === 'cathedral') {
      this.materials.w.body.color.set('#efe7d8');
      this.materials.w.gold.color.set('#ebb138');
      this.materials.b.body.color.set('#13161d');
      this.materials.b.gold.color.set('#f0b436');
    } else if (mapId === 'warhall') {
      // Warm champagne travertine & blackened iron-bronze with burnished brass-gold
      this.materials.w.body.color.set('#eadbc4');
      this.materials.w.gold.color.set('#df9d2e');
      this.materials.b.body.color.set('#1a1412');
      this.materials.b.gold.color.set('#e5a232');
    } else if (mapId === 'sanctum') {
      // Moonlight silver-alabaster & deep astral obsidian with celestial gold
      this.materials.w.body.color.set('#e4ecf8');
      this.materials.w.gold.color.set('#f4c855');
      this.materials.b.body.color.set('#101322');
      this.materials.b.gold.color.set('#eab844');
    }

    this.materials.w.body.needsUpdate = true;
    this.materials.b.body.needsUpdate = true;
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

    const highParts = this.glbParts.get(type) ?? getPieceGeometryParts(type, 'high');
    const lowParts = getPieceGeometryParts(type, 'low');
    const matSet = this.materials[color];

    // Inner rig group driven by THREE.AnimationMixer & combat articulation so root position/yaw remain cleanly controlled by board coordinates
    const rigGroup = new THREE.Group();
    rigGroup.name = 'piece_rig';

    const lod = new THREE.LOD();
    lod.name = 'piece_lod';

    const highGroup = this.buildMeshGroup(highParts, matSet, castShadows, 'lod0');
    const lowGroup = this.buildMeshGroup(lowParts, matSet, false, 'lod1');

    lod.addLevel(highGroup, 0);
    lod.addLevel(lowGroup, 22);
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
    root.add(contactShadow);

    const facingYaw = color === 'w' ? Math.PI : 0;
    root.rotation.y = facingYaw;

    root.userData.mixer = mixer;
    root.userData.idleAction = idleAction;
    root.userData.attackAction = attackAction;
    root.userData.rigGroup = rigGroup;

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

    const goldMesh = new THREE.Mesh(parts.gold, matSet.gold);
    goldMesh.name = 'gold';
    goldMesh.castShadow = castShadows;
    goldMesh.receiveShadow = true;

    const steelMesh = new THREE.Mesh(parts.steel, matSet.steel);
    steelMesh.name = 'steel';
    steelMesh.castShadow = castShadows;
    steelMesh.receiveShadow = true;

    const faceMesh = new THREE.Mesh(parts.face, matSet.face);
    faceMesh.name = 'face';
    faceMesh.castShadow = castShadows;
    faceMesh.receiveShadow = true;

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
