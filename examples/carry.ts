import { type Grip, grip, Hand, type Statement } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'

/**
 * A thing carried in a hand: gripped as stated and hung on the rig's hand bone. Gives how it sits in the hand and the
 * pose that holds it, which a body is told. Made of the rig at rest, before the body is.
 */
export function carry(rig: Object3D, side: 'left' | 'right', thing: Object3D, statement: Statement) {
  const hand = new Hand(rig, side)
  const held = grip(hand, thing, statement)
  hang(hand, thing, held)
  return held
}

/** Hangs a thing on a hand's bone where a grip has it sit, as large as it is drawn, leaving the fingers to the body. */
export function hang(hand: Hand, thing: Object3D, held: Grip) {
  const large = thing.getWorldScale(new Vector3()).x
  thing.position.copy(held.position)
  thing.quaternion.copy(held.quaternion)
  thing.scale.setScalar(large / hand.size())
  hand.bone.add(thing)
}
