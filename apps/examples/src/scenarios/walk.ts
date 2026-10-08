import { MathUtils, Vector3 } from 'three';
import type { Scenario } from '../scenario';
import { forwardOf, leftOf, vec } from '../math';

// Something moves over the ground — a tray, the hips, a "go there" point — and the body walks after it.

const { smoothstep } = MathUtils;

/** A path: straight along +z, then a left-hand arc. Returns point + tangent yaw. */
function path(s: number, straight = 2.5, radius = 2.2) {
  if (s < straight) return { p: vec(0, 0, s), yaw: 0 };
  const a = (s - straight) / radius;
  return { p: vec(radius - radius * Math.cos(a), 0, straight + radius * Math.sin(a)), yaw: a };
}

export const walkTray: Scenario = {
  id: 'walk-tray',
  title: 'Carrying a tray',
  drives: 'left + right hand',
  description:
    'Only the two wrist targets are given: a tray glides forward and curves left. The body walks after it. Stepping, pelvis bob/sway, torso, head and gaze are all inferred.',
  duration: 14,
  actors: [{}],
  body: {},
  create() {
    let s = 0;
    const tray = vec(0, 0, 0);
    const wrists = new Vector3();
    let yaw = 0;
    const half = new Vector3();
    return {
      inputs(t, dt, [{ proportions: p }]) {
        const speed = 1.1 * smoothstep(t, 1, 3.5) * (1 - smoothstep(t, 10.5, 12.5));
        s += speed * dt;
        // carried as people do: upper arms by the sides, elbows bent ~90°, the wrists just
        // below elbow height ahead of the body (which starts where the path does); the tray
        // rests on the hands, its middle a little further out
        const q = path(s + 0.3 * p.scale);
        yaw = q.yaw;
        wrists.set(q.p.x, 0.63 * p.height, q.p.z);
        tray.copy(forwardOf(yaw)).multiplyScalar(0.08 * p.scale).add(wrists).setY(wrists.y + 0.03 * p.scale);
        leftOf(yaw, half).multiplyScalar(0.19 * p.scale);
        // the hands take hold of the tray over the first second
        const w = smoothstep(t, 0.1, 1.0);
        return [{ leftHand: { position: wrists.clone().add(half), weight: w }, rightHand: { position: wrists.clone().sub(half), weight: w } }];
      },
      props: () => [{ kind: 'tray', position: tray, size: vec(0.5, 0.02, 0.34), yaw }],
    };
  },
};

export const stroll: Scenario = {
  id: 'stroll',
  title: 'Stroll (hips only)',
  drives: 'hips',
  description:
    'Only the hips position is given, moving along a path at 1.3 m/s. Legs step, arms swing in counter-phase, the thorax counter-rotates and the head stabilises gaze ahead.',
  duration: 13,
  actors: [{}],
  // a Drawcall Market character (npx @drawcall/market install generic-stylized-human-neutral)
  body: { url: '/humanoid-model/generic-stylized-human-neutral.glb' },
  create() {
    let s = 0;
    const pelvis = vec(0, 0, 0);
    return {
      inputs(t, dt, [{ proportions: p }]) {
        const speed = 1.3 * smoothstep(t, 0.8, 2.5) * (1 - smoothstep(t, 9.5, 11.5));
        s += speed * dt;
        const q = path(s, 6, 3);
        // (at the body's own standing height: its legs relaxed)
        pelvis.set(q.p.x, p.hipHeight, q.p.z);
        return [{ hips: { position: pelvis } }];
      },
      props: () => [],
    };
  },
};

export const walkRun: Scenario = {
  id: 'run',
  title: 'Walk → run → walk',
  drives: 'a walk-to point (goal)',
  description:
    'Only a "go there" point moves along a path, speeding up from a walk into a run (~3.3 m/s) and back. The gait switches on its own: shorter ground contacts and a flight phase, higher knee recovery, bent pumping arms, forward lean, and the body compressing through each stance.',
  duration: 15,
  cameraDistance: 5.2,
  actors: [{ maxSpeed: 3.6, accel: 2.4 }],
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    return {
      inputs(t, dt) {
        const walk = 1.2 * smoothstep(t, 0.6, 2);
        const running = 2.1 * smoothstep(t, 3, 5) * (1 - smoothstep(t, 9.5, 11.5));
        const stop = 1 - smoothstep(t, 12.5, 14);
        s += (walk + running) * stop * dt;
        const q = path(s + 0.25, 6, 9);
        spot.set(q.p.x, 0, q.p.z);
        return [{ goal: { position: spot } }];
      },
      props: () => [],
    };
  },
};

/** low obstacles along a straight path: a shoebox, a hurdle, a plank pile */
const HURDLES = [
  { z: 2.2, depth: 0.25, height: 0.12 },
  { z: 3.8, depth: 0.08, height: 0.28 },
  { z: 5.4, depth: 0.3, height: 0.18 },
];

export const stepOver: Scenario = {
  id: 'step-over',
  title: 'Stepping over things',
  drives: 'a walk-to point + obstacle boxes',
  description:
    'A walk-to point moves straight across a shoebox, a 28 cm hurdle and a low pile. Nobody plans the feet: the swing arc samples the heights along the foot’s path and rises over them, and no foot ever lands on an obstacle — steps stretch past or stop short.',
  duration: 12,
  actors: [{}],
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    const obstacles = HURDLES.map((h) => ({ min: vec(-0.5, 0, h.z - h.depth / 2), max: vec(0.5, h.height, h.z + h.depth / 2) }));
    return {
      inputs(t, dt) {
        // (easing into its stop, like someone arriving somewhere)
        s += 1.1 * smoothstep(t, 0.5, 1.8) * MathUtils.clamp((7 - s) / 1.2, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, floorObstacles: obstacles }];
      },
      props: () => HURDLES.map((h) => ({ kind: 'box', position: vec(0, h.height / 2, h.z), size: vec(1, h.height, h.depth) })),
    };
  },
};
