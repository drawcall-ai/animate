import { type Object3D, Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import type { Bones } from './bones'
import { Give, type Holder, type Seat } from './give'
import type { Side } from './size'

const turn = new Quaternion()

/** a hand as what it holds sees it: what gives way to it, whether it holds that, which side it is on, and the point of it that rests in its shoulder, if one does */
type Hand = Holder & { gives?: Give; there: boolean; side: Side; rests?: Vector3 }
/** the place he looks at, in the scene, and the point of a thing he looks over at it */
type Look = { place?: Vector3; over?: { on: Object3D; at: Vector3 } }

/**
 * The things that give way to his hands: one for each thing, so that both hands on one have it give way to both; and
 * the pocket of each shoulder that a point of one rests in, from its joint, he upright. Which give way is told anew
 * from the hands each time it is asked, as a hand may be sent elsewhere within a step.
 */
export class Gives {
  private readonly all = new Map<Object3D, Give>()

  constructor(
    private readonly bones: Bones,
    private readonly ahead: Ahead,
    private readonly pockets: Record<Side, Vector3>,
  ) {}

  /** what gives way to the hands that hold a thing */
  of(thing: Object3D) {
    const { ahead } = this
    const found =
      this.all.get(thing) ??
      new Give(thing, this.bones, (seconds, to) =>
        to.makeRotationY(ahead.facing(seconds)).setPosition(ahead.hips(seconds, new Vector3(), new Vector3())),
      )
    this.all.set(thing, found)
    return found
  }

  private held(hands: Hand[]) {
    return new Set(hands.flatMap(({ gives }) => gives ?? []))
  }

  /** at the first step of an update: what gives way is looked at as it was last set, not as it was last written */
  begin(hands: Hand[]) {
    for (const give of this.held(hands)) give.begin()
  }

  /** where what a hand holds rests in the pocket of its shoulder `seconds` from now, if it does */
  private seat({ rests, side }: Hand, seconds: number): Seat | undefined {
    if (!rests) return undefined
    const pocket = this.ahead
      .shoulder(side, seconds, new Vector3(), turn)
      .add(this.pockets[side].clone().applyQuaternion(turn))
    return { at: rests, pocket, side }
  }

  /**
   * before a step of so many `seconds`: each is moved for the hands on it to reach it and out of him, and looked over at
   * the place he looks, if it is. Tells how his head is to be turned against the trunk to have his eye on that line
   */
  correct(hands: Hand[], seconds: number, { place, over }: Look) {
    for (const give of this.held(hands)) {
      const sighted = place && over?.on === give.thing
      give.sight = sighted ? { over: over.at, place: place.clone().applyMatrix4(this.bones.frame) } : undefined
      const on = hands.filter(({ gives }) => gives === give)
      const [seat] = on.flatMap((hand) => this.seat(hand, seconds) ?? [])
      give.correct(on, seconds, seat)
    }
    const { aimed } = [...this.held(hands)].find((give) => give.aimed) ?? {}
    return aimed && this.bones.sighting(aimed.side, aimed.through, aimed.way)
  }

  /** after a step of so many `seconds`: each is where the hands that hold it have it */
  write(hands: Hand[], seconds: number) {
    for (const give of this.held(hands)) {
      const holding = hands.filter(({ gives, there }) => gives === give && there)
      give.write(
        holding,
        seconds,
        holding.some(({ rests }) => rests !== undefined),
      )
    }
  }
}
