import type { Arriving, Bindings, End, Grip, Reaching, Story, Xyz } from '@drawcall/limbs'
import { Object3D, type Vector3 } from 'three'
import type { Body } from './body'

/** a place counted `on` him, from where the limb starts and as he faces, or on a thing, in its frame as it moves */
export type On = { on?: Object3D | Body }

/**
 * What a story has of a hand: where its wrist is and how it moves, whether it is where it was sent, and to send it
 * somewhere, have it somewhere by a moment, pose its fingers, or give it back to the body; and to take a thing, which
 * goes with it from then on, and let go of it.
 */
export type Hand = Readonly<
  Pick<End, 'value' | 'velocity' | 'there' | 'shape' | 'free'> & {
    to(place: Xyz | Grip, how?: Reaching & On & { seconds?: number }): Story<boolean>
    by(when: number, place: Xyz | Grip, how?: Reaching & On): Story<boolean>
    take(grip: Grip, how?: { turning?: boolean }): void
    letGo(): Vector3
  }
>
/** What a story has of a foot: where its ankle is and how it moves, where the ground holds it, if it does, and to send it somewhere, have it somewhere by a moment, or give it back to the body. */
export type Foot = Readonly<Pick<End, 'value' | 'velocity' | 'anchor' | 'free'>> & {
  to(place: Xyz, arriving?: Arriving & On & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, arriving?: Arriving & On): Story<boolean>
}

/** the hand a story has of an end, which takes and lets go of things through the body's `bindings`, on his clock */
export function hand(end: End, bindings: Bindings, clock: { time: number }): Hand {
  // (a hand sent onto a thing follows it, which it may not if the thing goes with it)
  const onto = (place: Xyz | Grip, on?: object) => {
    const thing = 'target' in place ? place.target : on
    if (thing instanceof Object3D) bindings.follow(end, thing)
  }
  return {
    value: end.value,
    velocity: end.velocity,
    get there() {
      return end.there
    },
    to(place, how = {}) {
      onto(place, how.on)
      return end.to(place, how)
    },
    by(when, place, how = {}) {
      onto(place, how.on)
      return end.by(when, place, how)
    },
    shape: (pose, how) => end.shape(pose, how),
    free: () => end.free(),
    take(grip, { turning = true } = {}) {
      bindings.take(end, grip, turning, clock.time)
      void end.shape(grip.pose)
    },
    letGo: () => bindings.letGo(end, clock.time),
  }
}
