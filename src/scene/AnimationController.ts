import * as THREE from 'three';
import type { MoveRecord, PieceSymbol } from '../engine/types';
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
   * Triggers a dramatic checkmate defeat collapse on the losing King and golden victory burst.
   */
  public triggerCheckmateSequence(defeatedKingObj: THREE.Object3D | null): void {
    if (!defeatedKingObj || this.reducedMotion) return;

    const rig = (defeatedKingObj.userData.rigGroup as THREE.Object3D) ?? defeatedKingObj;
    const startRotZ = rig.rotation.z;
    const targetRotZ = 0.62;
    const pos = defeatedKingObj.position.clone();

    const moveStub: MoveRecord = {
      ply: 0,
      moveNumber: 0,
      color: 'w',
      piece: 'k',
      from: defeatedKingObj.userData.square ?? 'e1',
      to: defeatedKingObj.userData.square ?? 'e1',
      captured: 'k',
      capturedSquare: defeatedKingObj.userData.square ?? 'e1',
      san: '#',
      lan: '',
      flags: 'c',
      isCheck: true,
      isCheckmate: true,
      isDraw: false,
      fenBefore: '',
      fenAfter: '',
      timestamp: Date.now()
    };
    this.spawnRoleBattleSequence(moveStub, pos);

    let t = 0;
    const stepCollapse = () => {
      t += 0.035;
      const ease = Math.min(1, t);
      rig.rotation.z = startRotZ + (targetRotZ - startRotZ) * ease;
      rig.rotation.x = 0.25 * ease;
      defeatedKingObj.position.copy(pos);
      if (ease < 1) {
        requestAnimationFrame(stepCollapse);
      }
    };
    requestAnimationFrame(stepCollapse);
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
  }
}
