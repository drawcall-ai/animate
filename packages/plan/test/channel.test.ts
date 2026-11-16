import { Quaternion, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { Channel, type Frame } from '../src'

const DT = 1 / 120
/** steps channels on to a moment, in order, telling each step's time to `seen` */
function run(channels: Channel[], from: number, to: number, seen?: (t: number) => void) {
  for (let t = from + DT; t <= to + 1e-9; t += DT) {
    for (const channel of channels) channel.advance(t)
    seen?.(t)
  }
  return to
}

test('a fast arrival draws back first, arrives as asked, and swings on to rest the way it was going', () => {
  const hand = new Channel('hand', 70, 0.3)
  hand.set({ x: 0, y: 1, z: 0 })
  hand.by({ at: 1, place: { x: 0, y: 1.5, z: 0.4 }, velocity: { x: 0, y: 0, z: 6 } })
  let back = 0
  run([hand], 0, 1, () => (back = Math.min(back, hand.value.z)))
  expect(back).toBeLessThan(-0.03)
  expect(back).toBeGreaterThan(-0.31)
  expect(hand.value.distanceTo(new Vector3(0, 1.5, 0.4))).toBeLessThan(0.02)
  expect(hand.velocity.z).toBeCloseTo(6, 0)
  run([hand], 1, 2)
  expect(hand.velocity.length()).toBeLessThan(1e-3)
  expect(hand.value.z).toBeGreaterThan(0.6)
  expect(hand.owner).toBe('on')
})

test('cancelled and sent elsewhere, it goes on from the state it is in, with no jump in place or velocity', () => {
  const hand = new Channel('hand', 70, 0.3)
  hand.set({ x: 0, y: 1, z: 0 })
  hand.by({ at: 1, place: { x: 0, y: 1.5, z: 0.4 }, velocity: { x: 0, y: 0, z: 6 } })
  run([hand], 0, 0.8)
  const [place, velocity] = [hand.value.clone(), hand.velocity.clone()]
  hand.cancel()
  hand.by({ at: 1.3, place: { x: 0.3, y: 1.1, z: 0.4 } })
  run([hand], 0.8, 0.8 + DT)
  expect(hand.value.distanceTo(place)).toBeLessThan(velocity.length() * DT * 1.5 + 1e-3)
  expect(hand.velocity.distanceTo(velocity)).toBeLessThan(70 * DT * 2)
  run([hand], 0.8 + DT, 1.4)
  expect(hand.value.distanceTo(new Vector3(0.3, 1.1, 0.4))).toBeLessThan(0.01)
  expect(hand.intent().dropped.length).toBe(1)
})

test('a frame it cannot meet it meets as near as it can, slower at the moment asked, and says so', () => {
  const foot = new Channel('foot', 120, 0.2)
  foot.set({ x: 0, y: 0, z: 0 })
  foot.by({ at: 0.2, place: { x: 0, y: 0, z: 0.5 }, velocity: { x: 0, y: 0, z: 20 } })
  run([foot], 0, 0.2 + DT)
  expect(foot.short.slow).toBeGreaterThan(0.2)
  expect(foot.short.late).toBe(0)
})

test('a frame with no moment is met as soon as it can be at its ease', () => {
  const hand = new Channel('hand', 70, 0.3)
  hand.set({ x: 0, y: 1, z: 0 })
  const frame = hand.by({ place: { x: 0, y: 1, z: 0.5 } })
  let met = 0
  run([hand], 0, 2, (t) => (met ||= hand.frames.includes(frame) ? 0 : t))
  expect(met).toBeGreaterThan(0.2)
  expect(met).toBeLessThan(0.8)
})

test('bound, it goes with what it is bound to, and frames written to it move that; unbound, it keeps its velocity', () => {
  const ball = new Channel('ball', 70, 0.3)
  const hand = new Channel('hand', 70, 0.3)
  ball.set({ x: 0, y: 1, z: 0 })
  hand.set({ x: 0, y: 0.9, z: 0 })
  hand.bind(ball)
  expect(hand.owner).toBe('ball')
  ball.by({ at: 0.5, place: { x: 0, y: 2, z: 0.5 }, velocity: { x: 0, y: 4, z: 3 } })
  run([ball, hand], 0, 0.5)
  expect(hand.value.distanceTo(new Vector3(0, 1.9, 0.5))).toBeLessThan(0.02)
  ball.outside = true
  hand.unbind()
  const velocity = hand.velocity.clone()
  expect(velocity.y).toBeCloseTo(4, 0)
  run([ball, hand], 0.5, 0.5 + DT)
  expect(hand.velocity.distanceTo(velocity)).toBeLessThan(70 * DT * 2)
  // a frame written to a bound hand moves what it is bound to
  hand.set({ x: 0, y: 0.9, z: 0 })
  ball.outside = false
  ball.set({ x: 0, y: 1, z: 0 })
  hand.bind(ball)
  hand.by({ at: 1, place: { x: 0.5, y: 0.9, z: 0 } })
  run([ball, hand], 0.5, 1)
  expect(ball.value.distanceTo(new Vector3(0.5, 1, 0))).toBeLessThan(0.01)
})

test('a frame on something moving is met where that will be, and held there as it moves', () => {
  const hips = new Channel('hips', 40, 0.2)
  const hand = new Channel('hand', 70, 0.3)
  hips.set({ x: 0, y: 1, z: 0 })
  hand.set({ x: 0.3, y: 1, z: 0 })
  hips.by({ at: 2, place: { x: 0, y: 1, z: 2 } })
  const frame: Frame = { at: 1, on: hips, place: { x: 0.2, y: 0.3, z: 0.3 } }
  hand.by(frame)
  const t = run([hips, hand], 0, 1.5)
  expect(hand.value.distanceTo(hips.value.clone().add({ x: 0.2, y: 0.3, z: 0.3 }))).toBeLessThan(0.01)
  run([hips, hand], t, 2)
  expect(hand.value.distanceTo(new Vector3(0.2, 1.3, 2.3))).toBeLessThan(0.01)
})

test('a turn goes to its frame on the same smoothest way', () => {
  const box = new Channel('box', 70, 0.3)
  box.set({ x: 0, y: 0, z: 0 })
  const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2)
  box.by({ at: 1, place: { x: 0, y: 0, z: 0 }, turn: turned })
  run([box], 0, 1)
  expect(box.turn.angleTo(turned)).toBeLessThan(1e-3)
})

