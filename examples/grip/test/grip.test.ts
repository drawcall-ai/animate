// Headless checks for the grip example: the hand holds every thing, no finger goes through what it grips, and the
// hand stays as it holds while the thing moves.
import { FINGERS, type Grip, Hand, grip } from '@drawcall/grab'
import { Group, Vector3 } from 'three'
import { afterAll, expect, test } from 'vitest'
import { createHand, FLESH } from '../src/rig'
import { THINGS } from '../src/things'
import { type Case, cases, placed } from './cases'
import { sink } from './sink'

const report: string[] = []
afterAll(() => console.log('\n' + report.join('\n') + '\n'))

/** every how-manyth grip of the sweep is tried: 1 for all 11,466 of them, which takes a quarter of an hour */
const STRIDE = 17
/** how deep the hand's skin, as thick as the grip takes it to be, may be in a thing (m): skin gives a millimetre, the
 * balls that stand for a bone leave as much between them, and a search stops within a fraction of that */
const GIVE = 0.0025

/** a hand gripping a thing as the example does it: hung from the thing at the grip's place, in the grip's pose */
function held(c: Case, thing = placed(c.thing)) {
  const hand = new Hand(createHand(), 'right')
  const found = grip(hand, thing, { at: c.at, from: c.from, thumb: c.thumb, using: c.using, start: c.start })
  const seat = new Group()
  thing.add(seat.add(hand.bone))
  seat.position.copy(found.position)
  seat.quaternion.copy(found.quaternion)
  hand.pose(found.pose)
  return { hand, thing, found }
}
const mm = (m: number) => (1000 * m).toFixed(1).padStart(5)
type Row = { c: Case; deep: Record<string, number>; drawn: Record<string, number> }
const deepest = (rows: Row[], of: 'deep' | 'drawn') => Math.max(0, ...rows.flatMap((row) => FINGERS.map((f) => row[of][f])))

test('the hand holds every thing, coming from three sides', () => {
  const sides = [new Vector3(-1, 0, 0.3), new Vector3(0.3, 0, 1), new Vector3(1, 0, -0.5)]
  for (const thing of Object.keys(THINGS)) {
    let worst = 0, slowest = 0, touching = 9
    for (const from of sides) {
      const t0 = performance.now()
      const { found } = held({ thing, at: new Vector3(), from, thumb: new Vector3(0, 1, 0) } as Case)
      slowest = Math.max(slowest, performance.now() - t0)
      worst = Math.max(worst, found.fault)
      touching = Math.min(touching, Object.values(found.contacts).filter((c) => c.gap < 0.002).length)
    }
    report.push(`${thing}: at worst ${(1000 * worst).toFixed(1)} mm from holding, at least ${touching} of 6 hand parts touching, slowest ${slowest.toFixed(0)} ms`)
    expect(worst).toBeLessThan(0.02)
  }
  report.push('')
})

test('no finger goes through what it grips, whatever is gripped, where, from which side and how', () => {
  const rows: Row[] = []
  for (const c of cases(STRIDE)) {
    const { hand, thing } = held(c)
    rows.push({ c, deep: sink(hand, thing, hand.radius), drawn: sink(hand, thing, FLESH) })
  }
  report.push(`How deep fingers are in the thing (mm), ${rows.length} grips`, `${'thing'.padEnd(8)} ${'grip'.padEnd(5)} grips  sunk   ${FINGERS.join(' ')}   as drawn`)
  for (const thing of Object.keys(THINGS))
    for (const kind of ['whole', 'pinch', 'tip']) {
      const mine = rows.filter(({ c }) => c.thing === thing && c.kind === kind)
      const sunk = mine.filter(({ deep }) => FINGERS.some((f) => deep[f] > GIVE)).length
      const worst = FINGERS.map((f) => mm(Math.max(0, ...mine.map(({ deep }) => deep[f]))))
      report.push(`${thing.padEnd(8)} ${kind.padEnd(5)} ${String(mine.length).padStart(5)} ${String(sunk).padStart(5)}   ${worst.join(' ')}   ${mm(deepest(mine, 'drawn'))}`)
    }
  for (const { c, deep } of rows.filter(({ deep }) => FINGERS.some((f) => deep[f] > GIVE)))
    report.push(`  sunk: ${c.name}: ${FINGERS.map((f) => mm(deep[f])).join(' ')}`)
  report.push(`deepest: ${mm(deepest(rows, 'deep')).trim()} mm, as drawn ${mm(deepest(rows, 'drawn')).trim()} mm\n`)
  expect(deepest(rows, 'deep')).toBeLessThan(GIVE)
  expect(deepest(rows, 'drawn')).toBe(0)
}, 1800_000)

test('a held thing carries the hand: moved and turned, the hand on it is as it was', () => {
  const c = cases(1).find((c) => c.name === 'Mug p0 s4 whole relaxed')!
  const { hand, thing, found } = held(c)
  const before = sink(hand, thing, hand.radius)
  thing.position.set(-0.4, 0.3, 0.9)
  thing.rotation.set(-1.1, 2.3, 0.4)
  thing.updateMatrixWorld(true)
  const after = sink(hand, thing, hand.radius)
  for (const e of [...FINGERS, 'palm'] as const) expect(Math.abs(after[e] - before[e])).toBeLessThan(1e-5) // a hundredth of a millimetre: rounding in the matrices
  const again: Grip = grip(new Hand(createHand(), 'right'), thing, c)
  expect(again.position.distanceTo(found.position)).toBeLessThan(0.001)
})

test('turning the grip direction a little turns the hand a little: it never flips over', () => {
  for (const thing of ['Handle', 'Bottle', 'Box', 'Phone', 'Mug']) {
    const target = placed(thing)
    const hand = new Hand(createHand(), 'right')
    let last: Grip | undefined, most = 0
    for (let k = 0; k <= 72; k++) {
      const a = (2 * Math.PI * k) / 72
      const found = grip(hand, target, { at: new Vector3(), from: new Vector3(Math.cos(a), 0.3, Math.sin(a)), thumb: new Vector3(0, 1, 0) })
      if (last) most = Math.max(most, found.quaternion.angleTo(last.quaternion))
      last = found
    }
    report.push(`${thing}: the hand turns at most ${((most * 180) / Math.PI).toFixed(0)}° for 5° of grip direction`)
    expect(most).toBeLessThan(0.5)
  }
}, 600_000)
