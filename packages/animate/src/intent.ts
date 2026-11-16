import { Matrix4, type Vector3 } from 'three'
import type { Channel } from '@drawcall/plan'
import { SIDES } from '@drawcall/gait'
import type { Workings } from './clock'

/** what a channel means to do: its frames to come, its way ahead, the frames cancelled lately, what it is bound to */
export type Planned = ReturnType<Channel['intent']>
/**
 * What he means to do and how far he has come, for whoever looks, in the scene and on the clock of `time`: each
 * hand, foot and thing he holds as the plan has it, and how far each limb the story has is from where its plan has it.
 * The hips and the feet are the gait's own `intent()`.
 */
export type Intent = {
  time: number
  channels: Planned[]
  gaps: { name: string; planned: Vector3; posed: Vector3 }[]
}

/** what he means to do, told when asked: nothing of it is kept or changes him */
export function intent({ bones, ends, things }: Workings, time: number): Intent {
  const scene = bones.frame.clone().invert()
  const turn = new Matrix4().extractRotation(scene)
  const out = (place: Vector3) => place.applyMatrix4(scene)
  const told = (channel: Channel): Planned => {
    const planned = channel.intent()
    const frame = <T extends { place: Vector3; velocity: Vector3 }>(one: T) => ({ ...one, place: out(one.place), velocity: one.velocity.applyMatrix4(turn) })
    return { ...planned, now: out(planned.now), path: planned.path.map(out), frames: planned.frames.map(frame), dropped: planned.dropped.map(frame) }
  }
  const all = SIDES.flatMap((side) => [ends.hand[side], ends.foot[side]])
  const channels = [...all.filter((end) => end.channel.busy || end.channel.holding).map((end) => end.channel), ...[...things.values()].filter((one) => !one.outside).map((one) => one.channel)]
  const gaps = all.filter((end) => end.held).map((end) => ({ name: end.name, planned: out(end.channel.value.clone()), posed: out((end.kind === 'hand' ? bones.wrist : bones.ankle)[end.side].clone()) }))
  return { time, channels: channels.map(told), gaps }
}
