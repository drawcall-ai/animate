import { skin } from '@drawcall/rig'
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { FINGERS, PERSON } from './person'

/** how thick the parts are: the radius of each rod, and how wide, high and long a foot is (m) */
const THICK = {
  trunk: 0.13,
  neck: 0.05,
  head: 0.1,
  shoulder: 0.05,
  upperArm: 0.045,
  forearm: 0.04,
  thigh: 0.07,
  shin: 0.05,
  finger: 0.008,
}
const FOOT = { wide: 0.09, high: 0.07, long: 0.24, ahead: 0.06 }
const UP = new Vector3(0, 1, 0)

type Name = (typeof PERSON)[number]['name']
const joint = (name: Name) => {
  const found = PERSON.find((bone) => bone.name === name)
  if (!found) throw new Error(`the person has no ${name}`)
  return new Vector3(...found.position)
}

/** a rod from a joint to another, round at both: its ends reach `past` the joints by so much of its radius */
function rod(from: Name, to: Name, radius: number, past = 1) {
  const [a, b] = [joint(from), joint(to)]
  const along = b.clone().sub(a)
  const drawn = new CapsuleGeometry(radius, along.length() + 2 * radius * (past - 1))
  return drawn
    .applyQuaternion(new Quaternion().setFromUnitVectors(UP, along.clone().normalize()))
    .translate(...a.add(b).divideScalar(2).toArray())
}

function body() {
  const crown = joint('head_end')
  const head = new SphereGeometry(THICK.head).translate(crown.x, crown.y - THICK.head, crown.z)
  const parts: BufferGeometry[] = [rod('hips', 'neck', THICK.trunk, 0), rod('chest', 'head', THICK.neck), head]
  for (const side of ['left', 'right'] as const) {
    const foot = new BoxGeometry(FOOT.wide, FOOT.high, FOOT.long)
    parts.push(
      rod(`${side}Shoulder`, `${side}UpperArm`, THICK.shoulder),
      rod(`${side}UpperArm`, `${side}LowerArm`, THICK.upperArm),
      rod(`${side}LowerArm`, `${side}Hand`, THICK.forearm),
      rod(`${side}Hand`, `${side}Hand_end`, THICK.forearm, 0),
      rod(`${side}UpperLeg`, `${side}LowerLeg`, THICK.thigh),
      rod(`${side}LowerLeg`, `${side}Foot`, THICK.shin),
      foot.translate(joint(`${side}Foot`).x, FOOT.high / 2, FOOT.ahead),
    )
  }
  return new Mesh(mergeGeometries(parts), new MeshStandardMaterial())
}

const rigged = new Group().add(body())
await skin(rigged, PERSON, 96)
// (its bones take it far from where it is bound, where a camera would take it to be)
rigged.traverse((part) => {
  if (part instanceof SkinnedMesh) part.frustumCulled = false
})
// the fingers are rods of their own, each on its bone from its joint to the next
rigged.updateMatrixWorld(true)
const flesh = new MeshStandardMaterial()
for (const { name, parent } of FINGERS) {
  const bone = rigged.getObjectByName(parent)
  if (!bone) throw new Error(`the mannequin has no ${parent}`)
  if (bone.name.endsWith('Hand')) continue
  const drawn = new Mesh(rod(parent, name, THICK.finger), flesh)
  drawn.applyMatrix4(bone.matrixWorld.clone().invert())
  bone.add(drawn)
}

/** A man of rods, skinned to the person's skeleton with @drawcall/rig: each call gives one of his own, at rest. */
export const mannequin = () => clone(rigged)
