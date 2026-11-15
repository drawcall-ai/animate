import { test } from 'vitest'
import { Channel } from '../src'
test('bind', () => {
  const thing = new Channel('ball', 70, 0.3)
  const hand = new Channel('hand', 70, 0.3)
  thing.set({ x: 0, y: 1, z: 0 })
  hand.set({ x: 0, y: 0.9, z: 0 })
  hand.bind(thing)
  thing.by({ at: 0.6, place: { x: 0, y: 1.4, z: 0.4 } })
  for (let k = 1; k <= 48; k++) {
    const t = k / 60
    thing.advance(t)
    hand.advance(t)
    if (k % 6 === 0) console.log(t.toFixed(2), thing.value.toArray().map((v) => v.toFixed(2)).join(','), hand.value.toArray().map((v) => v.toFixed(2)).join(','))
  }
})
