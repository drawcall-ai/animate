import { Vector3 } from 'three';
import type { Humanoid } from '@prohuman/core';
import { spline, type V3 } from '../../keys';
import { forwardOf, leftOf } from '../../math';
import { eyesOf, jointOf } from '../../joints';

export type LeftRight = 'left' | 'right';
export type Strike = 'jab' | 'cross' | 'hook' | 'uppercut' | 'body' | 'frontKick' | 'roundhouse';
export type Defence = 'block' | 'blockBody' | 'parry' | 'slip' | 'duck' | 'lean';
export type Kind = Strike | Defence;
export type Who = 0 | 1;

export const other = (who: Who): Who => (who === 0 ? 1 : 0);

/** a move one fighter makes, starting at `at` */
export interface Move {
  at: number;
  who: Who;
  kind: Kind;
  side: LeftRight;
  /** a strike that will connect (the defence was too late) */
  landed: boolean;
}

/** how hard each strike hits, relative to a straight right */
export const STRENGTH: Record<Strike, number> = { jab: 0.55, cross: 0.95, hook: 0.9, uppercut: 0.8, body: 0.75, frontKick: 1.2, roundhouse: 1.1 };

export const isStrike = (k: Kind): k is Strike => k in STRENGTH;

/** the limb target a move sets at time `t`, with the move's weight `w` */
export type Course = (t: number, w: number) => Vector3;

interface MoveType {
  /** [rise, hold, fall] seconds */
  timing: readonly [number, number, number];
  limb: 'hand' | 'foot' | 'head';
  /** called as the move starts: fixes its course */
  start(m: Move, self: Humanoid, opp: Humanoid): Course;
}

/** the mover's forward and left now, and ±1 for the side the move is made with */
function axes(self: Humanoid, side: LeftRight) {
  const yaw = self.yaw;
  return { f: forwardOf(yaw), l: leftOf(yaw), sgn: side === 'left' ? 1 : -1 };
}

const toward = (self: Humanoid, opp: Humanoid) => eyesOf(opp).sub(eyesOf(self)).setY(0).normalize();

/**
 * Where a punch goes: where the face (or the chest, for a body shot) is as it starts, stopping
 * at its surface. A punch that lands follows the target and goes a little deeper.
 */
function punch(timing: MoveType['timing'], shape: (aim: Vector3, w: number, self: Humanoid, side: LeftRight) => Vector3 = (aim) => aim): MoveType {
  return {
    timing,
    limb: 'hand',
    start(m, self, opp) {
      const aim = new Vector3();
      if (m.kind === 'body') jointOf(opp, 'chest', aim).addScaledVector(toward(self, opp), -0.14).y -= 0.12;
      else jointOf(opp, 'nose', aim).addScaledVector(toward(self, opp), -0.07);
      return (_t, w) => {
        if (m.landed && m.kind === 'body') jointOf(opp, 'chest', aim).addScaledVector(toward(self, opp), -0.12).y -= 0.1;
        else if (m.landed) jointOf(opp, 'nose', aim).addScaledVector(toward(self, opp), -0.04);
        return shape(aim, w, self, m.side);
      };
    },
  };
}

/** a hand held at a spot in the body's frame: `at(self)` + sideways (toward the move's side), forward and up */
function guard(timing: MoveType['timing'], at: (self: Humanoid, out: Vector3) => Vector3, lateral: number, forward: number, up: number): MoveType {
  return {
    timing,
    limb: 'hand',
    start: (m, self) => () => {
      const { f, l, sgn } = axes(self, m.side);
      const pos = at(self, new Vector3()).addScaledVector(l, sgn * lateral).addScaledVector(f, forward);
      pos.y += up;
      return pos;
    },
  };
}

/** the head moved away from where it was as the move started: sideways (toward the move's side), forward and up */
function evade(timing: MoveType['timing'], lateral: number, forward: number, up: number): MoveType {
  return {
    timing,
    limb: 'head',
    start(m, self) {
      const base = eyesOf(self);
      return () => {
        const { f, l, sgn } = axes(self, m.side);
        const pos = base.clone();
        if (lateral) pos.addScaledVector(l, sgn * lateral);
        pos.addScaledVector(f, forward);
        pos.y += up;
        return pos;
      };
    },
  };
}

