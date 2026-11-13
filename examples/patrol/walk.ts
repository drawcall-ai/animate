import type { Body, Story } from 'animate-2d'

/** the corners of the square he walks round, on the ground, in the order he comes to them (m) */
export const CORNERS = [
  { x: 0, z: 3 },
  { x: 3, z: 3 },
  { x: 3, z: 0 },
  { x: 0, z: 0 },
]

/** how fast he goes round it (m/s) */
const SPEED = 1.4

/** He walks round a square, on through each corner: then sidesteps along its first edge facing out of it, turns where he stands to face back along it, and stands. */
export function* patrol(body: Body): Story {
  // (a walk ends at rest: a run is over as he comes by where it ends, and at this speed he walks it)
  for (const at of CORNERS.slice(0, -1)) yield* body.run({ speed: SPEED, at })
  yield* body.walk(CORNERS[3])
  // the square is on his left as he comes back to where he set off: he faces out of it, and goes along its edge sideways
  yield* body.face({ x: -1, z: 0 })
  yield* body.walk(CORNERS[0])
  yield* body.face({ x: 0, z: -1 })
  yield* body.stand()
}
