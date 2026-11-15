import { Gait } from '@drawcall/gait'
import { Bones, joints, parts, tick } from '@drawcall/limbs'
import type { Object3D } from 'three'
import { Stride } from './stride'

/** a rigged humanoid moved by the frame gait alone, posed by its stride: what the drills lead when the page asks for `?gait=frames` */
export class Walker {
  readonly gait: Gait
  readonly size: Bones['size']
  private readonly stride: Stride
  private owed = 0

  constructor(rig: Object3D) {
    const bones = new Bones(rig)
    const turning = joints(bones)
    for (const part of parts(turning)) part.free()
    this.size = bones.size
    this.gait = new Gait(bones.size)
    this.stride = new Stride(bones, turning, this.gait)
    this.stride.pose(0)
  }

  get time() {
    return this.gait.time
  }

  /** the hips where they are, and where the world has him on the ground */
  get hips() {
    return { value: this.gait.hips.value, at: (place: { x: number; z: number }) => this.gait.at(place) }
  }

  go(velocity: { x: number; z: number }) {
    // (told between its steps: the lead is from the moment the frame is for)
    this.gait.go(velocity, this.gait.time + this.owed)
  }

  face(way?: { x: number; z: number }) {
    this.gait.face(way)
  }

  update(delta: number) {
    const dt = tick(this.size)
    for (this.owed += delta; this.owed >= dt; this.owed -= dt) {
      const { gait } = this
      const now = gait.time + dt
      gait.advance(now)
      gait.hips.advance(now)
      gait.feet.left.advance(now)
      gait.feet.right.advance(now)
      this.stride.pose(dt)
    }
    // (drawn as he is at the moment the update is for, between his steps)
    this.stride.draw(this.owed)
  }
}
