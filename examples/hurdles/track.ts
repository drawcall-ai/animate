import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'

/** a hurdle across the lane: where it stands along z, and how high its bar is (m) */
export type Hurdle = { z: number; height: number }

/** how high the bar of a hurdle is (m) */
export const HEIGHT = 0.76
/** how far along the first hurdle stands from where the runner starts, and how far apart they are (m) */
export const FIRST = 13
export const APART = 8.5
/** how wide a hurdle is, and how thick its bar and its posts are drawn (m) */
const WIDE = 1.2
const BAR = { high: 0.07, thick: 0.02 }
const POST = 0.03

/** the two hurdles of the track */
export const track = (): Hurdle[] => [0, 1].map((k) => ({ z: FIRST + k * APART, height: HEIGHT }))

/** the hurdles as they are drawn: a bar on two posts each */
export function draw(hurdles: Hurdle[]) {
  const white = new MeshStandardMaterial({ color: 0xe0e0e0 })
  const grey = new MeshStandardMaterial({ color: 0x909090 })
  const drawn = new Group()
  for (const { z, height } of hurdles) {
    const bar = new Mesh(new BoxGeometry(WIDE, BAR.high, BAR.thick), white)
    bar.position.set(0, height - BAR.high / 2, z)
    drawn.add(bar)
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(POST, height - BAR.high, POST), grey)
      post.position.set((side * (WIDE - POST)) / 2, (height - BAR.high) / 2, z)
      drawn.add(post)
    }
  }
  return drawn
}

/** how far over the bar of a hurdle something is while it is above it, or undefined while it is not (m) */
export function over(hurdle: Hurdle, at: { y: number; z: number }, near = 0.05) {
  return Math.abs(at.z - hurdle.z) <= near ? at.y - hurdle.height : undefined
}
