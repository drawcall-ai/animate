import { BoxGeometry, CapsuleGeometry, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three'
import type { State } from './curve'
import { socket } from './hips'
import type { Joints } from './joints'
import { SIDES, SIGN, SIZE, SOLE, type Side, both } from './size'

/** how thick the parts are drawn: the radius of each rod, and how wide a foot is (m) */
export const THICK = { trunk: 0.13, thigh: 0.07, shin: 0.05, upperArm: 0.045, forearm: 0.04, foot: 0.09 }
/** how far below the top of the trunk the shoulders are, and how far above it the head begins (m) */
const TOP = { shoulder: 0.03, neck: 0.05 }
const material = new MeshStandardMaterial()
const at = new Vector3()

/** a part of the body that turns about a point of what it hangs on, drawn as a rod `length` up from there, or down */
function rod(on: Object3D, x: number, y: number, length: number, radius: number) {
  const joint = new Object3D()
  joint.position.set(x, y, 0)
  on.add(joint)
  const drawn = new Mesh(new CapsuleGeometry(radius, Math.abs(length) - 2 * radius), material)
  drawn.position.y = length / 2
  joint.add(drawn)
  return joint
}

/** A person as it is drawn with three.js: joints that turn, each a rod on what it hangs on, from the hips out. */
export class Figure {
  readonly pelvis = new Object3D()
  readonly chest = rod(this.pelvis, 0, 0, SIZE.trunk, THICK.trunk)
  readonly neck = new Object3D()
  readonly legs = both(() => {
    const thigh = rod(this.pelvis, 0, 0, -SIZE.thigh, THICK.thigh)
    const shin = rod(thigh, 0, -SIZE.thigh, -SIZE.shin, THICK.shin)
    const foot = new Object3D()
    foot.position.y = -SIZE.shin
    const sole = new Mesh(new BoxGeometry(THICK.foot, SIZE.ankle, SOLE.behind + SOLE.ahead), material)
    sole.position.set(0, -SIZE.ankle / 2, (SOLE.ahead - SOLE.behind) / 2)
    shin.add(foot.add(sole))
    return { thigh, shin, foot }
  })
  readonly arms = both((side) => {
    const upper = rod(this.chest, SIGN[side] * SIZE.shoulder, SIZE.trunk - TOP.shoulder, -SIZE.upperArm, THICK.upperArm)
    return { upper, fore: rod(upper, 0, -SIZE.upperArm, -SIZE.forearm, THICK.forearm) }
  })

  /** it is drawn `on` something, in whose frame its places are told */
  constructor(private readonly on: Object3D) {
    this.neck.position.y = SIZE.trunk + TOP.neck
    const skull = new Mesh(new SphereGeometry(SIZE.head), material)
    skull.position.y = SIZE.head
    on.add(this.pelvis)
    this.chest.add(this.neck.add(skull))
  }

  /** turns the drawn joints to where the hips and the joints are `seconds` on, going as they go now */
  pose(hips: State & Record<'turn' | 'turning' | 'list' | 'listing', number>, joints: Joints, seconds: number) {
    const on = ({ value, velocity }: State) => at.copy(value).addScaledVector(velocity, seconds)
    this.pelvis.position.copy(on(hips))
    this.chest.rotation.setFromVector3(on(joints.trunk))
    this.neck.rotation.setFromVector3(on(joints.head))
    for (const side of SIDES) {
      const { thigh, shin } = this.legs[side]
      // the pelvis turns and lists under a trunk and over legs that each face as they do: it has the hips where the legs hang
      socket(side, hips.turn + hips.turning * seconds, hips.list + hips.listing * seconds, thigh.position)
      thigh.rotation.setFromVector3(on(joints.legs[side].first))
      shin.rotation.x = on(joints.legs[side].second).x
      const { upper, fore } = this.arms[side]
      upper.rotation.setFromVector3(on(joints.arms[side].first))
      fore.rotation.x = on(joints.arms[side].second).x
    }
    this.on.updateMatrixWorld(true)
  }

  ankle(side: Side) {
    return this.on.worldToLocal(this.legs[side].shin.localToWorld(at.set(0, -SIZE.shin, 0)))
  }

  wrist(side: Side) {
    return this.on.worldToLocal(this.arms[side].fore.localToWorld(at.set(0, -SIZE.forearm, 0)))
  }
}
