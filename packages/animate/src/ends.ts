import type { Arriving, End, Grip, Reaching, Story, Xyz } from '@drawcall/limbs'
import type { Object3D } from 'three'
import type { Body } from './body'

/** a place counted `on` him, from where the limb starts and as he faces, or on a thing, in its frame as it moves */
export type On = { on?: Object3D | Body }

/** What a story has of a hand: where its wrist is and how it moves, whether it is where it was sent, and to send it somewhere, have it somewhere by a moment, pose its fingers, or give it back to the body. */
export type Hand = Readonly<
  Pick<End, 'value' | 'velocity' | 'there' | 'shape' | 'free'> & {
    to(place: Xyz | Grip, how?: Reaching & On & { seconds?: number }): Story<boolean>
    by(when: number, place: Xyz | Grip, how?: Reaching & On): Story<boolean>
  }
>
/** What a story has of a foot: where its ankle is and how it moves, where the ground holds it, if it does, and to send it somewhere, have it somewhere by a moment, or give it back to the body. */
export type Foot = Readonly<Pick<End, 'value' | 'velocity' | 'anchor' | 'free'>> & {
  to(place: Xyz, arriving?: Arriving & On & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, arriving?: Arriving & On): Story<boolean>
}
