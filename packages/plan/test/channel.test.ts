import { test } from 'vitest'
import { Channel } from '../src'
test('throw', () => {
const c = new Channel('hand', 60, 0.6)
c.set({ x: 0, y: 1, z: 0.3 })
c.by({ at: 1, place: { x: 0, y: 2, z: 0.5 }, velocity: { x: 0, y: 6, z: 3 } })
const ball = new Channel('ball', 1000, 1)
for (let k = 0; k <= 100; k++) {
  const t = k / 60
  c.advance(t)
  if (k % 5 === 0) console.log(t.toFixed(2), c.value.toArray().map(v=>v.toFixed(2)).join(' '), c.velocity.toArray().map(v=>v.toFixed(1)).join(' '), c.frames.length, c.short)
}
})
