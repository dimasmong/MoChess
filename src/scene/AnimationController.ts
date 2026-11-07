import * as THREE from 'three';
import type { MoveRecord, PieceSkinId, PieceSymbol } from '../engine/types';
import { createArcaneSigilTexture } from '../assets/ProceduralTextures';
import { squareToWorldPosition } from './ChessboardBuilder';

interface ActivePieceTween {
  object: THREE.Object3D;
  fromPos: THREE.Vector3;
  strikePos: THREE.Vector3;
  toPos: THREE.Vector3;
  arcHeight: number;
  pieceType: PieceSymbol;
  isCapture: boolean;
  impactTriggered: boolean;
  move: MoveRecord;
  victimPiece?: THREE.Object3D;
  elapsed: number;
  duration: number;
  baseYaw: number;
  attackYaw: number;
  onComplete?: () => void;
}

interface ActiveCaptureEffect {
  group: THREE.Group;
  victimPiece?: THREE.Object3D;
  victimStartPos: THREE.Vector3;
  knockbackDir: THREE.Vector3;
  roleMeshes: Array<{
    mesh: THREE.Mesh;
    kind: 'slash' | 'beam' | 'lance' | 'ring';
  }>;
  shards: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    rotSpeed: THREE.Vector3;
  }>;
  shockwave: THREE.Mesh;
  elapsed: number;
  duration: number;
}

interface ActiveCheckmateCutscene {
  fxRoot: THREE.Group;
  winningKingObj: THREE.Object3D | null;
  defeatedKingObj: THREE.Object3D;
  winnerStartPos: THREE.Vector3;
  winnerStandoffPos: THREE.Vector3;
  defeatedStartPos: THREE.Vector3;
  attackDir: THREE.Vector3;
  attackYaw: number;
  skinId: PieceSkinId;
  crownHalo1: THREE.Mesh;
  crownHalo2: THREE.Mesh;
  executionSigil: THREE.Mesh;
  finisherBeam: THREE.Mesh;
  shockwave1: THREE.Mesh;
  shockwave2: THREE.Mesh;
  shards: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    rotSpeed: THREE.Vector3;
  }>;
  impactSpawned: boolean;
  elapsed: number;
  duration: number;
  onComplete?: () => void;
}

const ARC_HEIGHT_BY_PIECE: Record<PieceSymbol, number> = {
  n: 1.42, // Knight warhorse leaps high over obstacles
  b: 0.38, // Bishop glides smoothly
  q: 0.42, // Queen glides regally
  p: 0.22, // Pawn marches briskly
  k: 0.20, // King strides deliberately
  r: 0.07  // Rook slides like a heavy fortress
};

export class AnimationController {
  private readonly fxGroup: THREE.Group;
  private readonly tweens: ActivePieceTween[] = [];
  private readonly captureEffects: ActiveCaptureEffect[] = [];
  private activeCheckmate: ActiveCheckmateCutscene | null = null;
  private reducedMotion = false;
  private magicalFxEnabled = true;

  private readonly shardGeo = new THREE.OctahedronGeometry(0.072, 0);
  private readonly ringGeo: THREE.RingGeometry;
  private readonly slashGeo: THREE.RingGeometry;

  constructor(parentScene: THREE.Scene) {
    this.fxGroup = new THREE.Group();
    this.fxGroup.name = 'WizardChessVisualFX';
    parentScene.add(this.fxGroup);

    this.ringGeo = new THREE.RingGeometry(0.14, 0.28, 32);
    this.ringGeo.rotateX(-Math.PI / 2);

    this.slashGeo = new THREE.RingGeometry(0.32, 0.62, 20, 1, -Math.PI * 0.45, Math.PI * 0.9);
  }

  public setSettings(options: { reducedMotion?: boolean; magicalFxEnabled?: boolean }): void {
    if (options.reducedMotion !== undefined) this.reducedMotion = options.reducedMotion;
    if (options.magicalFxEnabled !== undefined) this.magicalFxEnabled = options.magicalFxEnabled;
  }

  private resetPieceRigTransform(pieceObj: THREE.Object3D, baseYaw: number): void {
    pieceObj.rotation.set(0, baseYaw, 0);
    pieceObj.scale.set(1, 1, 1);
    const rig = pieceObj.userData.rigGroup as THREE.Object3D | undefined;
    if (rig) {
      rig.position.set(0, 0, 0);
      rig.rotation.set(0, 0, 0);
      rig.scale.set(1, 1, 1);
    }
  }

