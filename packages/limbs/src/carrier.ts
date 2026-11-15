import type { Quaternion, Vector3 } from 'three'
import type { Goal } from './goal'
import type { Side } from './size'

/** how far he gets down for a hand or a foot to reach: the hips let down (m) and the trunk bent (rad), each from the moment that has it there in time, and until another */
export type Stoop = { low: number; bend: number; sinks: number; bends: number; until: number }

/**
 * What carries a limb, as its planner sees it: the rest of the body, looked ahead along as it is going. It tells where
 * a limb will start from and which way he will face, where a foot the body steps with will be and whether the body
 * spares it; it gets down for a limb to reach and winds up for a fast hand; and it is told when the story has a foot,
 * and where the body is to step with one. Whatever changes where he is going makes what was looked ahead `stale`.
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
  /** how long getting down as far as he can takes him (s) */
  readonly down: number
  /** he gets down for a foot or a hand of a side toward a place, to be down at a moment and until another, as little as has a limb that reaches so far reach it */
  stoop(end: 'foot' | 'hand', side: Side, span: number[], place: Vector3, reach: number): Stoop
  /** he is down for something until a moment */
  rise(stoop: Stoop, at: number): void
  /** the wind-up of the rest of the body for a hand that is to arrive fast: and how hard that pushes the trunk */
  readonly wind: {
    up(side: Side, sets: number, when: number, at: Vector3, moving: Vector3): { joint: Goal; times: number } | undefined
    off(side?: Side): void
  }
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
