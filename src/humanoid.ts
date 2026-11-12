import { Ray, World } from '@dimforge/rapier3d-compat'
import { type Timeline, TimelineRunner } from '@pmndrs/timeline'
import { Group, Vector3 } from 'three'
import { assist } from './balance'
import { NOT_HUMANOID, build } from './body'
import { type Gait, release, standing, walk } from './gait'
import { Part } from './part'
import { type PartName, SKELETON, eachPart, inertia } from './skeleton'

/** the step of time a humanoid's world advances by (s) */
export const STEP = 1 / 240
/** how far below the pelvis ground still counts as stood on (m) */
const REACH = 1.4

const down = { x: 0, y: -1, z: 0 }
const point = new Vector3()

/**
 * A ragdoll of a person standing at the origin of a physics world, facing +z. It steps that world: `update` plays
 * its timeline and advances the world in steps of STEP, however long the frame was.
 */
export class Humanoid extends Group {
  readonly parts: Record<PartName, Part>
  readonly kg: number
  /** where its mass is and how that moves, as of the step being taken */
  readonly centre = new Vector3()
  readonly velocity = new Vector3()
  /** the speed its legs are to keep in this step (m/s); none after the step, so it comes to a stand */
  pace = 0
  /** whether the balance assist acts in this step; on again after the step */
  balance = true
  private runner?: TimelineRunner<Humanoid>
  private clock = { delta: STEP, prevDelta: STEP, frame: 0 }
  private owed = 0

  constructor(
    readonly world: World,
    bodies = build(world),
    readonly gait: Gait = standing(),
  ) {
    super()
    world.timestep = STEP
    const made = new Map<PartName, Part>()
    this.parts = eachPart((name) => {
      const { center, joint } = SKELETON[name]
      const parent = joint && made.get(joint.parent)
      if (joint && !parent) throw new Error(`${name} is listed before its parent ${joint.parent}`)
      const tie = joint &&
        parent && {
          parent,
          strength: joint.strength,
          inertia: new Vector3(...inertia(name)),
          anchor: new Vector3(...joint.at).sub(point.set(...center)),
        }
      const part = new Part(SKELETON[name], bodies[name], tie)
      made.set(name, part)
      this.add(part)
      return part
    })
    this.kg = Object.values(this.parts).reduce((kg, part) => kg + part.body.mass(), 0)
  }

  play(timeline: Timeline<Humanoid, unknown>) {
    this.runner = new TimelineRunner(timeline)
  }

  get playing() {
    return this.runner !== undefined && !this.runner.finished
  }

  update(delta: number) {
    for (this.owed += delta; this.owed >= STEP; this.owed -= STEP) this.step()
    for (const part of Object.values(this.parts)) part.follow()
  }

  /** one step of time: what the timeline asks, what the reflexes offer where it asked nothing, then the muscles and the world */
  step() {
    this.centre.set(0, 0, 0)
    this.velocity.set(0, 0, 0)
    for (const { body } of Object.values(this.parts)) {
      this.centre.addScaledVector(point.copy(body.worldCom()), body.mass() / this.kg)
      this.velocity.addScaledVector(point.copy(body.linvel()), body.mass() / this.kg)
    }
    this.runner?.step(this, this.clock)
    this.clock.frame++
    const { pelvis } = this.parts
    const hit = this.world.castRay(new Ray(pelvis.body.translation(), down), REACH, true, undefined, NOT_HUMANOID)
    const floor = hit ? pelvis.body.translation().y - hit.timeOfImpact : undefined
    if (!this.balance) release(this)
    else if (floor !== undefined) walk(this, floor, STEP)
    assist(this, floor, STEP)
    for (const part of Object.values(this.parts)) part.drive(STEP)
    this.pace = 0
    this.balance = true
    this.world.step()
  }

  /** a copy of this humanoid in a copy of its world, playing nothing: free its world when done with it */
  rehearsal() {
    const world = World.restoreSnapshot(this.world.takeSnapshot())
    return new Humanoid(
      world,
      eachPart((name) => world.getRigidBody(this.parts[name].body.handle)),
      structuredClone(this.gait),
    )
  }
}