  /**
   * Immediately finishes all active piece tweens and cleans up temporary capture meshes
   * so rapid moves, Undo, or Restart never desynchronize 3D positions from the engine.
   */
  public flushAllAnimations(): void {
    for (const tw of this.tweens) {
      tw.object.position.copy(tw.toPos);
      this.resetPieceRigTransform(tw.object, tw.baseYaw);
      if (tw.victimPiece && tw.victimPiece.parent) {
        tw.victimPiece.parent.remove(tw.victimPiece);
      }
      tw.onComplete?.();
    }
    this.tweens.length = 0;

    for (const fx of this.captureEffects) {
      if (fx.victimPiece && fx.victimPiece.parent) {
        fx.victimPiece.parent.remove(fx.victimPiece);
      }
      this.fxGroup.remove(fx.group);
    }
    this.captureEffects.length = 0;

    if (this.activeCheckmate) {
      this.fxGroup.remove(this.activeCheckmate.fxRoot);
      const cb = this.activeCheckmate.onComplete;
      this.activeCheckmate = null;
      cb?.();
    }
  }

  public isCheckmateCutsceneActive(): boolean {
    return this.activeCheckmate !== null;
  }

  /**
   * Animates a chess piece moving from `move.from` to `move.to`, with anticipation,
   * role-specific locomotion, and a multi-stage role-specific battle sequence on captures.
   */
  public animateMove(
    movingPieceObj: THREE.Object3D,
    move: MoveRecord,
    capturedPieceObj?: THREE.Object3D | null,
    castlingRookObj?: THREE.Object3D | null,
    onFinished?: () => void
  ): void {
    const fromPos = squareToWorldPosition(move.from, 0);
    const toPos = squareToWorldPosition(move.to, 0);
    const baseYaw = movingPieceObj.userData.baseYaw ?? (move.color === 'w' ? Math.PI : 0);

    if (this.reducedMotion) {
      movingPieceObj.position.copy(toPos);
      this.resetPieceRigTransform(movingPieceObj, baseYaw);
      if (capturedPieceObj && capturedPieceObj.parent) {
        capturedPieceObj.parent.remove(capturedPieceObj);
      }
      if (castlingRookObj && move.castling) {
        castlingRookObj.position.copy(squareToWorldPosition(move.castling.rookTo, 0));
      }
      onFinished?.();
      return;
    }

    const isCapture = Boolean(move.captured && move.capturedSquare);
    const deltaVec = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = Math.max(0.001, deltaVec.length());
    const moveDir = deltaVec.clone().normalize();
    // Compute yaw facing the target square
    const attackYaw = Math.atan2(moveDir.x, moveDir.z);

    // Strike standoff point just before the target square so attacker battles the defender face-to-face
    const standoffDist = Math.min(dist * 0.45, move.piece === 'b' || move.piece === 'q' ? 0.82 : 0.58);
    const strikePos = isCapture
      ? toPos.clone().addScaledVector(moveDir, -standoffDist)
      : toPos.clone();

    const duration = isCapture ? 0.84 : move.piece === 'n' ? 0.62 : 0.48;
    const arcHeight = ARC_HEIGHT_BY_PIECE[move.piece] ?? 0.22;

    if (isCapture && movingPieceObj.userData.attackAction) {
      const action = movingPieceObj.userData.attackAction as THREE.AnimationAction;
      action.reset();
      action.play();
    }

    this.tweens.push({
      object: movingPieceObj,
      fromPos,
      strikePos,
      toPos,
      arcHeight,
      pieceType: move.piece,
      isCapture,
      impactTriggered: false,
      move,
      victimPiece: capturedPieceObj ?? undefined,
      elapsed: 0,
      duration,
      baseYaw,
      attackYaw,
      onComplete: onFinished
    });

    if (castlingRookObj && move.castling) {
      const rookFrom = squareToWorldPosition(move.castling.rookFrom, 0);
      const rookTo = squareToWorldPosition(move.castling.rookTo, 0);
      const rookYaw = castlingRookObj.userData.baseYaw ?? baseYaw;
      this.tweens.push({
        object: castlingRookObj,
        fromPos: rookFrom,
        strikePos: rookTo,
        toPos: rookTo,
        arcHeight: 0.12,
        pieceType: 'r',
        isCapture: false,
        impactTriggered: false,
        move,
        elapsed: 0,
        duration: 0.48,
        baseYaw: rookYaw,
        attackYaw: rookYaw
      });
    }
  }

