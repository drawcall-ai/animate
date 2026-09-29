import { Vector3 } from 'three';
import { forwardOf, leftOf, minimumJerk, type Humanoid, type HumanoidInput } from '@prohuman/core';
import type { Scenario } from '../scenario';
import { pulse, spline, type V3 } from '../keys';

/**
 * Two reactive fighters. Nothing is choreographed frame by frame: each fighter picks
 * combos at irregular moments; the other *perceives* each strike after a human
 * reaction time and defends — or is too late and gets hit (head snap / body fold and
 * a stagger via `Humanoid.impulse`). A seeded RNG keeps every run identical.
 */

type Side = 'left' | 'right';
type Kind =
  | 'jab'
  | 'cross'
  | 'hook'
  | 'uppercut'
  | 'body'
  | 'block'
  | 'blockBody'
  | 'parry'
  | 'slip'
  | 'duck'
  | 'lean'
  | 'step'
  | 'frontKick'
  | 'roundhouse';

interface Move {
  at: number;
  who: 0 | 1;
  kind: Kind;
  side?: Side;
  dist?: number;
  /** a strike that will connect (the defence was too late) */
  landed?: boolean;
}

/** [rise, hold, fall] seconds */
const TIMING: Record<Kind, [number, number, number]> = {
  jab: [0.16, 0.05, 0.24],
  cross: [0.2, 0.06, 0.3],
  hook: [0.24, 0.06, 0.3],
  uppercut: [0.24, 0.06, 0.3],
  body: [0.2, 0.06, 0.28],
  block: [0.12, 0.3, 0.25],
  blockBody: [0.12, 0.35, 0.25],
  parry: [0.1, 0.08, 0.22],
  slip: [0.16, 0.16, 0.3],
  duck: [0.2, 0.2, 0.32],
  lean: [0.16, 0.18, 0.3],
  step: [0.3, 0, 0],
  frontKick: [0.1, 0.8, 0.14],
  roundhouse: [0.1, 0.88, 0.14],
};

const STRIKES = new Set<Kind>(['jab', 'cross', 'hook', 'uppercut', 'body', 'frontKick', 'roundhouse']);
const COMBOS: [Kind, Side][][] = [
  [['jab', 'left']],
  [['jab', 'left'], ['cross', 'right']],
  [['jab', 'left'], ['jab', 'left'], ['cross', 'right']],
  [['jab', 'left'], ['cross', 'right'], ['hook', 'left']],
  [['body', 'right'], ['hook', 'left']],
  [['cross', 'right'], ['hook', 'left']],
  [['uppercut', 'right'], ['hook', 'left']],
  [['roundhouse', 'right']],
  [['frontKick', 'right']],
];

const STANCE = { width: 0.14, stagger: 0.42, crouch: 0.07, turn: -0.42, toeOut: 0.22, guard: true };
const RANGE = 0.9;
const CENTER = new Vector3(0, 0, 0.65);

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Active {
  move: Move;
  base: Vector3;
  aim: Vector3;
  path?: (t: number, out?: Vector3) => Vector3;
}

