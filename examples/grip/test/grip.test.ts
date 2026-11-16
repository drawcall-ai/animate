// Headless check for the grip example: stated from the side, the hand holds every thing.
import { Hand, grip, hold } from '@drawcall/grab'
import { Group, Vector3 } from 'three'
import { afterAll, expect, test } from 'vitest'
import { createHand } from '../src/rig'
import { THINGS } from '../src/things'

const report: string[] = []
afterAll(() => console.log('\n' + report.join('\n') + '\n'))

test('the hand holds every thing, coming from three sides', () => {
  const sides = [new Vector3(-1, 0, 0.3), new Vector3(0.3, 0, 1), new Vector3(1, 0, -0.5)]
  for (const [name, make] of Object.entries(THINGS)) {
    let worst = 0, slowest = 0, touching = 9
    for (const from of sides) {
      const hand = new Hand(createHand(), 'right'), thing = new Group().add(make())
      thing.position.set(0.1, 1.1, -0.2)
      thing.rotation.set(0.3, 0.5, 0.2)
      const t0 = performance.now()
      const found = grip(hand, thing, { at: new Vector3(), from })
      slowest = Math.max(slowest, performance.now() - t0)
      hold(hand, thing, found)
      worst = Math.max(worst, found.fault)
      touching = Math.min(touching, Object.values(found.contacts).filter(c => c.gap < 0.002).length)
    }
    report.push(`${name}: at worst ${(1000 * worst).toFixed(1)} mm from holding, at least ${touching} of 6 hand parts touching, slowest ${slowest.toFixed(0)} ms`)
    expect(worst).toBeLessThan(0.02)
  }
})
