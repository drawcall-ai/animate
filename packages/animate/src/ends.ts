import type { Arriving, Bindings, End, Grip, Reaching, Story, Xyz } from '@drawcall/limbs'
import { Object3D, Quaternion, Vector3 } from 'three'
import type { Body } from './body'

/** a place counted `on` him, from where the limb starts and as he faces, or on a thing, in its frame as it moves */
export type On = { on?: Object3D | Body }

/**
 * What a story has of a hand: where its wrist is and how it moves, whether it is where it was sent, and to send it
 * somewhere, have it somewhere by a moment, pose its fingers, or give it back to the body.
 */
export type Hand = Readonly<
  Pick<End, 'value' | 'velocity' | 'there' | 'shape' | 'free'> & {
    to(place: Xyz | Grip, how?: Reaching & On & { seconds?: number }): Story<boolean>
    by(when: number, place: Xyz | Grip, how?: Reaching & On): Story<boolean>
    /** going away: `body.bind(grip.target).on(hand, grip)` */
    take(grip: Grip, how?: { turning?: boolean }): void
    /** going away: `thing.free()` or `thing.off(hand)` */
    letGo(): Vector3
  }
>
/** What a story has of a foot: where its ankle is and how it moves, where the ground holds it, if it does, and to send it somewhere, have it somewhere by a moment, or give it back to the body. */
export type Foot = Readonly<Pick<End, 'value' | 'velocity' | 'anchor' | 'free'>> & {
  to(place: Xyz, arriving?: Arriving & On & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, arriving?: Arriving & On): Story<boolean>
}
/**
 * how a thing is sent: as a hand is, its place and velocity its origin's, `pointing` the way its z goes, and `palm` the
 * way the palm of the hand leading it faces, all counted as its place is
 */
export type Sending = Arriving & On & { pointing?: Xyz; palm?: Xyz }

/**
 * What a story or a game has of a thing bound to him: hands go `on` it by grips and come `off` it; it is sent
 * somewhere, or to be somewhere by a moment, as a hand is, and the hands come with it; whether every hand on it is where
 * it is to be; how fast it moves; and `free` lets it go, telling how fast it was moving.
 */
export type Thing = Readonly<{
  on(hand: Hand, grip: Grip, how?: { turning?: boolean }): void
  off(hand: Hand): void
  to(place: Xyz, how?: Sending & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, how?: Sending): Story<boolean>
  readonly there: boolean
  readonly velocity: Vector3
  free(): Vector3
}>

/** what the facades of the hands and things need of the body: its ends behind its hands, its bindings and clock, and the turn of a frame places are counted in */
export type Binder = {
  bindings: Bindings
  clock: { time: number }
  end(hand: Hand): End
  /** what turns a way counted as a place `on` him, on a thing or in the scene into the frame of the body */
  ways(on?: Object3D | Body): Quaternion
}

/** a story over at once that came to nothing */
function* nothing(): Story<boolean> {
  return false
}

/** the hand a story has of an end */
export function hand(end: End, binder: Binder): Hand {
  const { bindings, clock } = binder
  // (a hand sent onto a thing follows it, which it may not if it leads the thing)
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
      bindings.bind(grip.target, false, clock.time)
      bindings.on(grip.target, end, grip, turning, clock.time)
      void end.shape(grip.pose)
    },
    letGo() {
      const bound = bindings.bound.find(({ hands }) => hands.includes(end.side))
      if (!bound) throw new Error(`the ${end.name} lets go, and nothing is bound to it`)
      if (bound.hands.length > 1) {
        bindings.off(bound.thing, end, clock.time)
        return bindings.velocity(bound.thing)
      }
      return bindings.free(bound.thing)
    },
  }
}

/** the thing a story or a game has of something bound to him, moved by the body or from `outside` */
export function thing(object: Object3D, outside: boolean, binder: Binder): Thing {
  const { bindings, clock } = binder
  bindings.bind(object, outside, clock.time)
  /** sends the hand leading it, with its grip, for the thing to be there: turning it by the hand, or on its own */
  const send = (go: (end: End, how: Reaching) => Story<boolean>, { pointing, palm, ...how }: Sending) => {
    const lead = bindings.lead(object)
    if (!lead) return nothing()
    const { hand: end, grip, turning } = lead
    if (turning) return go(end, { ...how, pointing, palm, with: grip })
    const story = go(end, { ...how, palm, with: grip })
    const last = end.last
    if (pointing && last) {
      const way = new Vector3().copy(pointing).applyQuaternion(binder.ways(how.on)).normalize()
      const now = bindings.turned(object)
      const to = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1).applyQuaternion(now), way).multiply(now)
      bindings.turn(object, to, last.leaves, last.when)
    }
    return story
  }
  return {
    on(hand, grip, { turning = true } = {}) {
      const end = binder.end(hand)
      // (freed, it is bound again)
      bindings.bind(object, outside, clock.time)
      bindings.on(object, end, grip, turning, clock.time)
      void end.shape(grip.pose)
    },
    off: (hand) => bindings.off(object, binder.end(hand), clock.time),
    to: (place, { seconds, ...how } = {}) => send((end, reaching) => end.to(place, { ...reaching, seconds }), how),
    by: (when, place, how = {}) => send((end, reaching) => end.by(when, place, reaching), how),
    get there() {
      return bindings.there(object)
    },
    get velocity() {
      return bindings.velocity(object)
    },
    free: () => bindings.free(object),
  }
}
