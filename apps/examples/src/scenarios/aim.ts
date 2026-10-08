import { Quaternion, Vector3 } from 'three';
import type { Humanoid } from '@prohuman/core';
import type { Prop, Scenario } from '../scenario';
import { pulse, scalar } from '../keys';
import { forwardOf, leftOf, quatBasis, quatYXZ, vec, yawOf } from '../math';

/** what is shot at: the middle of a board on a post */
const TARGET = vec(0, 1.45, 5);
/** rifle points in its own frame (x left, y up, z along the bore; m, default body), from the butt */
const RIFLE = { grip: vec(0, -0.085, 0.19), handguard: vec(0.015, -0.07, 0.43), muzzle: 0.86 };
/** the butt in the shoulder pocket, in the body's aim frame (left, up over the shoulder joint, forward; m, default body) */
const POCKET = vec(-0.13, 0.045, 0.05);
/** how far the rifle points down at low ready (rad) */
const LOW_READY = 0.65;
/** a shot's kick: the muzzle up (rad) and the butt back (m), over rise, hold and fall (s) */
const KICK = { pitch: 0.07, back: 0.018, timing: [0.03, 0.0, 0.16] as const };
const SHOTS = [1.9, 2.25, 3.9, 4.3, 4.6, 8.9, 9.3, 10.3, 10.7, 11.1];

// the goal moves around the target: speed across (+ = the body's left) and toward it (m/s)
const across = scalar([
  [0.9, 0],
  [1.7, -0.75],
  [2.6, -0.75],
  [3.6, 0.75],
  [4.6, 0.75],
  [5.3, 0],
  [7.8, 0],
  [8.6, 0.7],
  [11.4, 0.7],
  [12.1, 0],
]);
const toward = scalar([
  [5.4, 0],
  [5.9, -0.7],
  [7.0, -0.7],
  [7.5, 0],
]);
/** 0 at low ready, 1 aiming */
const aiming = scalar([
  [0.3, 0],
  [0.9, 1],
  [12.4, 1],
  [13.1, 0],
]);

/**
 * A rifle held with both hands (the grip and the handguard, both rotations the rifle's)
 * aimed at a target, the stock in the right shoulder; a walk-to spot strafes left and
 * right, backs up and circles the target, facing it throughout.
 */
export const aimStrafe: Scenario = {
  id: 'aim-strafe',
  title: 'Aiming a rifle while strafing',
  drives: 'both hands on a rifle (+ rotations), a look-at target, a walk-to spot facing the target',
  description:
    'The rifle comes up from low ready and stays on the target while a walk-to spot strafes right and left, backs away and circles the target, facing it throughout; each shot kicks the rifle a little. Side-steps and backward steps without crossing the feet, the steady upper body and the head behind the sights are inferred.',
  duration: 14,
  actors: [{ stance: { crouch: 0.05, stagger: 0.1, blade: -0.25, toeOut: 0.15, width: 0.13, guard: false } }],
  create() {
    let angle = 0;
    let radius = TARGET.z;
    const goal = new Vector3();
    const rifle = new Rifle();
    return {
      inputs(t, dt, [h]) {
        // polar around the target: across turns the goal about it, toward changes the range
        angle += (across(t) / radius) * dt;
        radius -= toward(t) * dt;
        goal.set(TARGET.x - Math.sin(angle) * radius, 0, TARGET.z - Math.cos(angle) * radius);
        rifle.pose(h, t);
        return [
          {
            goal: { position: goal, quaternion: quatYXZ(angle) },
            lookAt: TARGET,
            rightHand: { position: rifle.grip, quaternion: rifle.gripRot },
            leftHand: { position: rifle.handguard, quaternion: rifle.handguardRot },
          },
        ];
      },
      props: () => [...rifle.props(), { kind: 'box', position: TARGET, size: vec(0.45, 0.6, 0.04) }, { kind: 'box', position: vec(TARGET.x, 0.575, TARGET.z), size: vec(0.05, 1.15, 0.05) }],
    };
  },
};

class Rifle {
  readonly butt = new Vector3();
  readonly grip = new Vector3();
  readonly handguard = new Vector3();
  readonly muzzle = new Vector3();
  readonly gripRot = new Quaternion();
  readonly handguardRot = new Quaternion();
  private f = new Vector3();
  private l = new Vector3();
  private u = new Vector3();

  /** placed in the body's aim frame: the butt in the shoulder pocket, the bore on the target */
  pose(h: Humanoid, t: number) {
    const p = h.proportions;
    const s = p.scale;
    const r = h.model.scene.position;
    const yaw = yawOf(TARGET.x - r.x, TARGET.z - r.z);
    const shoulder = 0.806 * p.height - 0.05 * s;
    const fwd = forwardOf(yaw);
    const left = leftOf(yaw);
    const up = vec(0, 1, 0);
    let kick = 0;
    for (const at of SHOTS) kick = Math.max(kick, pulse(t, at, ...KICK.timing));
    const a = aiming(t);
    this.butt
      .copy(r)
      .addScaledVector(left, POCKET.x * s)
      .addScaledVector(fwd, POCKET.z * s - KICK.back * kick)
      .setY(shoulder + POCKET.y * s - 0.04 * s * (1 - a));
    // the bore on the target, dipped at low ready, kicked up by a shot
    const f = this.f.subVectors(TARGET, this.butt).normalize();
    const l = this.l.crossVectors(up, f).normalize();
    f.applyAxisAngle(l, LOW_READY * (1 - a) - KICK.pitch * kick);
    const u = this.u.crossVectors(f, l);
    const at = (v: Vector3, out: Vector3) => out.copy(this.butt).addScaledVector(l, v.x * s).addScaledVector(u, v.y * s).addScaledVector(f, v.z * s);
    at(RIFLE.grip, this.grip);
    at(RIFLE.handguard, this.handguard);
    this.muzzle.copy(this.butt).addScaledVector(f, RIFLE.muzzle * s);
    // the right hand around the pistol grip: fingers forward and down, palm to the left, thumb up
    const g = vec(0, 0, 0).addScaledVector(f, Math.cos(0.45)).addScaledVector(u, -Math.sin(0.45));
    const gx = g.clone().negate();
    const gy = l.clone().negate();
    quatBasis(gx, gy, vec(0, 0, 0).crossVectors(gx, gy), this.gripRot);
    // the left hand under the handguard: fingers forward, palm up and in toward it
    const palm = u.clone().multiplyScalar(0.8).addScaledVector(l, -0.6).normalize();
    const hx = f.clone();
    const hy = palm.clone().negate();
    quatBasis(hx, hy, vec(0, 0, 0).crossVectors(hx, hy), this.handguardRot);
  }

  props(): Prop[] {
    // (held as a rifle is: by the pistol grip in the right hand, the left hand on it too)
    return [
      { kind: 'rod', position: this.butt.clone(), to: this.muzzle.clone(), radius: 0.018, held: { hand: 'right' } },
      { kind: 'rod', position: this.grip.clone().addScaledVector(this.u, 0.01), to: this.grip.clone().addScaledVector(this.u, 0.08).addScaledVector(this.f, 0.03), radius: 0.014, held: { hand: 'right' } },
    ];
  }
}
