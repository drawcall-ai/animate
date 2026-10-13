import { Quaternion, Vector3 } from 'three';
import type { BonePoint, Ctx, Tier } from '@prohuman/body';
import { INDEX, type Side } from '../bones';
import { ankleFor, footRotation } from '../gait/foot';
import type { Humanoid } from '../humanoid';
import { poseLeg } from './legs';

/**
 * How stiffly a leg is posed (Hz): firmly (the body's own default pull is a soft 2 Hz). A
 * standing leg's pose puts the pelvis where the body is carried; much softer, it holds the centre
 * of mass off its target.
 */
export const LEG_STIFFNESS = 60;

const ORIGIN = new Vector3();
const _ankle = new Vector3();
const _rotation = new Quaternion();
const _toes = new Quaternion();

/** the ankle (the foot bone's origin): every foot contact holds it, so contacts on a foot are exclusive */
export const ankleOf = (side: Side): BonePoint => ({ bone: INDEX[`${side}Foot`], at: ORIGIN });

/** Who holds a foot, how firmly, and how much weight it bears. */
export interface Hold {
  priority: number;
  owner: string;
  /** how much of the body's weight it bears (0..1) */
  support: number;
  /**
   * how firmly the leg is posed (0..1, default 1): a leg posed from where its hip is now holds
   * the hip there (its joints' pull brakes them), so a standing leg's pose only hints at its
   * knee's way; a leg posed from where its hip is carried goes with it
   */
  pose?: number;
  /** the tier of the leg's pose that goes with it (default 'main'; a fallback's contact loses to a behaviour's, and its pose must yield too) */
  tier?: Tier;
}

/** The leg a foot is held on: its hip joint and the pelvis's turn as they are carried, and the body's facing. */
export interface Leg {
  pelvis: Quaternion;
  hip: Vector3;
  facing: number;
}

/** proposes foot `side` held with its ankle at `ankle`, turned `rotation` */
export function holdFoot<W>(ctx: Ctx<W>, side: Side, ankle: Vector3, rotation: Quaternion, hold: Hold) {
  ctx.propose.contact({ point: ankleOf(side), position: ankle, rotation, priority: hold.priority, support: hold.support, owner: hold.owner });
}

/**
 * Proposes foot `side` held at `ankle`, turned `rotation`, its toes `toes`, and the leg posed
 * down to it from `leg`.
 */
export function holdLeg<W>(ctx: Ctx<W>, h: Humanoid<W>, side: Side, ankle: Vector3, rotation: Quaternion, toes: Quaternion, leg: Leg, hold: Hold) {
  holdFoot(ctx, side, ankle, rotation, hold);
  poseLeg(ctx, h, side, leg.pelvis, leg.hip, ankle, rotation, toes, leg.facing, { weight: hold.pose ?? 1, tier: hold.tier, owner: hold.owner, stiffness: LEG_STIFFNESS });
}

/**
 * Proposes foot `side` planted where the status has it, rolled by `pitch` (+ toes up about the
 * heel, − heel up about the ball): bearing the body's weight.
 */
export function plant<W>(ctx: Ctx<W>, h: Humanoid<W>, side: Side, pitch: number, leg: Leg, hold: Omit<Hold, 'support'>) {
  const f = h.status.feet[side === 'left' ? 0 : 1];
  if (f.phase !== 'planted') throw new Error(`the ${side} foot is ${f.phase}, not planted`);
  ankleFor(h.proportions, side, f.position, f.yaw, pitch, _ankle);
  // (the toes in line with a foot on its heel, flat on the floor under one up on its ball)
  holdLeg(ctx, h, side, _ankle, footRotation(f.yaw, pitch, _rotation), footRotation(f.yaw, Math.max(0, pitch), _toes), leg, { ...hold, support: 1 });
}
