import type { Body, Story, Thing } from '@drawcall/animate'
import { Vector3 } from 'three'
import { RACKET } from './racket'

export type Stroke = 'forehand' | 'backhand'

/** how fast the racket goes the way the ball is to go, and up, as the strings meet it (m/s) */
const SWING = { speed: 10, up: 1.5 }
/** how far up the strings face as they meet the ball, for it to rise over the net (of how far they face ahead) */
const OPEN = 0.1
/** how far he steps into it with the front foot (of his leg) */
const STEP = 0.6
/** the left hand through a stroke, from its shoulder: out ahead for a forehand, back for a backhand (of his arm) */
const LEFT: Record<Stroke, Vector3> = { forehand: new Vector3(0.65, -0.35, 0.5), backhand: new Vector3(0.6, -0.5, 0.1) }

/**
 * A right-hander's forehand or backhand with the `racket` bound to him, led by his right hand: the front foot steps into
 * it the way the ball is to go, `toward`, and the strings meet the ball `at` a place at the moment `time`, the racket
 * pointing out to his side, its face to where the ball is to go, a little open, and swinging through that way.
 * Tells whether the strings got there.
 */
export function* stroke(body: Body, racket: Thing, kind: Stroke, time: number, at: Vector3, toward: Vector3): Story<boolean> {
  const { arm, leg } = body.size
  const out = kind === 'forehand' ? 1 : -1
  const front = kind === 'forehand' ? 'left' : 'right'
  body.foot[front].to(body.ground(front, body.hips.value.addScaledVector(toward, STEP * leg)))
  body.hand.left.to(LEFT[kind].clone().multiplyScalar(arm), { on: body })
  // (a forehand meets it with the palm behind the handle, a backhand with the back of the hand)
  const pointing = new Vector3(-toward.z, 0, toward.x).multiplyScalar(out)
  const palm = toward.clone().setY(OPEN).multiplyScalar(out)
  const velocity = toward.clone().multiplyScalar(SWING.speed).setY(SWING.up)
  return yield* racket.by(time, at.clone().addScaledVector(pointing, -RACKET.strings), { velocity, pointing, palm })
}
