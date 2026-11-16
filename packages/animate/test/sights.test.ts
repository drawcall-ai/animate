import { buildWorld } from '@drawcall/physics-rapier'
import { Scene, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { level } from '../../../examples/shooter/level'
import { RIFLE } from '../../../examples/shooter/rifle'
import { Soldier } from '../../../examples/shooter/soldier'

/** the tip of the front sight's post, in the rifle's frame (m) */
const FRONT = new Vector3(0, RIFLE.sight.y, 0.78)

/** frame times: even, or uneven as a browser's are (s) */
const TIMES = {
  even: () => 1 / 60,
  uneven: (k: number) => [1 / 30, 1 / 144, 1 / 60, 1 / 90, 1 / 40][k % 5],
}

/**
 * The sight picture down the sights, as the shooter's page has it: the camera on the aim line through the rear sight,
 * looking along the aim. How far the front sight's tip is off the middle of the picture each frame (mrad), as he
 * stands, sweeps, walks and fires down the sights.
 */
async function picture(times: (k: number) => number) {
  const [scene, world] = [new Scene(), level()]
  scene.add(world.drawn)
  const physics = await buildWorld({ scene })
  const soldier = new Soldier(person(), physics)
  scene.add(soldier.shown)
  const off: { t: number; x: number; y: number; camera: Vector3 }[] = []
  for (let t = 0, k = 0; t < 9; k++) {
    const dt = times(k)
    t += dt
    // still to 3 s, sweeping right and back from 3 to 5, walking from 5 to 7, firing from 7 to 9
    const yaw = t >= 3 && t < 5 ? 0.6 * Math.sin(Math.PI * (t - 3)) : 0
    const pitch = t >= 3 && t < 5 ? 0.15 * Math.sin(2 * Math.PI * (t - 3)) : 0
    const move = { x: 0, z: t >= 5 && t < 7 ? 1 : 0 }
    soldier.update(dt, { move, yaw, pitch, sights: true, fire: t >= 7 })
    physics.update(dt)
    world.update()
    if (t < 1.5 || !soldier.aimed.sights) continue
    const ahead = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const right = new Vector3().crossVectors(ahead, new Vector3(0, 1, 0)).normalize()
    const up = new Vector3().crossVectors(right, ahead)
    const sight = soldier.sight()
    const camera = sight.clone().addScaledVector(ahead, -sight.distanceTo(soldier.body.eye('right')))
    const front = soldier.rifle.localToWorld(FRONT.clone()).sub(camera)
    const along = front.dot(ahead)
    off.push({ t, x: (1000 * front.dot(right)) / along, y: (1000 * front.dot(up)) / along, camera })
  }
  return off
}

/**
 * how far the picture moves from frame to frame: the root of the mean square and the most (mrad), and how far the
 * camera is at the most off the line between where it was the frame before and where it is the frame after, by time (mm)
 */
function jitter(off: { t: number; x: number; y: number; camera: Vector3 }[]) {
  const moves = off.slice(1).map((now, k) => Math.hypot(now.x - off[k].x, now.y - off[k].y))
  const rms = Math.sqrt(moves.reduce((sum, move) => sum + move * move, 0) / moves.length)
  const shakes = off.slice(1, -1).map(({ t, camera }, k) => {
    const [before, after] = [off[k], off[k + 2]]
    const between = before.camera.clone().lerp(after.camera, (t - before.t) / (after.t - before.t))
    return 1000 * camera.distanceTo(between)
  })
  return { rms, most: Math.max(...moves), off: Math.max(...off.map(({ x, y }) => Math.hypot(x, y))), shake: Math.max(...shakes) }
}

test.each(Object.keys(TIMES) as (keyof typeof TIMES)[])(
  'down the sights the front sight stays in the middle of the picture, and standing he holds the camera still, frame times %s',
  async (times) => {
    const seen = await picture(TIMES[times])
    expect(jitter(seen).most).toBeLessThan(0.5)
    expect(jitter(seen.filter(({ t }) => t < 3)).shake).toBeLessThan(1)
  },
  30000,
)

test('he stands side-on to the rifle as he aims, both hands on it, and fires from the hip and down the sights', async () => {
  const [scene, world] = [new Scene(), level()]
  scene.add(world.drawn)
  const physics = await buildWorld({ scene })
  const soldier = new Soldier(person(), physics)
  let hip = 0
  for (let t = 0; t < 4; t += 1 / 60) {
    const sights = t > 2.5
    soldier.update(1 / 60, { move: { x: 0, z: 0 }, yaw: 0, pitch: 0, fire: t > 1, sights })
    physics.update(1 / 60)
    world.update()
    if (!sights) hip = soldier.shots
  }
  // (his shoulders square to the way he faces, not to the aim his head turns to)
  const across = soldier.body.shoulder('left').sub(soldier.body.shoulder('right'))
  const facing = soldier.body.facing
  expect(Math.abs(across.normalize().dot(facing))).toBeLessThan(0.15)
  expect(soldier.gun.there).toBe(true)
  expect(hip).toBeGreaterThan(5)
  expect(soldier.shots - hip).toBeGreaterThan(5)
}, 30000)

test('raising and lowering the sights, reloading and turning sharply, he stays standing, never crouching unasked', async () => {
  const [scene, world] = [new Scene(), level()]
  scene.add(world.drawn)
  const physics = await buildWorld({ scene })
  const soldier = new Soldier(person(), physics)
  let lowest = Infinity
  for (let t = 0; t < 8; t += 1 / 60) {
    if (Math.abs(t - 4) < 1e-3) soldier.reload()
    const yaw = t > 6 ? 1.5 * Math.sin(8 * (t - 6)) : 0
    soldier.update(1 / 60, { move: { x: 0, z: 0 }, yaw, pitch: 0, sights: (t > 1 && t < 2) || (t > 2.5 && t < 3) })
    physics.update(1 / 60)
    world.update()
    if (t > 0.5) lowest = Math.min(lowest, soldier.body.hips.value.y)
  }
  expect(lowest / soldier.body.size.stand).toBeGreaterThan(0.9)
}, 30000)
