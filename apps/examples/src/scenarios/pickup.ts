import { Vector3 } from 'three';
import type { Humanoid } from '@prohuman/core';
import type { Scenario, ScenarioInput } from '../scenario';
import { jointOf } from '../joints';
import { spline } from '../keys';
import { forwardOf, leftOf, minimumJerk, quatYXZ, Spring, vec, wrapAngle } from '../math';

const BOX = vec(0.34, 0.26, 0.26);
/** how quickly the carried box follows the body (1/s): the arms damp its sway and turns */
const CARRY_OMEGA = 6;
const SHELF = { x: -1.3, z: 4.4, boards: [0.4, 0.95, 1.4, 1.8], width: 1.0, depth: 0.34 };
const TOP = SHELF.boards[3];
const SHELF_FOOTPRINT = [{ min: vec(SHELF.x - SHELF.width / 2, 0, SHELF.z - SHELF.depth / 2), max: vec(SHELF.x + SHELF.width / 2, TOP, SHELF.z + SHELF.depth / 2) }];
/** squarely in front of the shelf */
const FACING_SHELF = quatYXZ(0);
const LIFT_TIME = 1.8;
const PLACE_TIME = 1.8;
const RELEASE_TIME = 0.8;

interface Crate {
  position: Vector3;
  yaw: number;
}

/**
 * The script's steps. Each reacts to the body: the lift starts once both hands have held
 * the grips for a moment, the carry once the body is up with the box, the placing once it
 * stands at the shelf.
 */
type Phase =
  | { name: 'idle' }
  /** the grips are the hand targets: the body walks over and squats; `held` = how long both hands have been there */
  | { name: 'approach'; held: number }
  | { name: 'lift'; start: number; path: (t: number, out?: Vector3) => Vector3 }
  /** walking to `stand` along `walk` while the box rides on a spring in front of the chest */
  | { name: 'carry'; start: number; duration: number; fromY: number; fromYaw: number; from: Vector3; stand: Vector3; walk: Vector3; spring: Spring }
  | { name: 'place'; start: number; stand: Vector3; from: Vector3; via: Vector3; to: Vector3 }
  | { name: 'release'; start: number }
  | { name: 'done' };

/**
 * Only wrist targets are scripted, reacting to the body: the targets jump to a box on the
 * floor (the body walks over and squats), then the box is lifted, carried to a shelf and
 * pushed onto the top board.
 */
export const pickupShelf: Scenario = {
  id: 'pickup-shelf',
  title: 'Pick up a box, shelve it overhead',
  drives: 'left + right hand (+ a walk-to spot while carrying)',
  description:
    'Hand targets snap to a box on the floor 2.6 m away: the body walks there (arms free), squats and grasps, lifts, carries the box close to the body to a shelf (a walk-to spot is given while carrying) and places it on the top board above head height, on tiptoe.',
  duration: 17,
  actors: [{}],
  focus: (a) => jointOf(a[0], 'hips').setY(0.9),
  create() {
    const box: Crate = { position: vec(0.35, BOX.y / 2, 2.6), yaw: 0.35 };
    let phase: Phase = { name: 'idle' };
    return {
      inputs(t, dt, [h]) {
        phase = advance(phase, box, t, dt, h);
        return [inputFor(phase, box, t, h)];
      },
      props: () => [
        { kind: 'box', position: box.position, size: BOX, yaw: box.yaw },
        { kind: 'shelf', position: vec(SHELF.x, 0, SHELF.z), size: vec(SHELF.width, TOP, SHELF.depth), boards: SHELF.boards },
      ],
    };
  },
};

/** the hand targets on a box: the middle of its left and right faces, a little above its centre */
function grips({ position: p, yaw }: Crate): [Vector3, Vector3] {
  const l = leftOf(yaw).multiplyScalar(BOX.x / 2 + 0.015);
  return [vec(p.x + l.x, p.y + 0.02, p.z + l.z), vec(p.x - l.x, p.y + 0.02, p.z - l.z)];
}

