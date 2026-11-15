import { Gait } from '@drawcall/gait'
import { Bones, joints, parts, tick } from '@drawcall/limbs'
import type { Story } from '@drawcall/animate'
import type { Object3D } from 'three'
import { Stride } from './stride'

/** a rigged humanoid moved by the frame gait alone, posed by its stride: what the drills lead when the page asks for `?gait=frames` */
export class Walker {
  readonly gait: Gait
  readonly size: Bones['size']
  private readonly stride: Stride
  private owed = 0
  private readonly stories: Story<unknown>[] = []

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

  /** the scripted words, as the body has them */
  run(run: Parameters<Gait['run']>[0]) {
    this.gait.run(run)
  }

  walk(to: { x: number; z: number }, way?: Parameters<Gait['walk']>[1]) {
    this.gait.walk(to, way)
  }

  jump(top: { x: number; y: number; z: number }) {
    this.gait.jump(top)
    return this.landed()
  }

  private *landed(): Story {
    while (this.gait.jumps) yield
  }

  when(place: { x: number; z: number }) {
    return this.gait.when(place)
  }

  highest() {
    return this.gait.highest()
  }

  stand() {
    this.gait.stand()
  }

  play(story: Story<unknown>) {
    this.stories.push(story)
  }

  *until(when: number): Story {
    while (this.time < when - 1e-9) yield
  }

  update(delta: number) {
    const dt = tick(this.size)
    for (this.owed += delta; this.owed >= dt; this.owed -= dt) {
      const { gait } = this
      for (let k = 0; k < this.stories.length; k++) if (this.stories[k].next().done) this.stories.splice(k--, 1)
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
