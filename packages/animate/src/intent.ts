import { Matrix4, Vector3 } from 'three'
import type { Foreseen, Mark } from './stride'
import type { Channel } from '@drawcall/plan'
import { parts, SIDES, UP } from '@drawcall/limbs'
import type { Workings } from './clock'

/** how far ahead the hips and the feet are foreseen (in his beats) */
const AHEAD = 2.5

/** what a channel means to do: its frames to come, its way ahead, the frames cancelled lately, what it is bound to */
export type Planned = ReturnType<Channel['intent']>
/**
 * What he means to do and how far he has come, for whoever looks, in the scene and on the clock of `time`: each
 * hand, foot and thing he holds as the plan has it; how far each limb the story has is from where its plan has it,
 * and which joints are at the end of their range; and the hips and the feet as foreseen.
 */
export type Intent = {
  time: number
  channels: Planned[]
  gaps: { name: string; planned: Vector3; posed: Vector3 }[]
  stopped: string[]
  hips: Foreseen & { at: Vector3 }
}

/** what he means to do, told when asked: nothing of it is kept or changes him */
export function intent({ bones, ends, locomotion, size, things, joints }: Workings, time: number): Intent {
  const scene = bones.frame.clone().invert()
  const turn = new Matrix4().extractRotation(scene)
  const out = (place: Vector3) => place.applyMatrix4(scene)
  const marks = <T extends Mark>(list: T[]) => {
    for (const { at } of list) out(at)
    return list
  }
  const told = (channel: Channel): Planned => {
    const planned = channel.intent()
    const frame = <T extends { place: Vector3; velocity: Vector3 }>(one: T) => ({ ...one, place: out(one.place), velocity: one.velocity.applyMatrix4(turn) })
    return { ...planned, now: out(planned.now), path: planned.path.map(out), frames: planned.frames.map(frame), dropped: planned.dropped.map(frame) }
  }
  const all = SIDES.flatMap((side) => [ends.hand[side], ends.foot[side]])
  const channels = [...all.filter((end) => end.channel.busy || end.channel.holding).map((end) => end.channel), ...[...things.values()].filter((one) => !one.outside).map((one) => one.channel)]
  const gaps = all.filter((end) => end.held).map((end) => ({ name: end.name, planned: out(end.channel.value.clone()), posed: out((end.kind === 'hand' ? bones.wrist : bones.ankle)[end.side].clone()) }))
  const stopped = parts(joints).filter((part) =>
    (['x', 'y', 'z'] as const).some((axis) => {
      const [least, most] = part.range[axis] ?? [-Infinity, Infinity]
      return most > least && (part.value[axis] <= least + 1e-3 || part.value[axis] >= most - 1e-3)
    }),
  )
  const seen = locomotion.foresee(AHEAD * size.beat)
  const top = seen.top && { asked: seen.top.asked && out(seen.top.asked), comes: seen.top.comes && marks([seen.top.comes])[0] }
  // (the ways he faces and goes, and is led, turned as the scene is from the frame of the body)
  const forward = new Vector3(0, 0, 1).transformDirection(scene)
  const yaw = Math.atan2(forward.x, forward.z)
  const led = seen.led && seen.led.clone().applyAxisAngle(UP, yaw)
  const ways = { facing: seen.facing + yaw, face: seen.face + yaw, heading: seen.heading + yaw, led }
  return {
    time,
    channels: channels.map(told),
    gaps,
    stopped: stopped.map((part) => part.name),
    hips: { ...seen, ...ways, hips: marks(seen.hips), footfalls: marks(seen.footfalls), to: seen.to && out(seen.to), top, at: out(locomotion.hips.value.clone()) },
  }
}
