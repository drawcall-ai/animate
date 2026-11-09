import { Quaternion, Vector3 } from 'three';
import { INDEX, SIDES, type Side } from '../anatomy/bones';
import { quatYXZ } from '../../kernel/math';
import type { Proportions } from '../anatomy/proportions';
import { KNEE_FLEXION } from '../anatomy/ranges';
import { shankTilt } from './leg';
import type { Feet } from '../../step/types';

/** half a foot's width at the toes (m, default body): how far past the ankle's line a foot holds the body sideways */
const FOOT_HALF_WIDTH = 0.04;

/** the heel (on the sole) in the foot bone's frame */
export const heelOf = (proportions: Proportions, out = new Vector3()) => out.copy(proportions.sole.heel);
/** the heel's two sides (on the sole) in the foot bone's frame: a sole supports as wide as its heel, not its heel's middle alone */
export const heelSides = (proportions: Proportions): Vector3[] =>
  [-1, 1].map((side) => heelOf(proportions).setX(proportions.sole.heel.x + side * HEEL * proportions.height));
/** Recalled (adult anthropometry: heel breadth ~6–7 cm at 1.75 m): half a heel's width (× height) */
const HEEL = 0.019;
/** the ball of the foot (the toes bone's origin) in the foot bone's frame */
export const ballOf = (proportions: Proportions, side: Side, out = new Vector3()) => out.copy(proportions.offsets[`${side}Toes`]);
/** a foot heading `yaw`, pitched by `pitch` (+ toes up, − heel up), as a world rotation */
export const footRotation = (yaw: number, pitch: number, out = new Quaternion()) => quatYXZ(yaw, -pitch, 0, out);

/**
 * The ankle of a foot standing flat with its ankle at `anchor`, heading `yaw`, rolled by `pitch`
 * about its heel (pitch > 0, toes up) or its ball (pitch < 0, heel up).
 */
export function ankleFor(proportions: Proportions, side: Side, anchor: Readonly<Vector3>, yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const local = pitch >= 0 ? heelOf(proportions, _pivot) : ballOf(proportions, side, _pivot);
  const world = _world.copy(local).applyQuaternion(footRotation(yaw, 0, _q)).add(anchor);
  return out.copy(local).applyQuaternion(footRotation(yaw, pitch, _q)).negate().add(world);
}

/** the corners of a flat foot's footprint on the floor (x, z): the heel, the toe edge's two ends */
export function footprint(proportions: Proportions, ankle: Readonly<Vector3>, yaw: number): [number, number][] {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), w = FOOT_HALF_WIDTH * proportions.scale;
  return [
    [ankle.x - fx * proportions.heelBack, ankle.z - fz * proportions.heelBack],
    [ankle.x + fx * proportions.toeFront + fz * w, ankle.z + fz * proportions.toeFront - fx * w],
    [ankle.x + fx * proportions.toeFront - fz * w, ankle.z + fz * proportions.toeFront + fx * w],
  ];
}

const _pivot = new Vector3(), _world = new Vector3(), _q = new Quaternion();

/** A person's feet, as the stepper reads them. */
export function personFeet(proportions: Proportions): Feet {
  const soles = SIDES.map((side, i) => [heelOf(proportions), ...[proportions.sole.bigToe, proportions.sole.smallToe]
    .map((tip) => tip.clone().setX(tip.x * (i === 0 ? 1 : -1)).add(ballOf(proportions, side)))]);
  return {
    hip: proportions.hipHalfWidth, length: proportions.legLength, thigh: proportions.thigh, shin: proportions.shin,
    fold: KNEE_FLEXION * Math.PI / 180, ankleHeight: proportions.ankleHeight, rotation: footRotation,
    legs: SIDES.map((side, i) => ({
      sign: i === 0 ? 1 : -1, foot: INDEX[`${side}Foot`], toes: INDEX[`${side}Toes`], top: INDEX[`${side}UpperLeg`], up: proportions.offsets[`${side}UpperLeg`].y,
    })),
    ankle: (i, anchor, yaw, pitch, out) => ankleFor(proportions, SIDES[i], anchor, yaw, pitch, out),
    lean: (i, pose, yaw) => shankTilt(pose, SIDES[i], yaw),
    print: (i, anchor, yaw) => soles[i].map((point): [number, number] => {
      const at = point.clone().applyQuaternion(footRotation(yaw, 0)).add(anchor);
      return [at.x, at.z];
    }),
    soles: (i, ankle, foot, toes) => {
      const ball = ballOf(proportions, SIDES[i], _b).applyQuaternion(foot).add(ankle);
      const sign = i === 0 ? 1 : -1;
      const heel = heelOf(proportions).applyQuaternion(foot).add(ankle);
      return [heel, ...[proportions.sole.bigToe, proportions.sole.smallToe].map((tip) => tip.clone().setX(tip.x * sign).applyQuaternion(toes).add(ball))];
    },
  };
}

/**
 * A followed root's feet pivot, turning faster than they step — spun on the end that swings the other away from the other foot: turning
 * in toward it on its ball, the heel swinging out; turning out from it on its heel, the toes swinging out: spun on its ball, the foot
 * inside a quick turn swung its heel in under the other foot's landing. A walker's planner turns it no faster than its feet step.
 */
export function pivotingFeet(proportions: Proportions, feet: Feet): Feet {
  return {
    ...feet,
    turnAbout: (i, anchor, from, to) => {
      const end = (to - from) * feet.legs[i].sign < 0 ? ballOf(proportions, SIDES[i], _b) : heelOf(proportions, _b);
      end.setY(0);
      anchor.add(_v.copy(end).applyQuaternion(footRotation(from, 0))).sub(end.applyQuaternion(footRotation(to, 0)));
    },
  };
}

const _b = new Vector3(), _v = new Vector3();
