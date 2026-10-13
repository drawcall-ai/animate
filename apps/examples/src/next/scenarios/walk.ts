import { MathUtils, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Ctx } from '@prohuman/body';
import { carry, createWorld, follow, humanoid, walk, type Effector, type World } from '@prohuman/humanoid';
import { forwardOf, leftOf, vec } from '../../math';
import { FIXED_DT } from '../../scenario';
import type { Scenario } from '../scenario';

// Something moves over the ground — the hips, a "go there" point, a tray — and the body walks after it.

const { smoothstep } = MathUtils;

/** the scenario's direction: `update` every frame, for good */
const direct = (update: (ctx: Ctx<World>) => void) => action<Ctx<World>>({ update });

/** how far something moving at `speed(t)` has gone by time `t` (s), stepped as the simulation steps */
function travelled(t: number, speed: (t: number) => number): number {
  let s = 0;
  for (let k = 0; k * FIXED_DT < t - 1e-9; k++) s += speed(k * FIXED_DT) * FIXED_DT;
  return s;
}

/** A path: straight along +z, then a left-hand arc. Returns point + tangent yaw. */
function path(s: number, straight = 2.5, radius = 2.2) {
  if (s < straight) return { p: vec(0, 0, s), yaw: 0 };
  const a = (s - straight) / radius;
  return { p: vec(radius - radius * Math.cos(a), 0, straight + radius * Math.sin(a)), yaw: a };
}

export const stroll: Scenario = {
  id: 'stroll',
  title: 'Stroll (hips only)',
  description:
    'Only the hips position is given, moving along a path at 1.3 m/s; the body follows it. Legs step, arms swing in counter-phase, the thorax counter-rotates and the head stabilises gaze ahead.',
  duration: 14,
  actors: [{}],
  world: () => createWorld(),
  props: () => [],
  script: (h) =>
    function* () {
      const hips: Effector = { position: new Vector3(), weight: 1 };
      let s = 0;
      yield* parallel<Ctx<World>>(
        'all',
        humanoid(h),
        // the hips' target glides along the path at a stroll, at the body's own standing height
        direct(({ time: t, dt }) => {
          s += 1.3 * smoothstep(t, 0.8, 2.5) * (1 - smoothstep(t, 9.5, 11.5)) * dt;
          hips.position.copy(path(s, 6, 3).p).setY(h.proportions.hipHeight);
        }),
        follow(h, 'hips', { target: () => hips }),
      );
    },
};

export const walkRun: Scenario = {
  id: 'run',
  title: 'Walk → run → walk',
  description:
    'Only a "go there" point moves along a path, speeding up from a walk into a run (~3.3 m/s) and back. The gait switches on its own: shorter ground contacts and a flight phase, higher knee recovery, bent pumping arms, forward lean.',
  duration: 16,
  actors: [{}],
  world: () => createWorld(),
  props: () => [],
  script: (h) =>
    function* () {
      const spot = new Vector3();
      let s = 0;
      yield* parallel<Ctx<World>>(
        'all',
        humanoid(h),
        // the point to go to, speeding up from a walk into a run and back
        direct(({ time: t, dt }) => {
          const walking = 1.2 * smoothstep(t, 0.6, 2);
          const running = 2.1 * smoothstep(t, 3, 5) * (1 - smoothstep(t, 9.5, 11.5));
          s += (walking + running) * (1 - smoothstep(t, 12.5, 14)) * dt;
          spot.copy(path(s + 0.25, 6, 9).p);
        }),
        walk(h, { to: () => spot, speed: 3.6, accel: 2.4 }),
      );
    },
};

/** the tray's speed (m/s): it glides off, carries on, and stops */
const traySpeed = (t: number) => 1.1 * smoothstep(t, 1, 3.5) * (1 - smoothstep(t, 10.5, 12.5));

/** where the tray is carried at `t` (s) by a body `scale` × the default: the wrists, its middle and heading */
function tray(t: number, height: number, scale: number) {
  // carried as people do: upper arms by the sides, elbows bent ~90°, the wrists just below elbow
  // height ahead of the body; the tray rests on the hands, its middle a little further out
  const q = path(travelled(t, traySpeed) + 0.3 * scale);
  const wrists = new Vector3(q.p.x, 0.63 * height, q.p.z);
  const middle = forwardOf(q.yaw).multiplyScalar(0.08 * scale).add(wrists);
  middle.y += 0.03 * scale;
  return { wrists, middle, yaw: q.yaw, half: leftOf(q.yaw).multiplyScalar(0.19 * scale) };
}

export const walkTray: Scenario = {
  id: 'walk-tray',
  title: 'Carrying a tray',
  description:
    'Only the two wrist targets are given: a tray glides forward and curves left. The body follows it, both hands on it; stepping, pelvis bob and sway, torso, head and gaze are its own.',
  duration: 15,
  actors: [{}],
  world: () => createWorld(),
  // (the default body: the scenery is drawn for it)
  props: (t) => {
    const { middle, yaw } = tray(t, 1.75, 1);
    return [{ kind: 'tray', position: middle, size: vec(0.5, 0.02, 0.34), yaw }];
  },
  script: (h) =>
    function* () {
      const p = h.proportions;
      const hands = { left: { position: new Vector3(), weight: 0 }, right: { position: new Vector3(), weight: 0 } };
      const mid: Effector = { position: new Vector3(), weight: 1 };
      yield* parallel<Ctx<World>>(
        'all',
        humanoid(h),
        // the tray glides along the path; the hands take hold of it over the first second
        direct(({ time: t }) => {
          const { wrists, half } = tray(t, p.height, p.scale);
          const w = smoothstep(t, 0.1, 1.0);
          hands.left.position.copy(wrists).add(half);
          hands.right.position.copy(wrists).sub(half);
          hands.left.weight = hands.right.weight = w;
          mid.position.copy(wrists);
        }),
        follow(h, 'hands', { target: () => mid }),
        carry(h, { left: () => hands.left, right: () => hands.right }),
      );
    },
};
