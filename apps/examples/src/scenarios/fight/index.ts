import { Vector3 } from 'three';
import type { Scenario, ScenarioInput } from '../../scenario';
import { pulse } from '../../keys';
import { minimumJerk, quatYXZ, yawOf } from '../../math';
import { eyesOf, jointOf } from '../../joints';
import { Bout } from './bout';
import { isStrike, MOVES, type Course, type Move } from './moves';

/**
 * Two reactive fighters. Nothing is choreographed frame by frame: each fighter picks
 * combos at irregular moments; the other *perceives* each strike after a human
 * reaction time and defends — or is too late and gets hit (head snap / body fold and
 * a stagger via `Humanoid.push`).
 */

const STANCE = { width: 0.14, stagger: 0.42, crouch: 0.07, blade: -0.42, toeOut: 0.22, guard: true };
const RANGE = 0.9;
const CENTER = new Vector3(0, 0, 0.65);

export const fight: Scenario = {
  id: 'fight',
  title: 'Boxing & kicking (two actors)',
  drives: 'strikes & defences, decided live by two reactive fighters',
  description:
    'Two orthodox fighters circle, step in and throw combos; each reacts to the other after a human reaction time (~0.2 s) — blocking, slipping, ducking or stepping back — and sometimes is too late: a landed shot snaps the head or folds the body and makes them stagger. Stance, balance, trunk rotation, footwork and gaze are inferred.',
  duration: 16,
  cameraDistance: 6.0,
  environment: { kind: 'boxing-arena', center: [0, 0, 0.85] },
  actors: [
    { position: { x: 0, y: 0, z: CENTER.z - RANGE / 2 }, yaw: 0, stance: STANCE, maxSpeed: 1.8 },
    { position: { x: 0, y: 0, z: CENTER.z + RANGE / 2 }, yaw: Math.PI, stance: STANCE, maxSpeed: 1.8 },
  ],
  focus: (a) => jointOf(a[0], 'hips').add(jointOf(a[1], 'hips')).multiplyScalar(0.5).setY(1.0),
  create() {
    const bout = new Bout();
    const courses = new Map<Move, Course>();
    return {
      inputs(t, _dt, actors) {
        bout.decide(t, actors);
        bout.land(t, actors);
        // slow circling around the ring's centre, shared by both
        const orbit = 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.61 + 1.3);
        const axis = new Vector3(Math.sin(orbit), 0, Math.cos(orbit));
        return actors.map((self, i) => {
          const opp = actors[1 - i];
          const mine = bout.moves.filter((m) => m.who === i);
          // in/out range: a slight sway plus the fighter's steps
          let off = 0.05 * Math.sin(t * (1.1 + 0.3 * i) + i * 2);
          for (const s of bout.fighters[i].steps) off += s.dist * minimumJerk((t - s.at) / 0.3);
          const spot = CENTER.clone().addScaledVector(axis, (i === 0 ? -1 : 1) * (RANGE / 2 - off));
          let striking = 0;
          for (const m of mine) if (isStrike(m.kind)) striking = Math.max(striking, pulse(t, m.at, ...MOVES[m.kind].timing));
          // square up to the opponent, also while moving (circling, stepping in and out); the
          // stance gives way while striking
          const o = opp.model.scene.position;
          const r = self.model.scene.position;
          const input: ScenarioInput = {
            lookAt: eyesOf(opp),
            goal: { position: spot, quaternion: quatYXZ(yawOf(o.x - r.x, o.z - r.z)), weight: 1 - 0.7 * striking },
          };
          for (const m of mine) {
            const [rise, hold, fall] = MOVES[m.kind].timing;
            if (t < m.at || t > m.at + rise + hold + fall) continue;
            let course = courses.get(m);
            if (!course) {
              course = MOVES[m.kind].start(m, self, opp);
              courses.set(m, course);
            }
            const w = pulse(t, m.at, rise, hold, fall);
            blend(input, effectorOf(m), course(t, w), w);
          }
          return input;
        });
      },
      props: () => [],
    };
  },
};

type Effector = 'leftHand' | 'rightHand' | 'head' | 'leftFoot' | 'rightFoot';

function effectorOf(m: Move): Effector {
  const limb = MOVES[m.kind].limb;
  if (limb === 'head') return 'head';
  if (limb === 'hand') return m.side === 'left' ? 'leftHand' : 'rightHand';
  return m.side === 'left' ? 'leftFoot' : 'rightFoot';
}

/** sets an effector, blending with another move already driving it (block + counter) */
function blend(input: ScenarioInput, key: Effector, pos: Vector3, w: number) {
  const prev = input[key];
  if (prev && (prev.weight ?? 1) > 0) {
    const pw = prev.weight ?? 1;
    const total = pw + w;
    const blended = prev.position.clone().multiplyScalar(pw / total).addScaledVector(pos, w / total);
    input[key] = { position: blended, weight: Math.min(1, Math.max(pw, w)) };
  } else input[key] = { position: pos.clone(), weight: w };
}
