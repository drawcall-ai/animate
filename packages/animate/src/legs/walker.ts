import { wrapAngle } from '../kernel/math';

/** the way a body's feet face, on average (rad about +Y), as its root faces `rootYaw`: each foot's yaw less its toe-out (`toeOut`, rad) */
export function stanceYaw(legs: readonly { yaw: number; sign: 1 | -1 }[], rootYaw: number, toeOut = 0): number {
  return legs.reduce((sum, leg) => sum + wrapAngle(leg.yaw - leg.sign * toeOut - rootYaw), 0) / legs.length + rootYaw;
}

/** whether a goal `heading` away (rad) is off the way a root facing `rootYaw` goes: it turns to it first, facing it till it is on its way */
export const offTheWay = (heading: number, rootYaw: number) => Math.abs(wrapAngle(heading - rootYaw)) >= Math.PI / 4;
