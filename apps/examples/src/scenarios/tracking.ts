import { MathUtils, Vector3, type Quaternion } from 'three';
import type { Proportions } from '@prohuman/core';
import type { Scenario } from '../scenario';
import { scalar, track } from '../keys';
import { quatYXZ } from '../math';

// Keyframed trackers, like a VR headset and controllers: a hand, a head, or head + hands.

/** the standing skull-centre height the head tracks below were recorded at */
const RECORDED = 1.6;

/** Headset calibration: the factor from recorded heights to this body's. */
const heightScale = (p: Proportions) => (p.eyeHeight - p.eyes.y + p.headCenter.y) / RECORDED;

/** a head target: the eyes of a skull centred at `center`, turned by `q` */
const headAt = (p: Proportions, center: Vector3, q: Quaternion) => ({ position: p.eyes.clone().sub(p.headCenter).applyQuaternion(q).add(center), quaternion: q });

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
      props: () => [{ kind: 'ball', position: target, radius: 0.035 }],
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
    const [bx, bz] = [Math.sin(back), Math.cos(back)];
    const center = track([
      [0, [0, 1.6, 0.05]],
      [7, [0, 1.6, 0.05]],
      [8.5, [bx * 0.3, 1.42, bz * 0.3]],
      [9.6, [bx * 0.3, 1.42, bz * 0.3]],
      [11.2, [bx * 0.28, 1.0, bz * 0.28]],
      [12.2, [bx * 0.28, 1.0, bz * 0.28]],
      [13.8, [bx * 0.05, 1.6, bz * 0.05]],
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
    const c = new Vector3();
    return {
      inputs(t, _dt, [{ proportions: p }]) {
        center(t, c);
        c.y *= heightScale(p);
        return [{ head: headAt(p, c, quatYXZ(yaw(t), pitch(t))) }];
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
    const leftHand = track([
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
    const rightHand = track([
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
    return {
      inputs(t, _dt, [{ proportions: p }]) {
        head(t, h);
        leftHand(t, l);
        rightHand(t, r);
        const k = heightScale(p);
        h.y *= k;
        l.y *= k;
        r.y *= k;
        // the right hand paints one and a half circles
        if (t > 1.3 && t < 4.8) {
          const a = ((t - 1.3) / 3.5) * Math.PI * 2 * 1.5;
          const w = MathUtils.smoothstep(t, 1.3, 1.8) * (1 - MathUtils.smoothstep(t, 4.3, 4.8));
          r.x += 0.22 * Math.sin(a) * w;
          r.y += 0.22 * (Math.cos(a) - 1) * w;
        }
        return [{ head: headAt(p, h, quatYXZ(0, headPitch(t))), leftHand: { position: l }, rightHand: { position: r } }];
      },
      props: () => [],
    };
  },
};