  /**
   * Spawns role-specific weapon slash / arcane beam / seismic crush effects and triggers the
   * defender's hit-recoil and shatter sequence at the moment of impact (`t >= 0.40`).
   */
  private spawnRoleBattleSequence(
    move: MoveRecord,
    attackerPos: THREE.Vector3,
    victimPiece?: THREE.Object3D
  ): void {
    const capSquare = move.capturedSquare ?? move.to;
    const targetPos = squareToWorldPosition(capSquare, 0.02);

    if (!this.magicalFxEnabled) {
      if (victimPiece && victimPiece.parent) {
        victimPiece.parent.remove(victimPiece);
      }
      return;
    }

    const group = new THREE.Group();
    group.position.copy(targetPos);
    this.fxGroup.add(group);

    const isWhiteAttacker = move.color === 'w';
    const primaryHex =
      move.piece === 'b' || move.piece === 'q'
        ? isWhiteAttacker
          ? 0x70d6ff
          : 0xb866ff
        : isWhiteAttacker
          ? 0xf7c844
          : 0xff5a2a;

    const ringMat = new THREE.MeshBasicMaterial({
      color: primaryHex,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const shockwave = new THREE.Mesh(this.ringGeo, ringMat);
    shockwave.position.y = 0.03;
    group.add(shockwave);

    const knockbackDir = new THREE.Vector3()
      .subVectors(targetPos, attackerPos)
      .setY(0)
      .normalize();
    if (knockbackDir.lengthSq() < 0.01) {
      knockbackDir.set(0, 0, isWhiteAttacker ? -1 : 1);
    }

    const roleMeshes: ActiveCaptureEffect['roleMeshes'] = [];

    // Role-specific weapon / magic strike visual
    if (move.piece === 'p' || move.piece === 'k') {
      // Sword-bearing pieces: Glowing golden/crimson sword slash crescent arc
      const slashMat = new THREE.MeshBasicMaterial({
        color: primaryHex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const slashMesh = new THREE.Mesh(this.slashGeo, slashMat);
      slashMesh.position.set(0, 0.58, 0);
      slashMesh.rotation.x = move.piece === 'k' ? 0.25 : 0.75;
      slashMesh.rotation.y = Math.atan2(knockbackDir.x, knockbackDir.z);
      group.add(slashMesh);
      roleMeshes.push({ mesh: slashMesh, kind: 'slash' });
    } else if (move.piece === 'n') {
      // Knight: Couched lance thrust cone + impact ring
      const lanceMat = new THREE.MeshBasicMaterial({
        color: primaryHex,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const lanceCone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.15, 12, 1, true), lanceMat);
      lanceCone.rotation.x = Math.PI / 2;
      lanceCone.position.set(0, 0.55, 0);
      lanceCone.lookAt(targetPos.clone().add(knockbackDir).setY(0.55));
      group.add(lanceCone);
      roleMeshes.push({ mesh: lanceCone, kind: 'lance' });
    } else if (move.piece === 'b' || move.piece === 'q') {
      // Bishop / Queen: Vertical celestial/arcane spell pillar + sacred rune burst
      const beamMat = new THREE.MeshBasicMaterial({
        color: primaryHex,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const radius = move.piece === 'q' ? 0.36 : 0.22;
      const beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius, 2.6, 16, 1, true), beamMat);
      beamMesh.position.set(0, 1.3, 0);
      group.add(beamMesh);
      roleMeshes.push({ mesh: beamMesh, kind: 'beam' });
    } else if (move.piece === 'r') {
      // Rook: Heavy fortress crush — secondary elevated seismic shockwave ring
      const crushMat = new THREE.MeshBasicMaterial({
        color: 0xffaa33,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const crushRing = new THREE.Mesh(this.ringGeo, crushMat);
      crushRing.position.y = 0.18;
      group.add(crushRing);
      roleMeshes.push({ mesh: crushRing, kind: 'ring' });
    }

    const shardMat = new THREE.MeshStandardMaterial({
      color: isWhiteAttacker ? 0x1a1d26 : 0xefe7d8,
      emissive: primaryHex,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.65
    });

    const shards: ActiveCaptureEffect['shards'] = [];
    const shardCount = 20;
    for (let i = 0; i < shardCount; i++) {
      const mesh = new THREE.Mesh(this.shardGeo, shardMat);
      const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.35;
      const speed = 1.5 + Math.random() * 2.5;
      mesh.position.set(
        (Math.random() - 0.5) * 0.28,
        0.22 + Math.random() * 0.65,
        (Math.random() - 0.5) * 0.28
      );
      group.add(mesh);

      shards.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed + knockbackDir.x * 1.1,
          2.0 + Math.random() * 2.6,
          Math.sin(angle) * speed + knockbackDir.z * 1.1
        ),
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        )
      });
    }

    this.captureEffects.push({
      group,
      victimPiece,
      victimStartPos: victimPiece ? victimPiece.position.clone() : targetPos.clone(),
      knockbackDir,
      roleMeshes,
      shards,
      shockwave,
      elapsed: 0,
      duration: 0.65
    });
  }

  /**
   * Triggers a full cinematic KING vs KING Checkmate Finisher Cutscene:
   * 1. Winning King approaches to ceremonial striking distance in front of the Defeated King.
   * 2. Orbiting crown halos and skin-specific execution sigil materialize.
   * 3. Skin-specific finisher strike (Arcane Royalty, Runic Warforged, Mystic Sanctum, or Classic Staunton)
   *    blasts the Defeated King, causing violent impact shudder, flying fracture shards, and a 58-degree defeat topple.
   * 4. Fires `onComplete` when the finisher concludes so the Victory / Defeat Result Screen appears.
   */
  public triggerCheckmateSequence(
    defeatedKingObj: THREE.Object3D | null,
    winningKingObj?: THREE.Object3D | null,
    skinId: PieceSkinId = 'arcane_royalty',
    onComplete?: () => void
  ): void {
    if (!defeatedKingObj) {
      onComplete?.();
      return;
    }

    if (this.activeCheckmate) {
      this.fxGroup.remove(this.activeCheckmate.fxRoot);
      this.activeCheckmate = null;
    }

    const defeatedRig = (defeatedKingObj.userData.rigGroup as THREE.Object3D) ?? defeatedKingObj;
    const defeatedStartPos = defeatedKingObj.position.clone();

    if (this.reducedMotion) {
      defeatedRig.rotation.z = 0.72;
      defeatedRig.rotation.x = 0.38;
      onComplete?.();
      return;
    }

    const winnerStartPos = winningKingObj
      ? winningKingObj.position.clone()
      : defeatedStartPos.clone().add(new THREE.Vector3(0, 0, 1.8));

    const attackDir = new THREE.Vector3().subVectors(defeatedStartPos, winnerStartPos).setY(0);
    if (attackDir.lengthSq() < 0.01) {
      attackDir.set(0, 0, -1);
    } else {
      attackDir.normalize();
    }

    const attackYaw = Math.atan2(attackDir.x, attackDir.z);
    // Winning King glides to a commanding ceremonial standoff 1.45 units in front of the Losing King
    const winnerStandoffPos = defeatedStartPos.clone().addScaledVector(attackDir, -1.45);

    const fxRoot = new THREE.Group();
    fxRoot.name = `CheckmateFinisher_${skinId}`;
    this.fxGroup.add(fxRoot);

    // Skin-specific color palette for the King vs King finisher
    let primaryColor = 0xffbe3b;
    let secondaryColor = 0xb554ff;
    if (skinId === 'runic_warforged') {
      primaryColor = 0xff7b1c;
      secondaryColor = 0xffc83b;
    } else if (skinId === 'mystic_sanctum') {
      primaryColor = 0x54e4ff;
      secondaryColor = 0xffd458;
    } else if (skinId === 'classic') {
      primaryColor = 0xf4d068;
      secondaryColor = 0xfff4d2;
    }

    // 1. Orbiting Golden Halo Rings above the Winning King's Crown (matching Reference Image 2)
    const haloMat1 = new THREE.MeshBasicMaterial({
      color: primaryColor,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const haloMat2 = haloMat1.clone();
    haloMat2.color.setHex(secondaryColor);

    const crownHalo1 = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.018, 8, 36), haloMat1);
    crownHalo1.rotation.x = Math.PI / 2 + 0.22;
    const crownHalo2 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.014, 8, 36), haloMat2);
    crownHalo2.rotation.x = Math.PI / 2 - 0.26;
    fxRoot.add(crownHalo1, crownHalo2);

    // 2. Vertical Execution Sigil Wheel between Winning King and Defeated King
    const sigilTex = createArcaneSigilTexture('capture');
    const sigilMat = new THREE.MeshBasicMaterial({
      map: sigilTex,
      color: primaryColor,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const executionSigil = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), sigilMat);
    const sigilPos = defeatedStartPos.clone().addScaledVector(attackDir, -0.72).setY(0.88);
    executionSigil.position.copy(sigilPos);
    executionSigil.lookAt(defeatedStartPos.clone().setY(0.88));
    fxRoot.add(executionSigil);

    // 3. Finisher Execution Beam / Shock Pillar
    const beamMat = new THREE.MeshBasicMaterial({
      color: primaryColor,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const beamGeo =
      skinId === 'runic_warforged' || skinId === 'classic'
        ? new THREE.CylinderGeometry(0.42, 0.56, 3.2, 24, 1, true)
        : new THREE.CylinderGeometry(0.16, 0.34, 1.45, 20, 1, true);
    const finisherBeam = new THREE.Mesh(beamGeo, beamMat);
    if (skinId === 'runic_warforged' || skinId === 'classic') {
      finisherBeam.position.copy(defeatedStartPos).setY(1.55);
    } else {
      beamGeo.rotateX(Math.PI / 2);
      finisherBeam.position.copy(sigilPos);
      finisherBeam.lookAt(defeatedStartPos.clone().setY(0.75));
    }
    fxRoot.add(finisherBeam);

    // 4. Dual Expanding Ground Shockwave Rings under the Defeated King
    const swMat1 = new THREE.MeshBasicMaterial({
      color: primaryColor,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const swMat2 = swMat1.clone();
    swMat2.color.setHex(secondaryColor);

    const shockwave1 = new THREE.Mesh(this.ringGeo, swMat1);
    shockwave1.position.copy(defeatedStartPos).setY(0.03);
    const shockwave2 = new THREE.Mesh(this.ringGeo, swMat2);
    shockwave2.position.copy(defeatedStartPos).setY(0.05);
    fxRoot.add(shockwave1, shockwave2);

    // 5. Flying Fracture Debris Shards (restrained on Classic skin, explosive on Fantasy skins)
    const shardCount = skinId === 'classic' ? 8 : 26;
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x16141f,
      emissive: secondaryColor,
      emissiveIntensity: 1.15,
      roughness: 0.25,
      metalness: 0.72
    });
    const shards: ActiveCheckmateCutscene['shards'] = [];
    for (let i = 0; i < shardCount; i++) {
      const m = new THREE.Mesh(this.shardGeo, shardMat);
      m.visible = false;
      m.scale.setScalar(skinId === 'classic' ? 0.55 : 0.9 + Math.random() * 0.65);
      fxRoot.add(m);
      const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.3;
      const spd = 1.6 + Math.random() * 2.8;
      shards.push({
        mesh: m,
        velocity: new THREE.Vector3(
          Math.cos(angle) * spd + attackDir.x * 1.4,
          2.2 + Math.random() * 2.8,
          Math.sin(angle) * spd + attackDir.z * 1.4
        ),
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 11,
          (Math.random() - 0.5) * 11,
          (Math.random() - 0.5) * 11
        )
      });
    }

    this.activeCheckmate = {
      fxRoot,
      winningKingObj: winningKingObj ?? null,
      defeatedKingObj,
      winnerStartPos,
      winnerStandoffPos,
      defeatedStartPos,
      attackDir,
      attackYaw,
      skinId,
      crownHalo1,
      crownHalo2,
      executionSigil,
      finisherBeam,
      shockwave1,
      shockwave2,
      shards,
      impactSpawned: false,
      elapsed: 0,
      duration: 2.35,
      onComplete
    };
  }

  public update(delta: number, allPieces: Iterable<THREE.Object3D>): void {
    // 1. Update Three.js AnimationMixers for all pieces on the board
    if (!this.reducedMotion) {
      for (const piece of allPieces) {
        const mixer = piece.userData.mixer as THREE.AnimationMixer | undefined;
        if (mixer) {
          mixer.update(delta);
        }
      }
    }

    // 2. Update active piece movement & role-specific battle tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.elapsed += delta;
      const rawT = Math.min(1, tw.elapsed / tw.duration);
      const rig = (tw.object.userData.rigGroup as THREE.Object3D) ?? tw.object;

      if (!tw.isCapture) {
        // NON-CAPTURE LOCOMOTION: Anticipation (0..0.14) -> Role-Specific Travel (0.14..0.86) -> Settle (0.86..1.0)
        const easeT = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
        tw.object.position.lerpVectors(tw.fromPos, tw.toPos, easeT);

        // Face travel direction during movement, then smoothly blend back to baseYaw
        const yawBlend = Math.sin(rawT * Math.PI);
        tw.object.rotation.y = tw.baseYaw + Math.atan2(Math.sin(tw.attackYaw - tw.baseYaw), Math.cos(tw.attackYaw - tw.baseYaw)) * yawBlend * 0.45;

        const parabola = 4 * easeT * (1 - easeT);
        if (tw.pieceType === 'p') {
          // Pawn: Brisk infantry march with two distinct footstep hops and shield-forward lean
          const stepHop = Math.abs(Math.sin(rawT * Math.PI * 2)) * 0.18;
          tw.object.position.y = stepHop;
          rig.rotation.x = Math.sin(rawT * Math.PI) * 0.14;
          rig.rotation.z = Math.sin(rawT * Math.PI * 2) * 0.06;
        } else if (tw.pieceType === 'n') {
          // Knight: Warhorse rears back on takeoff, vaults high, and pitches forward on landing
          tw.object.position.y = parabola * tw.arcHeight;
          rig.rotation.x = -Math.sin(rawT * Math.PI * 2) * 0.34;
        } else if (tw.pieceType === 'b' || tw.pieceType === 'q') {
          // Bishop / Queen: Levitating arcane glide with serene poise
          tw.object.position.y = parabola * tw.arcHeight;
          rig.rotation.x = Math.sin(rawT * Math.PI) * 0.12;
        } else if (tw.pieceType === 'r') {
          // Rook: Heavy fortress slide with slight forward momentum tilt
          tw.object.position.y = parabola * tw.arcHeight;
          rig.rotation.x = Math.sin(rawT * Math.PI) * 0.06;
        } else {
          // King: Regal deliberate stride
          tw.object.position.y = parabola * tw.arcHeight;
          rig.rotation.x = Math.sin(rawT * Math.PI) * 0.09;
        }
      } else {
        // CAPTURE BATTLE SEQUENCE:
        // Phase 1 (0.00..0.42): Approach to strikePos & role-specific windup
        // Phase 2 (0.42..0.68): Role-specific weapon/magic strike & victim recoil/shatter
        // Phase 3 (0.68..1.00): Advance onto conquered square (toPos) & settle
        if (rawT < 0.42) {
          const p = rawT / 0.42;
          const easeP = 1 - Math.pow(1 - p, 2.5);
          tw.object.position.lerpVectors(tw.fromPos, tw.strikePos, easeP);
          tw.object.rotation.y = tw.attackYaw;

          // Role-specific windup posture
          if (tw.pieceType === 'p') {
            tw.object.position.y = Math.sin(p * Math.PI) * 0.16;
            rig.rotation.x = -p * 0.25;
            rig.rotation.y = -p * 0.45;
          } else if (tw.pieceType === 'n') {
            // Warhorse rears high before lancing
            tw.object.position.y = Math.sin(p * Math.PI * 0.85) * 0.95;
            rig.rotation.x = -p * 0.52;
          } else if (tw.pieceType === 'b' || tw.pieceType === 'q') {
            // Mage/Queen levitates upward to channel spell
            tw.object.position.y = easeP * 0.52;
            rig.rotation.x = -easeP * 0.28;
          } else if (tw.pieceType === 'r') {
            // Citadel tower rises before seismic slam
            tw.object.position.y = easeP * 0.58;
            rig.rotation.x = -easeP * 0.15;
          } else {
            // King raises royal greatsword overhead
            tw.object.position.y = easeP * 0.25;
            rig.rotation.x = -easeP * 0.38;
          }
        } else if (rawT < 0.68) {
          if (!tw.impactTriggered) {
            tw.impactTriggered = true;
            this.spawnRoleBattleSequence(tw.move, tw.strikePos, tw.victimPiece);
          }
          const p = (rawT - 0.42) / 0.26;
          // Lunge slightly toward target during strike
          tw.object.position.lerpVectors(tw.strikePos, tw.toPos, p * 0.45);
          tw.object.rotation.y = tw.attackYaw;

          // Role-specific strike follow-through
          if (tw.pieceType === 'p') {
            rig.rotation.x = -0.25 + p * 0.65;
            rig.rotation.y = -0.45 + p * 0.95;
          } else if (tw.pieceType === 'n') {
            tw.object.position.y = (1 - p) * 0.65;
            rig.rotation.x = -0.52 + p * 0.88;
          } else if (tw.pieceType === 'b' || tw.pieceType === 'q') {
            tw.object.position.y = 0.52 * (1 - p * 0.4);
            rig.rotation.x = -0.28 + p * 0.52;
          } else if (tw.pieceType === 'r') {
            // Fast downward slam
            const slam = Math.max(0, 1 - p * 2.2);
            tw.object.position.y = slam * 0.58;
            rig.rotation.x = 0.12 * (1 - slam);
          } else {
            tw.object.position.y = 0.25 * (1 - p);
            rig.rotation.x = -0.38 + p * 0.78;
          }
        } else {
          // Step onto conquered square & return to regal posture
          const p = (rawT - 0.68) / 0.32;
          const easeP = 1 - Math.pow(1 - p, 2);
          const midPos = new THREE.Vector3().lerpVectors(tw.strikePos, tw.toPos, 0.45);
          tw.object.position.lerpVectors(midPos, tw.toPos, easeP);
          tw.object.position.y = (1 - easeP) * 0.12;
          tw.object.rotation.y = tw.attackYaw + Math.atan2(Math.sin(tw.baseYaw - tw.attackYaw), Math.cos(tw.baseYaw - tw.attackYaw)) * easeP;
          rig.rotation.x *= 1 - easeP;
          rig.rotation.y *= 1 - easeP;
          rig.rotation.z *= 1 - easeP;
        }
      }

      if (rawT >= 1) {
        tw.object.position.copy(tw.toPos);
        this.resetPieceRigTransform(tw.object, tw.baseYaw);
        tw.onComplete?.();
        this.tweens.splice(i, 1);
      }
    }

    // 3. Update active capture battle effects & defender recoil/collapse
    for (let i = this.captureEffects.length - 1; i >= 0; i--) {
      const fx = this.captureEffects[i];
      fx.elapsed += delta;
      const t = Math.min(1, fx.elapsed / fx.duration);

      const scale = 1 + t * 4.8;
      fx.shockwave.scale.set(scale, scale, 1);
      const ringMat = fx.shockwave.material as THREE.MeshBasicMaterial;
      ringMat.opacity = (1 - t) * 0.92;

      for (const rm of fx.roleMeshes) {
        const mat = rm.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, (1 - t * 1.25) * 0.92);
        if (rm.kind === 'slash') {
          rm.mesh.rotation.z += delta * 8.5;
          rm.mesh.scale.setScalar(1 + t * 1.4);
        } else if (rm.kind === 'beam') {
          rm.mesh.scale.set(1 + Math.sin(t * Math.PI) * 0.8, 1, 1 + Math.sin(t * Math.PI) * 0.8);
          rm.mesh.rotation.y += delta * 5.0;
        } else if (rm.kind === 'lance') {
          rm.mesh.position.addScaledVector(fx.knockbackDir, delta * 2.8);
          rm.mesh.scale.setScalar(1 + t * 0.6);
        } else if (rm.kind === 'ring') {
          rm.mesh.scale.set(1 + t * 5.5, 1 + t * 5.5, 1);
        }
      }

      if (fx.victimPiece) {
        // Defender first recoils violently from the blow (0..0.35), then collapses & dissolves into shards (0.35..1.0)
        const shake = t < 0.35 ? Math.sin(t * 95) * 0.08 : 0;
        fx.victimPiece.position.x = fx.victimStartPos.x + fx.knockbackDir.x * (t * 0.42) + shake;
        fx.victimPiece.position.z = fx.victimStartPos.z + fx.knockbackDir.z * (t * 0.42);
        fx.victimPiece.position.y = t < 0.25 ? Math.sin((t / 0.25) * Math.PI) * 0.14 : -(t - 0.25) * 0.85;
        fx.victimPiece.rotation.x += delta * 3.2;
        fx.victimPiece.rotation.z += delta * 1.8;
        const s = t < 0.25 ? 1.0 : Math.max(0.01, 1 - ((t - 0.25) / 0.75) * 0.98);
        fx.victimPiece.scale.set(s, s, s);
      }

      for (const sh of fx.shards) {
        sh.mesh.position.addScaledVector(sh.velocity, delta);
        sh.velocity.y -= 8.2 * delta; // Gravity
        sh.mesh.rotation.x += sh.rotSpeed.x * delta;
        sh.mesh.rotation.y += sh.rotSpeed.y * delta;
        sh.mesh.rotation.z += sh.rotSpeed.z * delta;
        sh.mesh.scale.setScalar(Math.max(0.01, 1 - t));
      }

      if (t >= 1) {
        if (fx.victimPiece && fx.victimPiece.parent) {
          fx.victimPiece.parent.remove(fx.victimPiece);
        }
        this.fxGroup.remove(fx.group);
        this.captureEffects.splice(i, 1);
      }
    }