interface Fighter {
  nextAttack: number;
  busyUntil: number;
  /** footwork: range offset events (step in/out), summed with minimum-jerk easing */
  steps: { at: number; dist: number }[];
  aggression: number;
}

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
    { position: { x: 0, y: 0, z: CENTER.z - RANGE / 2 }, yaw: 0, stance: STANCE, faceTravel: false, maxSpeed: 1.8 },
    { position: { x: 0, y: 0, z: CENTER.z + RANGE / 2 }, yaw: Math.PI, stance: STANCE, faceTravel: false, maxSpeed: 1.8 },
  ],
  focus: (a) => a[0].pose.pelvis.clone().add(a[1].pose.pelvis).multiplyScalar(0.5).setY(1.0),
  create() {
    const rand = rng(7);
    const between = (a: number, b: number) => a + (b - a) * rand();
    const fighters: Fighter[] = [0, 1].map((i) => ({
      nextAttack: 0.8 + i * 0.9 + between(0, 0.4),
      busyUntil: 0,
      steps: [],
      aggression: i === 0 ? 1.0 : 0.85,
    }));
    const moves: Move[] = [];
    const started = new Map<Move, Active>();
    const hits: { at: number; who: 0 | 1; kind: Kind; landed: boolean }[] = [];

    /** schedule a strike and the opponent's perceived reaction */
    const strike = (t: number, who: 0 | 1, kind: Kind, side: Side) => {
      const move: Move = { at: t, who, kind, side };
      moves.push(move);
      const [rise] = TIMING[kind];
      const arrive = t + rise;
      const def = (1 - who) as 0 | 1;
      const reaction = between(0.17, 0.32);
      const react = t + reaction;
      const head = kind === 'jab' || kind === 'cross' || kind === 'hook' || kind === 'uppercut';
      const r = rand();
      let defence: Kind;
      if (kind === 'frontKick' || kind === 'roundhouse') defence = r < 0.5 ? 'blockBody' : 'step';
      else if (!head) defence = 'blockBody';
      else if (kind === 'hook') defence = r < 0.5 ? 'duck' : 'block';
      else if (kind === 'uppercut') defence = r < 0.6 ? 'lean' : 'block';
      else defence = r < 0.45 ? 'block' : r < 0.8 ? 'slip' : 'parry';
      const defSide: Side = kind === 'hook' || side === 'left' ? 'right' : 'left';
      const defRise = defence === 'step' ? 0.2 : TIMING[defence][0];
      // too slow, or simply beaten: the shot lands
      const inTime = react + defRise * 0.7 <= arrive + (kind === 'frontKick' || kind === 'roundhouse' ? 0.3 : 0.02);
      const landed = !inTime || rand() < 0.2;
      move.landed = landed;
      if (!landed || rand() < 0.5) {
        if (defence === 'step') fighters[def].steps.push({ at: react, dist: -0.25 });
        else moves.push({ at: react, who: def, kind: defence, side: defSide });
      }
      hits.push({ at: arrive, who: def, kind, landed });
      // a good defence invites a counter
      if (!landed && rand() < 0.55) fighters[def].nextAttack = Math.min(fighters[def].nextAttack, arrive + between(0.12, 0.35));
      return arrive + TIMING[kind][1] + TIMING[kind][2];
    };

    const plan = (t: number, who: 0 | 1) => {
      const f = fighters[who];
      const combo = COMBOS[Math.floor(rand() * COMBOS.length)];
      let at = t;
      const kicking = combo.some(([k]) => k === 'frontKick' || k === 'roundhouse');
      // step in to punching range, step out after (kicks already reach from here)
      if (!kicking) f.steps.push({ at: at - 0.05, dist: 0.16 });
      const handFree: Record<Side, number> = { left: at, right: at };
      for (const [kind, side] of combo) {
        // the same fist goes again only once it's (nearly) back in guard
        at = Math.max(at, handFree[side]);
        const end = strike(at, who, kind, side);
        handFree[side] = end - 0.06;
        at = Math.max(at + between(0.26, 0.38), end - 0.18);
        if (kind === 'frontKick' || kind === 'roundhouse') at = end;
      }
      if (!kicking) f.steps.push({ at: at + 0.1, dist: -0.16 });
      f.busyUntil = at + 0.3;
      f.nextAttack = at + between(1.0, 2.2) / f.aggression;
    };

    const processed = new Set<(typeof hits)[number]>();
    return {
      inputs(t, _dt, actors: Humanoid[]) {
        // decide
        for (const who of [0, 1] as const) {
          const f = fighters[who];
          const planted = actors[who].gait.feet.every((ft) => ft.phase === 'planted');
          if (t >= f.nextAttack && t >= f.busyUntil && t < 14.5 && planted) plan(t, who);
        }
        // land hits
        for (const h of hits) {
          if (processed.has(h) || t < h.at) continue;
          processed.add(h);
          const def = actors[h.who];
          const att = actors[1 - h.who];
          const dir = new Vector3().subVectors(def.pose.pelvis, att.pose.pelvis).setY(0).normalize();
          const kicked = h.kind === 'frontKick' || h.kind === 'roundhouse';
          const head = !kicked && h.kind !== 'body';
          if (h.landed) {
            if (h.kind === 'hook') dir.add(leftOf(att.gait.root.yaw).multiplyScalar(-0.8)).normalize();
            const strength = { jab: 0.55, cross: 0.95, hook: 0.9, uppercut: 0.8, body: 0.75, frontKick: 1.2, roundhouse: 1.1 }[h.kind as 'jab'] ?? 0.6;
            def.impulse(dir, strength, head ? 'head' : 'body');
            fighters[h.who].busyUntil = Math.max(fighters[h.who].busyUntil, t + 0.5);
            fighters[h.who].nextAttack = Math.max(fighters[h.who].nextAttack, t + 0.6);
          } else def.impulse(dir, 0.2, 'body'); // absorbed on the guard
        }

        // continuous footwork: slow circling + in/out range, plus step events
        const orbit = 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.61 + 1.3);
        const axis = new Vector3(Math.sin(orbit), 0, Math.cos(orbit));
        return actors.map((a, i) => {
          const f = fighters[i];
          let off = 0.05 * Math.sin(t * (1.1 + 0.3 * i) + i * 2);
          for (const s of f.steps) off += s.dist * minimumJerk((t - s.at) / 0.3);
          const dir = i === 0 ? -1 : 1;
          const spot = CENTER.clone().addScaledVector(axis, dir * (RANGE / 2 - off));
          let striking = 0;
          for (const m of moves) {
            if (m.who !== i || !STRIKES.has(m.kind)) continue;
            const [r, h, fl] = TIMING[m.kind];
            striking = Math.max(striking, pulse(t, m.at, r, h, fl));
          }
          const input: HumanoidInput = {
            lookAt: actors[1 - i].pose.headCenter.clone(),
            root: { position: spot, weight: 1 - 0.7 * striking },
          };
          for (const m of moves) {
            if (m.who !== i || m.kind === 'step') continue;
            const [rise, hold, fall] = TIMING[m.kind];
            if (t < m.at || t > m.at + rise + hold + fall) continue;
            let st = started.get(m);
            if (!st) {
              st = start(m, a, actors[1 - i]);
              started.set(m, st);
            }
            if (m.landed && STRIKES.has(m.kind) && m.kind !== 'frontKick' && m.kind !== 'roundhouse') {
              const o = actors[1 - i].pose;
              const toOpp = new Vector3().subVectors(o.headCenter, a.pose.headCenter).setY(0).normalize();
              if (m.kind === 'body') st.aim.copy(o.chest).addScaledVector(toOpp, -0.12).setY(o.chest.y - 0.1);
              else st.aim.copy(o.nose).addScaledVector(toOpp, -0.04);
            }
            apply(st, t, a, input);
          }
          return input;
        });
      },
      props: () => [],
    };
  },
};