/** moves the box for this step and returns the phase it ends in */
function advance(phase: Phase, box: Crate, t: number, dt: number, h: Humanoid): Phase {
  const r = h.model.scene.position;
  const yaw = h.yaw;
  switch (phase.name) {
    case 'idle':
      return t > 0.8 ? { name: 'approach', held: 0 } : phase;
    case 'approach': {
      const [left, right] = grips(box);
      const holding = jointOf(h, 'leftHand').distanceTo(left) < 0.035 && jointOf(h, 'rightHand').distanceTo(right) < 0.035;
      phase.held = holding ? phase.held + dt : 0;
      if (phase.held <= 0.25) return phase;
      // one smooth arc: up in front of the knees, then in close in front of the chest
      const from = box.position;
      const f = forwardOf(yaw);
      const via = from.clone().addScaledVector(f, 0.12).setY(0.6);
      const to = vec(r.x + f.x * 0.36, 1.05, r.z + f.z * 0.36);
      const path = spline([
        [0, [from.x, from.y, from.z]],
        [0.5, [via.x, via.y, via.z]],
        [1, [to.x, to.y, to.z]],
      ]);
      return { name: 'lift', start: t, path };
    }
    case 'lift': {
      // the body gives way to the box (body obstacles): the box never jumps out of the hands
      const e = (t - phase.start) / LIFT_TIME;
      phase.path(minimumJerk(Math.min(1, e)), box.position);
      // already turning to go while the box comes up (once the body is up with it)
      if (e < 0.8 || jointOf(h, 'hips').y <= 0.8 || box.position.y <= 0.9) return phase;
      const from = vec(r.x, 0, r.z);
      // stand where the box can go up onto the shelf
      const stand = vec(SHELF.x, 0, SHELF.z - 0.56);
      const spring = new Spring();
      spring.reset(box.position);
      const duration = from.distanceTo(stand) / 0.9 + 0.8;
      return { name: 'carry', start: t, duration, fromY: box.position.y, fromYaw: box.yaw, from, stand, walk: new Vector3(), spring };
    }
    case 'carry': {
      // the walk itself is a "go there" point moving toward the shelf
      const e = (t - phase.start) / phase.duration;
      phase.walk.lerpVectors(phase.from, phase.stand, minimumJerk(Math.min(1, e)));
      // held in front of the chest — relative to where the body stands, not to the chest
      // itself (the chest gives way to the box; chasing it would push the body back); the
      // arms damp the body's sway and turns
      const f = forwardOf(yaw);
      const rise = minimumJerk(Math.min(1, e * 3));
      const spot = vec(r.x + f.x * 0.36, phase.fromY + (1.1 - phase.fromY) * rise, r.z + f.z * 0.36);
      // (led by the body's velocity: a spring trails a steady walk by 2v/ω — at a walk,
      // right into the chest, which then leans back out of its way)
      spot.addScaledVector(h.velocity, 2 / CARRY_OMEGA);
      box.position.copy(phase.spring.step(spot, CARRY_OMEGA, dt));
      box.yaw = phase.fromYaw + wrapAngle(yaw - phase.fromYaw) * minimumJerk(Math.min(1, e * 2));
      if (e < 1 || Math.hypot(r.x - phase.stand.x, r.z - phase.stand.z) >= 0.1) return phase;
      const via = vec(SHELF.x, TOP + BOX.y / 2 + 0.08, SHELF.z - 0.3);
      const to = vec(SHELF.x, TOP + BOX.y / 2 + 0.005, SHELF.z - SHELF.depth / 2 + BOX.z / 2 + 0.01);
      return { name: 'place', start: t, stand: phase.stand, from: box.position.clone(), via, to };
    }
    case 'place': {
      // up above the top board, then pushed onto it
      const e = (t - phase.start) / PLACE_TIME;
      if (e < 0.6) box.position.lerpVectors(phase.from, phase.via, minimumJerk(e / 0.6));
      else box.position.lerpVectors(phase.via, phase.to, minimumJerk((e - 0.6) / 0.4));
      return e >= 1 ? { name: 'release', start: t } : phase;
    }
    case 'release':
      return (t - phase.start) / RELEASE_TIME >= 1 ? { name: 'done' } : phase;
    case 'done':
      return phase;
  }
}

function inputFor(phase: Phase, box: Crate, t: number, h: Humanoid): ScenarioInput {
  const floorObstacles = SHELF_FOOTPRINT;
  if (phase.name === 'idle' || phase.name === 'done') return { floorObstacles };
  const [left, right] = grips(box);
  if (phase.name === 'release') {
    // the hands open away from the box and come down, the targets' weight fades
    const k = minimumJerk((t - phase.start) / RELEASE_TIME);
    const open = leftOf(box.yaw).multiplyScalar(0.08).multiplyScalar(k);
    left.x += open.x;
    left.z += open.z - 0.1 * k;
    right.x -= open.x;
    right.z -= open.z + 0.1 * k;
    left.y -= 0.1 * k;
    right.y -= 0.1 * k;
    return { leftHand: { position: left, weight: 1 - k }, rightHand: { position: right, weight: 1 - k }, floorObstacles };
  }
  const r = h.model.scene.position;
  let goal: ScenarioInput['goal'];
  // gaze: the box while getting it, the path/shelf while carrying, the shelf top while placing
  let lookAt = box.position.clone();
  if (phase.name === 'carry') {
    // turn toward the shelf during the approach, not after arriving
    const near = Math.hypot(r.x - phase.stand.x, r.z - phase.stand.z) < 0.3;
    goal = { position: phase.walk, quaternion: near ? FACING_SHELF : undefined };
    lookAt = vec(SHELF.x, TOP, SHELF.z);
  }
  if (phase.name === 'place') {
    goal = { position: phase.stand, quaternion: FACING_SHELF };
    lookAt = vec(SHELF.x, TOP + 0.1, SHELF.z);
  }
  // the held box is a volume the body keeps clear of (two spheres, its left and right half, cover its corners)
  const half = leftOf(box.yaw).multiplyScalar(BOX.x / 4);
  const bodyObstacles =
    phase.name === 'approach'
      ? []
      : [
          { center: box.position.clone().add(half), radius: 0.15 },
          { center: box.position.clone().sub(half), radius: 0.15 },
        ];
  return { leftHand: { position: left }, rightHand: { position: right }, floorObstacles, goal, lookAt, bodyObstacles };
}
