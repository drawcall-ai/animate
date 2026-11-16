// A scripted walk and the planner that turns it into this frame's goals.

import { type Body, type Goal, type Pose, hard, mark, posture, soft, Target } from '@drawcall/ik'
import { Quaternion, Vector3 } from 'three'

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0)
const SIDES = ['L', 'R'] as const
interface Frame { position: Vector3; quaternion: Quaternion }
export interface Walk { pelvis: (t: number) => Frame; foot: (S: 'L' | 'R', t: number) => Frame; stride: number }

/** A walk along a path with the given heading(t): the pelvis bobs, sways and yaws; the feet step. */
export function makeWalk(heading: (t: number) => number, speed = 0.7, stride = 1.0): Walk {
  const H = 0.005, T0 = -2, STANCE = 0.62, table: Vector3[] = [new Vector3()] // path position, integrated numerically
  const raw = (t: number) => {
    const x = Math.max(0, (t - T0) / H), i = Math.floor(x)
    while (table.length < i + 2) {
      const a = heading(T0 + (table.length - 0.5) * H)
      table.push(table[table.length - 1].clone().add(new Vector3(speed * H * Math.sin(a), 0, speed * H * Math.cos(a))))
    }
    return table[i].clone().lerp(table[i + 1], x - i)
  }
  const origin = raw(0)
  const at = (t: number) => raw(t).sub(origin)
  const left = (t: number) => new Vector3(Math.cos(heading(t)), 0, -Math.sin(heading(t)))
  const yaw = (a: number) => new Quaternion().setFromAxisAngle(Y, a)
  const print = (k: number, off: number, s: number): Frame => { // k-th footprint: where the pelvis passes at mid-stance
    const t = (k + STANCE / 2 - off) * stride
    return { position: at(t).addScaledVector(left(t), 0.1 * s), quaternion: yaw(heading(t)) }
  }
  return {
    stride,
    pelvis: t => {
      const u = t / stride
      const bob = 0.945 + 0.02 * Math.cos(4 * Math.PI * (u - STANCE / 2)), sway = 0.015 * Math.sin(2 * Math.PI * (u - STANCE / 2))
      return { position: at(t).add(new Vector3(0, bob, 0)).addScaledVector(left(t), sway), quaternion: yaw(heading(t) + 0.08 * Math.sin(2 * Math.PI * u)) }
    },
    foot: (S, t) => {
      const off = S === 'L' ? 0 : 0.5, u = t / stride + off, k = Math.floor(u), phase = u - k
      const a = print(k, off, S === 'L' ? 1 : -1)
      if (phase < STANCE) return a
      const b = print(k + 1, off, S === 'L' ? 1 : -1), x = (phase - STANCE) / (1 - STANCE), e = x * x * (3 - 2 * x)
      return {
        position: a.position.lerp(b.position, e).add(new Vector3(0, 0.07 * Math.sin(Math.PI * x), 0)),
        quaternion: a.quaternion.slerp(b.quaternion, e).multiply(new Quaternion().setFromAxisAngle(X, 0.5 * Math.sin(Math.PI * x) * (1 - x))), // toes down after push-off
      }
    },
  }
}

/**
 * A locomotion planner as plain code: each frame it places its targets and returns this frame's goals. Pelvis and
 * feet are hard; the posture and balance are soft. The arm swing is a soft goal it only emits when told the arms
 * are free: nothing is dropped implicitly.
 */
export function createWalker(body: Body, walk: Walk) {
  const pelvis = new Target(), support = new Target()
  const feet = SIDES.map(S => ({ S, sole: body.get('sole' + S), target: new Target() }))
  const hands = SIDES.map(S => ({ s: S === 'L' ? 1 : -1, fist: body.get('fist' + S), spot: Object.assign(mark(body.get('pelvis'), 'swing' + S), { userData: { given: { position: true } } }) }))
  return (t: number, posturePose: Pose, armsFree: boolean): Goal[] => {
    pelvis.set(walk.pelvis(t))
    for (const f of feet) f.target.set(walk.foot(f.S, t))
    support.set({ position: body.positionOf(feet[0].sole).add(body.positionOf(feet[1].sole)).multiplyScalar(0.5), axes: new Vector3(1, 0, 1) })
    for (const h of hands) { // opposite to the same-side leg, as a marker on the pelvis: the goal is exact relative to it
      const c = -h.s * Math.cos((2 * Math.PI * t) / walk.stride)
      h.spot.position.set(0.25 * h.s, -0.17 + 0.03 * c, 0.05 + 0.2 * c)
    }
    return [
      hard(body.get('pelvis'), pelvis),
      ...feet.map(f => hard(f.sole, f.target)),
      ...(armsFree ? hands.map(h => soft(h.fist, h.spot, 0.5)) : []),
      posture(body, posturePose), soft(body.centre, support, 0.3),
    ]
  }
}
