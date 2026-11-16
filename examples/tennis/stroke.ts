import type { Body, Story, Thing } from '@drawcall/animate'
import { Vector3 } from 'three'
import { RACKET } from './racket'

export type Stroke = 'forehand' | 'backhand'

/** how fast the racket goes the way the ball is to go, and up, as the strings meet it (m/s) */
const SWING = { speed: 10, up: 1.5 }
/** how far up the strings face as they meet the ball, for it to rise over the net (of how far they face ahead) */
const OPEN = 0.1
/** how far he steps into it with the front foot (of his leg), and how much of his arm he reaches without stretching */
const REACH = 0.9
const STEP = 0.6
/** how far the shoulders turn away from the ball as he takes the racket back, and on through it after the strings meet it (rad), and how long before they meet it they start through (s) */
const TURN = { back: 0.8, through: 0.6, before: 0.25 }
/** the left hand through a stroke, from its shoulder: out ahead for a forehand, back for a backhand (of his arm) */
const LEFT: Record<Stroke, Vector3> = { forehand: new Vector3(0.65, -0.35, 0.5), backhand: new Vector3(0.6, -0.5, 0.1) }

/**
 * A right-hander's forehand or backhand with the `racket` bound to him, led by his right hand: the front foot steps into
 * it the way the ball is to go, `toward`, and the strings meet the ball `at` a place at the moment `time`, the racket
 * pointing out to his side, its face to where the ball is to go, a little open, and swinging through that way; the
 * shoulders turn away as he takes it back and turn through the ball.
 * Tells whether the strings got there.
 */
export function* stroke(body: Body, racket: Thing, kind: Stroke, time: number, at: Vector3, toward: Vector3): Story<boolean> {
  const { arm, leg } = body.size
  const out = kind === 'forehand' ? 1 : -1
  const front = kind === 'forehand' ? 'left' : 'right'
  // (and out toward the ball as far as brings it within the racket's reach of the shoulder it swings from, the hips going half as far)
  const shoulder = body.shoulder('right').setY(0)
  const off = at.clone().setY(0).sub(shoulder)
  const short = Math.max(0, off.length() - REACH * arm - RACKET.strings)
  body.foot[front].to(body.ground(front, body.hips.value.addScaledVector(toward, STEP * leg).addScaledVector(off.normalize(), 2 * short)))
  body.hand.left.to(LEFT[kind].clone().multiplyScalar(arm), { on: body })
  // the shoulders turn away as the racket goes back, the racket shoulder leading for a backhand, and turn through the ball
  body.play(
    (function* () {
      yield* body.trunk.to({ x: 0, y: -out * TURN.back, z: 0 })
      yield* body.until(time - TURN.before)
      yield* body.trunk.to({ x: 0, y: out * TURN.through, z: 0 }, { seconds: TURN.before * 2 })
    })(),
  )
  // (a forehand meets it with the palm behind the handle, a backhand with the back of the hand)
  const pointing = new Vector3(-toward.z, 0, toward.x).multiplyScalar(out)
  const palm = toward.clone().setY(OPEN).multiplyScalar(out)
  const velocity = toward.clone().multiplyScalar(SWING.speed).setY(SWING.up)
  return yield* racket.by(time, at.clone().addScaledVector(pointing, -RACKET.strings), { velocity, pointing, palm })
}