    // 4. Update active KING vs KING Checkmate Finisher Cutscene
    if (this.activeCheckmate) {
      const cm = this.activeCheckmate;
      cm.elapsed += delta;
      const p = Math.min(1, cm.elapsed / cm.duration);

      const winnerRig = cm.winningKingObj
        ? ((cm.winningKingObj.userData.rigGroup as THREE.Object3D) ?? cm.winningKingObj)
        : null;
      const defeatedRig =
        (cm.defeatedKingObj.userData.rigGroup as THREE.Object3D) ?? cm.defeatedKingObj;

      // Phase 1 (0.00 .. 0.34): Winning King glides to ceremonial standoff & channels Execution Sigil
      if (p < 0.34) {
        const s = p / 0.34;
        const ease = 1 - Math.pow(1 - s, 2.6);
        if (cm.winningKingObj) {
          cm.winningKingObj.position.lerpVectors(cm.winnerStartPos, cm.winnerStandoffPos, ease);
          cm.winningKingObj.position.y = Math.sin(s * Math.PI) * 0.24 + ease * 0.14;
          cm.winningKingObj.rotation.y = cm.attackYaw;
        }
        if (winnerRig) {
          winnerRig.rotation.x = -ease * 0.22;
        }

        // Position & spin crown halos above Winning King
        const wPos = cm.winningKingObj ? cm.winningKingObj.position : cm.winnerStandoffPos;
        cm.crownHalo1.position.set(wPos.x, wPos.y + 1.56, wPos.z);
        cm.crownHalo2.position.set(wPos.x, wPos.y + 1.62, wPos.z);
        cm.crownHalo1.rotation.z += delta * 3.8;
        cm.crownHalo2.rotation.z -= delta * 3.1;
        (cm.crownHalo1.material as THREE.MeshBasicMaterial).opacity = ease * 0.92;
        (cm.crownHalo2.material as THREE.MeshBasicMaterial).opacity = ease * 0.78;

        // Materialize & spin vertical execution sigil wheel
        cm.executionSigil.rotation.z += delta * 4.5;
        cm.executionSigil.scale.setScalar(0.25 + ease * 0.85);
        (cm.executionSigil.material as THREE.MeshBasicMaterial).opacity = ease * 0.95;
      }
      // Phase 2 (0.34 .. 0.80): Finisher Strike Unleashed & Losing King Impact / Topple
      else {
        const s = Math.min(1, (p - 0.34) / 0.46);
        const easeS = 1 - Math.pow(1 - s, 2.4);

        if (!cm.impactSpawned) {
          cm.impactSpawned = true;
          for (const sh of cm.shards) {
            sh.mesh.visible = true;
            sh.mesh.position.set(
              cm.defeatedStartPos.x + (Math.random() - 0.5) * 0.3,
              0.35 + Math.random() * 0.85,
              cm.defeatedStartPos.z + (Math.random() - 0.5) * 0.3
            );
          }
        }

        if (cm.winningKingObj) {
          cm.winningKingObj.position.copy(cm.winnerStandoffPos);
          cm.winningKingObj.position.y = Math.max(0, 0.14 * (1 - s));
          cm.winningKingObj.rotation.y = cm.attackYaw;
        }
        if (winnerRig) {
          // Royal forward strike posture then regal upright stance
          winnerRig.rotation.x = s < 0.35 ? 0.26 * (1 - s / 0.35) : 0;
        }

        const wPos = cm.winningKingObj ? cm.winningKingObj.position : cm.winnerStandoffPos;
        cm.crownHalo1.position.set(wPos.x, wPos.y + 1.56, wPos.z);
        cm.crownHalo2.position.set(wPos.x, wPos.y + 1.62, wPos.z);
        cm.crownHalo1.rotation.z += delta * 4.2;
        cm.crownHalo2.rotation.z -= delta * 3.4;

        cm.executionSigil.rotation.z += delta * 6.5;
        (cm.executionSigil.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - s * 0.85) * 0.95);

        // Finisher beam / shock pillar pulse
        const beamPulse = Math.sin(Math.min(1, s * 1.4) * Math.PI);
        (cm.finisherBeam.material as THREE.MeshBasicMaterial).opacity = beamPulse * 0.92;
        cm.finisherBeam.scale.set(1 + beamPulse * 0.65, 1, 1 + beamPulse * 0.65);

        // Dual expanding ground shockwaves
        const swScale1 = 1 + s * 6.2;
        const swScale2 = 1 + Math.max(0, s - 0.12) * 7.4;
        cm.shockwave1.scale.set(swScale1, swScale1, 1);
        cm.shockwave2.scale.set(swScale2, swScale2, 1);
        (cm.shockwave1.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - s) * 0.92);
        (cm.shockwave2.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - s) * 0.78);

        // Losing King violent shudder (0..0.32) + dramatic 58-degree defeat topple (matching Reference Image 2)
        const shudder = s < 0.32 ? Math.sin(s * 125) * 0.065 : 0;
        cm.defeatedKingObj.position.x =
          cm.defeatedStartPos.x + cm.attackDir.x * (easeS * 0.24) + shudder;
        cm.defeatedKingObj.position.z =
          cm.defeatedStartPos.z + cm.attackDir.z * (easeS * 0.24);
        cm.defeatedKingObj.position.y = easeS * 0.08;

        defeatedRig.rotation.z = easeS * 0.88;
        defeatedRig.rotation.x = easeS * 0.42;

        // Update flying fracture debris shards
        for (const sh of cm.shards) {
          sh.mesh.position.addScaledVector(sh.velocity, delta);
          sh.velocity.y -= 8.4 * delta;
          if (sh.mesh.position.y < 0.04) {
            sh.mesh.position.y = 0.04;
            sh.velocity.x *= 0.6;
            sh.velocity.z *= 0.6;
          }
          sh.mesh.rotation.x += sh.rotSpeed.x * delta;
          sh.mesh.rotation.y += sh.rotSpeed.y * delta;
          sh.mesh.rotation.z += sh.rotSpeed.z * delta;
        }
      }

      if (p >= 1) {
        this.fxGroup.remove(cm.fxRoot);
        const cb = cm.onComplete;
        this.activeCheckmate = null;
        cb?.();
      }
    }
  }
}
