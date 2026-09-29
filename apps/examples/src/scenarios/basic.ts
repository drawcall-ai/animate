import { Vector3 } from 'three';
import { Humanoid, leftOf, quatYXZ, smoothstep } from '@prohuman/core';
import type { Scenario } from '../scenario';
import { scalar, track, v } from '../keys';

/** Headset calibration: scale scripted heights (authored for a 1.60 m head) to this body. */
function headScale(): number {
  const h = new Humanoid();
  return h.pose.headCenter.y / 1.6;
}

/** A path: straight along +z, then a left-hand arc. Returns point + tangent yaw. */
function path(s: number, straight = 2.5, radius = 2.2) {
  if (s < straight) return { p: v(0, 0, s), yaw: 0 };
  const a = (s - straight) / radius;
  return { p: v(radius - radius * Math.cos(a), 0, straight + radius * Math.sin(a)), yaw: a };
}

export const walkTray: Scenario = {
  id: 'walk-tray',
  title: 'Carrying a tray',
  drives: 'left + right hand',
  description:
    'Only the two wrist targets are given: a tray glides forward and curves left. The body walks after it. Stepping, pelvis bob/sway, torso, head and gaze are all inferred.',
  duration: 14,
  actors: [{}],
  create() {
    let s = 0;
    const tray = v(0, 1.0, 0.42);
    let yaw = 0;
    const L = new Vector3();
    return {
      inputs(t, dt) {
        const speed = 1.1 * smoothstep(1, 2.5, t) * (1 - smoothstep(10.5, 12.5, t));
        s += speed * dt;
        const q = path(s + 0.42);
        tray.set(q.p.x, 1.0, q.p.z);
        yaw = q.yaw;
        leftOf(yaw, L).multiplyScalar(0.19);
        // the hands take hold of the tray over the first second
        const w = smoothstep(0.1, 1.0, t);
        return [{ leftHand: { position: tray.clone().add(L), weight: w }, rightHand: { position: tray.clone().sub(L), weight: w } }];
      },
      props: () => [{ kind: 'tray', position: tray, size: v(0.5, 0.02, 0.34), yaw }],
    };
  },
};

export const stroll: Scenario = {
  id: 'stroll',
  title: 'Stroll (pelvis only)',
  drives: 'pelvis',
  description:
    'Only the pelvis position is given, moving along a path at 1.3 m/s. Legs step, arms swing in counter-phase, the thorax counter-rotates and the head stabilises gaze ahead.',
  duration: 13,
  actors: [{}],
  create() {
    let s = 0;
    const pelvis = v(0, 0.92, 0);
    return {
      inputs(t, dt) {
        const speed = 1.3 * smoothstep(0.8, 2.5, t) * (1 - smoothstep(9.5, 11.5, t));
        s += speed * dt;
        const q = path(s, 4, 3);
        pelvis.set(q.p.x, 0.92, q.p.z);
        return [{ pelvis: { position: pelvis } }];
      },
      props: () => [],
    };
  },
};

export const reach: Scenario = {
  id: 'reach',
  title: 'Reaching around (one hand)',
  drives: 'right hand',
  description:
    'A single wrist target visits points high, across the body, on the floor, behind and far away. The body shrugs, bends, squats, turns and steps as needed.',
  duration: 13,
  actors: [{}],
  create() {
    const pos = track([
      [0.4, [-0.25, 0.9, 0.2]],
      [1.6, [-0.25, 1.95, 0.4]],
      [2.4, [-0.25, 1.95, 0.4]],
      [3.6, [0.3, 1.0, 0.4]],
      [4.3, [0.3, 1.0, 0.4]],
      [5.8, [-0.35, 0.06, 0.55]],
      [6.6, [-0.35, 0.06, 0.55]],
      [8.0, [-0.55, 1.2, -0.6]],
      [8.8, [-0.55, 1.2, -0.6]],
      [10.4, [0.0, 1.25, 1.8]],
      [11.2, [0.0, 1.25, 1.8]],
    ]);
    const weight = scalar([
      [0.3, 0],
      [0.8, 1],
      [11.3, 1],
      [12.2, 0],
    ]);
    const target = new Vector3();
    const look = new Vector3();
    return {
      inputs(t) {
        pos(t, target);
        // eyes lead the hand: look where the hand is going ~0.35 s ahead
        pos(t + 0.35, look);
        return [{ rightHand: { position: target, weight: weight(t) }, lookAt: weight(t) > 0.05 ? look : undefined }];
      },
      props: () => [{ kind: 'ball', position: target, size: v(0.07, 0.07, 0.07) }],
    };
  },
};