function start(m: Move, self: Humanoid, opp: Humanoid): Active {
  const p = self.pose;
  const yaw = self.gait.root.yaw;
  const f = forwardOf(yaw);
  const l = leftOf(yaw);
  const sgn = m.side === 'left' ? 1 : -1;
  const aim = new Vector3();
  const base = new Vector3();
  const toOpp = new Vector3().subVectors(opp.pose.headCenter, p.headCenter).setY(0).normalize();

  switch (m.kind) {
    case 'jab':
    case 'cross':
    case 'hook':
    case 'uppercut':
      // aim where the face is now; the strike stops at its surface
      aim.copy(opp.pose.nose).addScaledVector(toOpp, -0.07);
      break;
    case 'body':
      aim.copy(opp.pose.chest).addScaledVector(toOpp, -0.14).y -= 0.12;
      break;
    case 'slip':
    case 'duck':
    case 'lean':
      base.copy(p.headCenter);
      break;
    case 'step':
      base.copy(p.pelvis).addScaledVector(f, m.dist ?? 0);
      break;
    case 'frontKick':
    case 'roundhouse': {
      const s = m.side === 'left' ? 0 : 1;
      const foot = self.gait.feet[s].anchor.clone();
      const hip = m.side === 'left' ? p.leftHip : p.rightHip;
      const reach = self.dims.legLength * 0.96;
      let chamber: Vector3;
      let target: Vector3;
      let via: Vector3;
      if (m.kind === 'frontKick') {
        chamber = hip.clone().addScaledVector(f, 0.28).setY(0.5);
        target = opp.pose.pelvis.clone().addScaledVector(toOpp, -0.16);
        target.y += 0.12;
        via = chamber;
      } else {
        chamber = hip.clone().addScaledVector(l, sgn * 0.32).addScaledVector(f, 0.05).setY(0.62);
        target = opp.pose.spine.clone().addScaledVector(toOpp, -0.14).addScaledVector(l, -sgn * 0.12);
        target.y = 1.0;
        via = chamber.clone().addScaledVector(f, 0.25).setY(0.85);
      }
      // strike with a (nearly) straight leg: contact point at ~full leg length
      target.sub(hip).setLength(reach).add(hip);
      // keyed in the body's root frame (moves smoothly), not the hip (leans and shifts)
      const root = new Vector3(self.gait.root.x, 0, self.gait.root.z);
      const rel = (v: Vector3) => {
        const d = v.clone().sub(root);
        return [d.dot(l), d.y, d.dot(f)] as V3;
      };
      const keys: [number, V3][] = [
        [0, rel(foot)],
        [0.22, rel(chamber)],
        [0.34, rel(via)],
        [0.5, rel(target)],
        [0.74, rel(chamber)],
        [1.0, rel(foot)],
      ];
      return { move: m, base, aim, path: spline(keys) };
    }
  }
  return { move: m, base, aim };
}

