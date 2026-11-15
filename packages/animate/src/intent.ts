import { Matrix4, type Object3D, Vector3 } from 'three'
import { type Foreseen, foresee } from '@drawcall/locomotion'
import { type Aim, both, type Mark, type Side, UP } from '@drawcall/limbs'
import type { Workings } from './clock'

/** how far ahead the hips and the feet are foreseen (in his beats) */
const AHEAD = 2.5

/** an end as it is and as it means to be: where it is now, whether a story has it, and its aim */
export type Meant = Aim & { at: Vector3; held: boolean }
/**
 * What he means to do and how far he has come, for whoever looks, in the scene and on the clock of `time`: each hand
 * and foot, the hips and the feet as foreseen, and where each thing he holds is meant to be and when: one he holds
 * now, one the body moves where the next place its leading hand is sent to has it, moved there, turned as it is, and
 * one moved from outside where it is.
 */
export type Intent = {
  time: number
  hand: Record<Side, Meant>
  foot: Record<Side, Meant>
  hips: Foreseen & { at: Vector3 }
  things: { thing: Object3D; at: Matrix4; time: number }[]
}

/** what he means to do, told when asked: nothing of it is kept or changes him */
export function intent({ bones, ends, mover, hips, size, bindings }: Workings, time: number): Intent {
  const scene = bones.frame.clone().invert()
  const out = (place: Vector3) => place.applyMatrix4(scene)
  const marks = <T extends Mark>(list: T[]) => {
    for (const { at } of list) out(at)
    return list
  }
  const meant = (kind: 'hand' | 'foot', side: Side): Meant => {
    const end = ends[kind][side]
    const { sent, path, tip } = end.aim()
    const turn = new Matrix4().extractRotation(scene)
    return { sent: marks(sent), path: marks(path), tip: tip.applyMatrix4(turn), at: out(end.value.clone()), held: end.held }
  }
  const seen = foresee(mover, AHEAD * size.beat)
  const top = seen.top && { asked: seen.top.asked && out(seen.top.asked), comes: seen.top.comes && marks([seen.top.comes])[0] }
  // (the ways he faces and goes, and is led, turned as the scene is from the frame of the body)
  const forward = new Vector3(0, 0, 1).transformDirection(scene)
  const yaw = Math.atan2(forward.x, forward.z)
  const led = seen.led && seen.led.clone().applyAxisAngle(UP, yaw)
  const ways = { facing: seen.facing + yaw, face: seen.face + yaw, heading: seen.heading + yaw, led }
  const things = new Map<Object3D, { at: Matrix4; time: number }>()
  for (const hand of Object.values(ends.hand)) {
    const give = hand.holding?.give
    if (give && !things.has(give.thing)) things.set(give.thing, { at: give.at(give.thing, 0, new Matrix4()).premultiply(scene), time })
  }
  const hand = both((side) => meant('hand', side))
  for (const { thing, hands, outside } of bindings.bound) {
    const leads = hand[hands[0]]
    const [next] = leads.sent
    thing.updateWorldMatrix(true, false)
    // (one moved from outside, or led nowhere, is meant to be where it is)
    if (outside || !next) {
      things.set(thing, { at: thing.matrixWorld.clone(), time })
      continue
    }
    const by = next.at.clone().sub(leads.at).sub(leads.tip)
    things.set(thing, { at: thing.matrixWorld.clone().premultiply(new Matrix4().makeTranslation(by)), time: next.time })
  }
  return {
    time,
    hand,
    foot: both((side) => meant('foot', side)),
    hips: {
      ...seen,
      ...ways,
      hips: marks(seen.hips),
      footfalls: marks(seen.footfalls),
      to: seen.to && out(seen.to),
      top,
      at: out(hips.value.clone()),
    },
    things: [...things].map(([thing, meant]) => ({ thing, ...meant })),
  }
}