export const lookAround: Scenario = {
  id: 'look-around',
  title: 'Head tracking only',
  drives: 'head position + rotation',
  description:
    'Only a head pose is given (like a VR headset). Looking beyond neck range turns the torso and then the feet; lowering the head leans, then squats.',
  duration: 16,
  actors: [{}],
  create() {
    const back = -2.6;
    const fwdBack = [Math.sin(back), Math.cos(back)];
    const pos = track([
      [0, [0, 1.6, 0.05]],
      [7, [0, 1.6, 0.05]],
      [8.5, [fwdBack[0] * 0.3, 1.42, fwdBack[1] * 0.3]],
      [9.6, [fwdBack[0] * 0.3, 1.42, fwdBack[1] * 0.3]],
      [11.2, [fwdBack[0] * 0.28, 1.0, fwdBack[1] * 0.28]],
      [12.2, [fwdBack[0] * 0.28, 1.0, fwdBack[1] * 0.28]],
      [13.8, [fwdBack[0] * 0.05, 1.6, fwdBack[1] * 0.05]],
    ]);
    const yaw = scalar([
      [0.5, 0],
      [2, 1.1],
      [3, 1.1],
      [4.5, -1.1],
      [5.2, -1.1],
      [6.8, back],
      [13.8, back],
      [15.5, 0],
    ]);
    const pitch = scalar([
      [7, 0],
      [8.5, 0.75],
      [9.6, 0.75],
      [11.2, 0.25],
      [12.2, 0.25],
      [13.8, 0],
    ]);
    const p = new Vector3();
    const k = headScale();
    return {
      inputs(t) {
        pos(t, p);
        p.y *= k;
        return [{ head: { position: p, rotation: quatYXZ(yaw(t), pitch(t), 0) } }];
      },
      props: () => [],
    };
  },
};

export const vr: Scenario = {
  id: 'vr',
  title: 'VR: head + hands',
  drives: 'head + both hands',
  description:
    'Three-point tracking like a VR headset and controllers: painting a circle, crouching to the floor, cheering, then side-stepping. Pelvis, spine, legs and steps are inferred.',
  duration: 14,
  actors: [{}],
  create() {
    const head = track([
      [0, [0, 1.6, 0.04]],
      [1, [0, 1.58, 0.07]],
      [5, [0, 1.58, 0.07]],
      [6.3, [0, 0.9, 0.3]],
      [7.6, [0, 0.9, 0.3]],
      [8.8, [0, 1.62, 0.02]],
      [10, [0, 1.62, 0.02]],
      [12.7, [0.9, 1.6, 0.06]],
    ]);
    const headPitch = scalar([
      [0, 0],
      [1, 0.2],
      [5, 0.2],
      [6.3, 0.6],
      [7.6, 0.6],
      [8.8, -0.35],
      [9.8, -0.35],
      [10.5, 0.1],
    ]);
    const leftRest = track([
      [0, [0.22, 0.88, 0.08]],
      [1, [0.25, 1.1, 0.3]],
      [5, [0.25, 1.1, 0.3]],
      [6.3, [0.17, 0.08, 0.46]],
      [7.6, [0.17, 0.08, 0.46]],
      [8.8, [0.3, 1.93, 0.1]],
      [10, [0.3, 1.93, 0.1]],
      [10.8, [0.2, 1.1, 0.35]],
      [12.7, [1.1, 1.1, 0.35]],
    ]);
    const rightPath = track([
      [0, [-0.22, 0.88, 0.08]],
      [1, [-0.1, 1.35, 0.45]],
      [5, [-0.1, 1.35, 0.45]],
      [6.3, [-0.17, 0.08, 0.46]],
      [7.6, [-0.17, 0.08, 0.46]],
      [8.8, [-0.3, 1.93, 0.1]],
      [10, [-0.3, 1.93, 0.1]],
      [10.8, [-0.2, 1.1, 0.35]],
      [12.7, [0.7, 1.1, 0.35]],
    ]);
    const h = new Vector3();
    const l = new Vector3();
    const r = new Vector3();
    const k = headScale();
    return {
      inputs(t) {
        head(t, h);
        leftRest(t, l);
        rightPath(t, r);
        h.y *= k;
        l.y *= k;
        r.y *= k;
        if (t > 1.3 && t < 4.8) {
          const a = ((t - 1.3) / 3.5) * Math.PI * 2 * 1.5;
          const k = smoothstep(1.3, 1.8, t) * (1 - smoothstep(4.3, 4.8, t));
          r.x += 0.22 * Math.sin(a) * k;
          r.y += 0.22 * (Math.cos(a) - 1) * k;
        }
        return [
          {
            head: { position: h, rotation: quatYXZ(0, headPitch(t), 0) },
            leftHand: { position: l },
            rightHand: { position: r },
          },
        ];
      },
      props: () => [],
    };
  },
};