/**
 * A kick: the foot chambers, extends a (nearly) straight leg to the target and returns,
 * along one smooth path keyed in the body's root frame (which moves smoothly, unlike the
 * hip, which leans and shifts).
 */
function kick(timing: MoveType['timing']): MoveType {
  return {
    timing,
    limb: 'foot',
    start(m, self, opp) {
      const { f, l, sgn } = axes(self, m.side);
      const toOpp = toward(self, opp);
      const foot = self.feet[m.side === 'left' ? 0 : 1].position.clone();
      const hip = jointOf(self, `${m.side}UpperLeg`);
      let chamber: Vector3;
      let target: Vector3;
      let via: Vector3;
      if (m.kind === 'frontKick') {
        chamber = hip.clone().addScaledVector(f, 0.28).setY(0.5);
        target = jointOf(opp, 'hips').addScaledVector(toOpp, -0.16);
        target.y += 0.12;
        via = chamber;
      } else {
        chamber = hip.clone().addScaledVector(l, sgn * 0.32).addScaledVector(f, 0.05).setY(0.62);
        target = jointOf(opp, 'spine').addScaledVector(toOpp, -0.14).addScaledVector(l, -sgn * 0.12);
        target.y = 1.0;
        via = chamber.clone().addScaledVector(f, 0.25).setY(0.85);
      }
      // contact at ~full leg length
      target.sub(hip).setLength(self.proportions.legLength * 0.96).add(hip);
      const root = self.model.scene.position.clone();
      const rel = (v: Vector3): V3 => {
        const d = v.clone().sub(root);
        return [d.dot(l), d.y, d.dot(f)];
      };
      const path = spline([
        [0, rel(foot)],
        [0.22, rel(chamber)],
        [0.34, rel(via)],
        [0.5, rel(target)],
        [0.74, rel(chamber)],
        [1.0, rel(foot)],
      ]);
      const [rise, hold, fall] = timing;
      return (t) => {
        const k = path((t - m.at) / (rise + hold + fall), new Vector3());
        const now = axes(self, m.side);
        const pos = self.model.scene.position.clone().addScaledVector(now.l, k.x).addScaledVector(now.f, k.z);
        pos.y = k.y;
        return pos;
      };
    },
  };
}

export const MOVES: Record<Kind, MoveType> = {
  jab: punch([0.16, 0.05, 0.24]),
  cross: punch([0.2, 0.06, 0.3]),
  // arrives from the outside
  hook: punch([0.24, 0.06, 0.3], (aim, w, self, side) => {
    const { l, sgn } = axes(self, side);
    return aim.clone().addScaledVector(l, sgn * 0.32 * (1 - w));
  }),
  // arrives from below
  uppercut: punch([0.24, 0.06, 0.3], (aim, w) => aim.clone().setY(aim.y - 0.35 * (1 - w))),
  body: punch([0.2, 0.06, 0.28]),
  frontKick: kick([0.1, 0.8, 0.14]),
  roundhouse: kick([0.1, 0.88, 0.14]),
  block: guard([0.12, 0.3, 0.25], (self, out) => eyesOf(self, out), 0.1, 0.13, 0.02),
  blockBody: guard([0.12, 0.35, 0.25], (self, out) => jointOf(self, 'chest', out), 0.13, 0.17, -0.02),
  parry: guard([0.1, 0.08, 0.22], (self, out) => jointOf(self, 'chest', out), -0.04, 0.36, 0.12),
  slip: evade([0.16, 0.16, 0.3], 0.15, 0.04, -0.08),
  duck: evade([0.2, 0.2, 0.32], 0, 0.08, -0.24),
  lean: evade([0.16, 0.18, 0.3], 0, -0.15, -0.02),
};

export const isKick = (k: Kind) => MOVES[k].limb === 'foot';
