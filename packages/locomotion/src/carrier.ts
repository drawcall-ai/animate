import type { Quaternion, Vector3 } from 'three'
import type { Side } from '@drawcall/limbs'
import type { Ahead } from './ahead'
import type { Mover } from './mover'

/**
 * The hips and the feet as the rest of the body asks about them, looked ahead along as he is going: where a limb will
 * start from and which way he will face, where a foot the body steps with will be and whether it spares it; told when
 * a story has a foot, and where the body is to step with one. Whatever changes where he is going makes what was looked
 * ahead `stale`.
 */
export type Carrier = {
  /** the moment it is now, on his clock (s) */
  readonly now: number
  /** where the hips, a hip or a shoulder will be `seconds` from now, in the frame of the body, and how that is turned */
  hips(seconds: number, value: Vector3, velocity: Vector3): Vector3
  hip(side: Side, seconds: number, at: Vector3, turned: Quaternion): Vector3
  shoulder(side: Side, seconds: number, at: Vector3, turned: Quaternion): Vector3
  /** which way he will face `seconds` from now (rad about y, from +z toward +x) */
  facing(seconds: number): number
  /** where the ankle of a foot the body steps with will be `seconds` from now */
  stepped(side: Side, seconds: number, at: Vector3): Vector3
  /** whether the body spares a foot from `seconds` from now until `until` seconds from now */
  spare(side: Side, seconds: number, until: number): boolean
  stale(from?: number): void
  /** the story has a foot from a moment until another, or with none, has it no longer */
  take(side: Side, span: { from: number; until: number } | undefined): void
  /** how high the ground is that he stands on */
  readonly ground: number
  /** the body steps with a foot to a place it stands on, in so many `seconds` or as soon as it can, and stands over it there, or with none keeps it there no longer: where it is to stand so, if it is */
  put(side: Side, place?: Vector3, seconds?: number): Vector3 | undefined
  /** a foot the body steps with, as it is now: where it is to stand, whether it is down, and where it is */
  foot(side: Side): { readonly put?: Vector3; readonly down: boolean; readonly at: Vector3 }
  /** whether he is in the air and coming down */
  readonly landing: boolean
}

/** a foot as the rest of the body has it: whether a story has it, where its ankle is, where the ground holds it, and to give it back to the body */
export type Foothold = { readonly held: boolean; readonly value: Vector3; anchor?: Vector3; free(): void }

/** the hips and the feet, looked ahead along, as what carries the limbs: what their planner asks of the rest of the body */
export const carrier = (mover: Mover, ahead: Ahead): Carrier => ({
  get now() {
    return ahead.now
  },
  hips: (seconds, value, velocity) => ahead.hips(seconds, value, velocity),
  hip: (side, seconds, at, turned) => ahead.hip(side, seconds, at, turned),
  shoulder: (side, seconds, at, turned) => ahead.shoulder(side, seconds, at, turned),
  facing: (seconds) => ahead.facing(seconds),
  stepped: (side, seconds, at) => ahead.stepped(side, seconds, at),
  spare: (side, seconds, until) => ahead.spare(side, seconds, until),
  stale: (from) => ahead.stale(from),
  take(side, span) {
    mover.foot[side].taken = span
  },
  get ground() {
    return mover.origin.y
  },
  put(side, place, seconds) {
    mover.put(side, place, seconds)
    return mover.foot[side].put
  },
  foot: (side) => mover.foot[side],
  get landing() {
    return mover.falls && mover.velocity.y <= 0
  },
})