/** set an effector, blending with another move already driving it (block + counter) */
function drive(input: HumanoidInput, key: 'leftHand' | 'rightHand' | 'head' | 'leftFoot' | 'rightFoot', pos: Vector3, w: number) {
  const prev = input[key];
  if (prev?.position && (prev.weight ?? 1) > 0) {
    const pw = prev.weight ?? 1;
    const total = pw + w;
    const blended = new Vector3().copy(prev.position as Vector3).multiplyScalar(pw / total).addScaledVector(pos, w / total);
    input[key] = { position: blended, weight: Math.min(1, Math.max(pw, w)) };
  } else input[key] = { position: pos.clone(), weight: w };
}

function apply(st: Active, t: number, self: Humanoid, input: HumanoidInput) {
  const m = st.move;
  const [rise, hold, fall] = TIMING[m.kind];
  const w = pulse(t, m.at, rise, hold, fall);
  const p = self.pose;
  const yaw = self.gait.root.yaw;
  const f = forwardOf(yaw);
  const l = leftOf(yaw);
  const sgn = m.side === 'left' ? 1 : -1;
  const hand = m.side === 'left' ? 'leftHand' : 'rightHand';
  const pos = new Vector3();

  switch (m.kind) {
    case 'jab':
    case 'cross':
    case 'body':
      drive(input, hand, st.aim, w);
      break;
    case 'hook':
      // arrives from the outside
      pos.copy(st.aim).addScaledVector(l, sgn * 0.32 * (1 - w));
      drive(input, hand, pos, w);
      break;
    case 'uppercut':
      pos.copy(st.aim).setY(st.aim.y - 0.35 * (1 - w));
      drive(input, hand, pos, w);
      break;
    case 'block':
      pos.copy(p.headCenter).addScaledVector(l, sgn * 0.1).addScaledVector(f, 0.13);
      pos.y += 0.02;
      drive(input, hand, pos, w);
      break;
    case 'blockBody':
      pos.copy(p.chest).addScaledVector(l, sgn * 0.13).addScaledVector(f, 0.17);
      pos.y -= 0.02;
      drive(input, hand, pos, w);
      break;
    case 'parry':
      pos.copy(p.chest).addScaledVector(l, -sgn * 0.04).addScaledVector(f, 0.36);
      pos.y += 0.12;
      drive(input, hand, pos, w);
      break;
    case 'slip':
      pos.copy(st.base).addScaledVector(l, sgn * 0.15).addScaledVector(f, 0.04);
      pos.y -= 0.08;
      drive(input, 'head', pos, w);
      break;
    case 'duck':
      pos.copy(st.base).addScaledVector(f, 0.08);
      pos.y -= 0.24;
      drive(input, 'head', pos, w);
      break;
    case 'lean':
      pos.copy(st.base).addScaledVector(f, -0.15);
      pos.y -= 0.02;
      drive(input, 'head', pos, w);
      break;
    case 'step':
      break;
    case 'frontKick':
    case 'roundhouse': {
      const dur = rise + hold + fall;
      const k = st.path!((t - m.at) / dur, new Vector3());
      pos.set(self.gait.root.x, 0, self.gait.root.z).addScaledVector(l, k.x).addScaledVector(f, k.z);
      pos.y = k.y;
      drive(input, m.side === 'left' ? 'leftFoot' : 'rightFoot', pos, w);
      break;
    }
  }
}