export const run: Scenario = {
  id: 'run',
  title: 'Walk → run → walk',
  drives: 'a walk-to point (root)',
  description:
    'Only a "go there" point moves along a path, speeding up from a walk into a run (~3.3 m/s) and back. The gait switches on its own: shorter ground contacts and a flight phase, higher knee recovery, bent pumping arms, forward lean, and the body compressing through each stance.',
  duration: 15,
  cameraDistance: 5.2,
  actors: [{ maxSpeed: 3.6, accel: 2.4 }],
  create() {
    let s = 0;
    const spot = v(0, 0, 0);
    return {
      inputs(t, dt) {
        const walk = 1.2 * smoothstep(0.6, 2, t);
        const running = 2.1 * smoothstep(3, 5, t) * (1 - smoothstep(9.5, 11.5, t));
        const stop = 1 - smoothstep(12.5, 14, t);
        s += (walk + running) * stop * dt;
        const q = path(s + 0.25, 6, 9);
        spot.set(q.p.x, 0, q.p.z);
        return [{ root: { position: spot } }];
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
    const spot = v(0, 0, 0);
    const obstacles = HURDLES.map((h) => ({ minX: -0.5, maxX: 0.5, minZ: h.z - h.depth / 2, maxZ: h.z + h.depth / 2, height: h.height }));
    return {
      inputs(t, dt) {
        // (easing into its stop, like someone arriving somewhere)
        s += 1.1 * smoothstep(0.5, 1.8, t) * Math.min(1, Math.max(0, 7 - s) / 1.2) * dt;
        spot.set(0, 0, s);
        return [{ root: { position: spot }, obstacles }];
      },
      props: () => HURDLES.map((h) => ({ kind: 'box' as const, position: v(0, h.height / 2, h.z), size: v(1, h.height, h.depth) })),
    };
  },
};

/** a chair at the origin, seated facing +Z */
const CHAIR = { x: 0, z: 0, seat: 0.46, width: 0.46, depth: 0.44 };

export const sit: Scenario = {
  id: 'sit',
  title: 'Sit down, stand up',
  drives: 'a seat point (+ a walk-to spot afterwards)',
  description:
    'Only a seat is given. The body walks up to the chair, turns its back to it and sits: hips back and down, trunk leaning over the feet until the chair takes the weight, then settling upright with the hands on the thighs. When the seat is taken away it leans forward and pushes up before walking off.',
  duration: 16,
  actors: [{ position: { x: 0.5, y: 0, z: 3.2 }, yaw: Math.PI }],
  create() {
    const seat = v(CHAIR.x, CHAIR.seat, CHAIR.z + 0.03);
    const facing = quatYXZ(0, 0, 0);
    const away = v(-1.6, 0, 2.6);
    return {
      inputs(t) {
        if (t < 0.6) return [{}];
        if (t < 10) {
          // seated: glance at something to the left for a while
          const lookAt = t > 6.5 && t < 8.5 ? v(-2, 1.0, 1.5) : undefined;
          return [{ seat: { position: seat, rotation: facing }, lookAt }];
        }
        return [{ root: t > 11.4 ? { position: away } : undefined }];
      },
      props: () => [
        { kind: 'box' as const, position: v(CHAIR.x, CHAIR.seat - 0.02, CHAIR.z), size: v(CHAIR.width, 0.04, CHAIR.depth) },
        { kind: 'box' as const, position: v(CHAIR.x, CHAIR.seat + 0.24, CHAIR.z - CHAIR.depth / 2 + 0.02), size: v(CHAIR.width, 0.44, 0.03) },
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => ({
            kind: 'box' as const,
            position: v(CHAIR.x + sx * (CHAIR.width / 2 - 0.03), (CHAIR.seat - 0.04) / 2, CHAIR.z + sz * (CHAIR.depth / 2 - 0.03)),
            size: v(0.03, CHAIR.seat - 0.04, 0.03),
          })),
        ),
      ],
    };
  },
};