test('who writes it owns it: cancelling one owner keeps the others, and settle hands it on when it has come to rest', () => {
  const foot = new Channel('foot', 400, 0.2)
  foot.set({ x: 0, y: 0, z: 0 })
  foot.by({ at: 0.3, place: { x: 0, y: 0, z: 0.4 }, by: 'gait' })
  foot.by({ at: 0.6, place: { x: 0, y: 0, z: 0.6 }, by: 'story' })
  foot.cancel('gait')
  expect(foot.frames.map((one) => one.by)).toEqual(['story'])
  let settled = 0
  foot.settle = () => (settled++ ? undefined : { place: { x: 0, y: 0, z: 0.8 }, by: 'gait' })
  run([foot], 0, 2)
  expect(settled).toBeGreaterThan(0)
  expect(foot.value.z).toBeCloseTo(0.8, 2)
})

test('about a pivot it swings round it, as an arm round its shoulder, and arrives turning as asked', () => {
  const shoulder = new Channel('shoulder', 40, 0)
  const hand = new Channel('hand', 200, 0.3)
  shoulder.set({ x: 0, y: 1.4, z: 0 })
  hand.set({ x: 0, y: 0.8, z: 0 })
  const spin = new Vector3(5, 0, 0)
  hand.by({ at: 1, place: { x: 0, y: 1.4, z: 0.6 }, velocity: { x: 0, y: 6, z: 0 }, spin, about: shoulder })
  let [near, far] = [Infinity, 0]
  run([shoulder, hand], 0, 1, () => {
    const r = hand.value.distanceTo(shoulder.value)
    ;[near, far] = [Math.min(near, r), Math.max(far, r)]
  })
  expect(near).toBeGreaterThan(0.55)
  expect(far).toBeLessThan(0.65)
  expect(hand.value.distanceTo(new Vector3(0, 1.4, 0.6))).toBeLessThan(0.02)
  expect(hand.velocity.y).toBeCloseTo(6, 0)
  expect(hand.spin.distanceTo(spin)).toBeLessThan(1)
})

test('it leaves no sooner than it is told to, holding as it was until then', () => {
  const foot = new Channel('foot', 300, 0.4)
  foot.set({ x: 0, y: 0, z: 0 })
  foot.by({ at: 1, place: { x: 0, y: 0.1, z: 1 }, velocity: { x: 0, y: 0, z: 10 }, leaves: 0.7 })
  run([foot], 0, 0.69)
  expect(foot.value.length()).toBeLessThan(1e-6)
  run([foot], 0.69, 1)
  expect(foot.value.distanceTo(new Vector3(0, 0.1, 1))).toBeLessThan(0.02)
})

test('given back from outside, it goes on from where it was moved to, never back to a frame it held before', () => {
  const foot = new Channel('foot', 200, 0.3)
  foot.set({ x: 0, y: 0.1, z: 0 })
  foot.by({ at: 0.2, place: { x: 0, y: 0.1, z: 0 } })
  run([foot], 0, 0.3)
  foot.outside = true
  let t = 0.3
  for (; t < 0.8; t += DT) {
    foot.value.set(0, 0.1 + (t - 0.3), 2 * (t - 0.3))
    foot.advance(t)
  }
  const was = foot.value.clone()
  foot.outside = false
  run([foot], t, t + DT)
  expect(foot.value.distanceTo(was)).toBeLessThan(0.05)
})
