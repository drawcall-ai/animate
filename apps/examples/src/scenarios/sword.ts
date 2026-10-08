import { Quaternion, Vector3 } from 'three';
import type { Scenario, ScenarioInput } from '../scenario';
import { spline, type Key, type V3 } from '../keys';
import { quatBasis, quatYXZ, vec } from '../math';

/** the training post struck at, straight ahead along +z */
const POST = vec(0, 0, 1.75);
const BLADE = 0.85;
/** when the combo starts (s) */
const START = 0.8;
/** how long before a lunge its foot target comes, for the weight to go onto the other foot (s) */
const WEIGHT_SHIFT = 0.15;

/**
 * The sword hand through the combo, from START (s): the wrist (x left, y up, z toward the
 * post; m, default body, from where the body starts), the blade's direction and the way its
 * edge cuts (the fist's knuckles lead). Each hit winds up (anticipation), strikes in about a
 * fifth of a second and follows through: a diagonal slash from high right to low left, a
 * horizontal return from left to right, an overhead strike.
 */
const HAND: Key<V3>[] = [
  [0, [-0.12, 1.05, 0.35]],
  [0.35, [-0.28, 1.58, 0.05]],
  [0.46, [-0.12, 1.35, 0.55]],
  [0.56, [0.22, 0.85, 0.75]],
  [0.72, [0.3, 0.8, 0.6]],
  [1.02, [0.4, 1.2, 0.55]],
  [1.14, [0.05, 1.22, 1.0]],
  [1.26, [-0.42, 1.15, 0.75]],
  [1.4, [-0.45, 1.15, 0.6]],
  [1.8, [-0.05, 1.92, 0.5]],
  [1.92, [-0.05, 1.45, 1.1]],
  [2.02, [-0.05, 0.95, 1.3]],
  [2.25, [-0.05, 0.9, 1.25]],
  [3.1, [-0.12, 1.05, 1.15]],
];
const BLADE_DIR: Key<V3>[] = [
  [0, [-0.1, 0.6, 0.8]],
  [0.35, [0.35, 0.75, -0.55]],
  [0.46, [-0.3, 0.3, 0.9]],
  [0.56, [0.75, -0.45, 0.2]],
  [0.72, [0.8, -0.3, -0.3]],
  [1.02, [0.75, 0.2, -0.6]],
  [1.14, [0.1, 0.1, 1]],
  [1.26, [-0.9, 0.05, 0.1]],
  [1.4, [-0.8, 0.3, -0.4]],
  [1.8, [0, 0.35, -0.95]],
  [1.92, [0, 0.9, 0.4]],
  [2.02, [0, -0.2, 1]],
  [2.25, [0, -0.25, 1]],
  [3.1, [-0.1, 0.6, 0.8]],
];
const EDGE: Key<V3>[] = [
  [0, [0, -1, 0]],
  [0.35, [0.3, 0.2, 1]],
  [0.46, [0.6, -0.8, 0.1]],
  [0.56, [0.3, -0.5, -0.8]],
  [0.72, [0, 0, -1]],
  // (the knuckles come up as the blade is raised: turned through, never across the blade)
  [0.87, [-0.2, 1, 0]],
  [1.02, [-0.4, 0, 1]],
  [1.14, [-1, 0, 0]],
  [1.26, [-0.1, 0, -1]],
  [1.4, [0, 1, 0]],
  [1.8, [0, 0.9, 0.4]],
  [1.92, [0, 0.3, 1]],
  [2.02, [0, -1, 0.2]],
  [2.25, [0, -1, 0]],
  [3.1, [0, -1, 0]],
];
/** the lunges: which foot, when it lifts and lands (from START, s), and where to from where it stood (m) */
const LUNGES = [
  { foot: 1, from: 0.24, to: 0.5, step: vec(0.02, 0, 0.5) },
  { foot: 0, from: 1.6, to: 1.95, step: vec(0.0, 0, 0.55) },
] as const;

/**
 * A sword combo driven by the sword hand and its rotation; the lunging foot's target steps in
 * with each hit that closes in (let go of on the floor: the foot stays there), and a
 * walk-to spot between the feet settles the body after each. The weight shift, the hips
 * leading the shoulders into each cut, the free arm and the recovery are inferred.
 */
export const sword: Scenario = {
  id: 'sword',
  title: 'Sword combo',
  drives: 'the sword hand + rotation, the lunging foot, a walk-to spot between the feet',
  description:
    'Three hits at a training post: a diagonal slash from high right to low left stepping in with the right foot, a horizontal return from left to right, and an overhead strike stepping in with the left foot. Each winds up, strikes in about a fifth of a second and follows through. The weight going onto the lunging foot, the hips leading the shoulders, the free arm and the recovery into guard are inferred.',
  duration: 5,
  actors: [{ stance: { width: 0.12, stagger: 0.2, crouch: 0.05, blade: -0.3, toeOut: 0.2, guard: false } }],
  facing: 0,
  create() {
    const hand = spline(HAND);
    const blade = spline(BLADE_DIR);
    const edge = spline(EDGE);
    const wrist = new Vector3();
    const dir = new Vector3();
    const cut = new Vector3();
    const rot = new Quaternion();
    /** each lunge: where its foot stood, when it lifted (s from START), whether it landed */
    const gone = LUNGES.map(() => ({ from: null as Vector3 | null, lift: null as number | null, landed: false }));
    let spot = vec(0, 0, 0);
    return {
      inputs(t, _dt, [h]) {
        const k = h.proportions.scale;
        const s = t - START;
        const input: ScenarioInput = { lookAt: vec(POST.x, 1.2, POST.z) };
        hand(Math.max(0, s), wrist).multiplyScalar(k);
        // the sword in the fist: the blade out on the thumb's side, the knuckles along the cut
        blade(Math.max(0, s), dir).normalize();
        edge(Math.max(0, s), cut);
        cut.addScaledVector(dir, -cut.dot(dir)).normalize();
        const x = cut.clone().negate();
        const y = dir.clone().cross(x);
        quatBasis(x, y, dir, rot);
        input.rightHand = { position: wrist.clone(), quaternion: rot.clone(), weight: Math.min(1, t / 0.5) };
        LUNGES.forEach((l, i) => {
          // (the foot target comes a moment early: the weight goes onto the other foot first,
          // and the lunge runs from the moment the foot is up)
          if (s < l.from - WEIGHT_SHIFT) return;
          const f = h.feet[l.foot];
          const g = gone[i];
          if (g.lift === null && f.phase !== 'planted') g.lift = s;
          const u = g.lift === null ? 0 : (s - g.lift) / (l.to - l.from);
          if (u < 1) {
            g.from ??= f.position.clone();
            const pos = g.from.clone().addScaledVector(l.step, k * u * u * (3 - 2 * u));
            pos.y += 0.07 * k * Math.sin(Math.PI * u);
            input[l.foot === 0 ? 'leftFoot' : 'rightFoot'] = { position: pos };
          } else if (!g.landed) {
            // settle between the feet, more over the front one
            g.landed = true;
            spot = h.feet[1 - l.foot].position.clone().lerp(f.position, 0.6).setY(0);
          }
        });
        input.goal = { position: spot, quaternion: quatYXZ(0) };
        return [input];
      },
      props: () => [
        { kind: 'rod', position: wrist.clone().addScaledVector(dir, 0.05), to: wrist.clone().addScaledVector(dir, 0.05 + BLADE), radius: 0.012, held: { hand: 'right' } },
        { kind: 'box', position: vec(POST.x, 0.8, POST.z), size: vec(0.18, 1.6, 0.18) },
      ],
    };
  },
};
