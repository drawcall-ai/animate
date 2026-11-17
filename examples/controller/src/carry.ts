// The carry planner: the arms and the PAC-9 rifle on its sling. Slung, the rifle hangs muzzle down across his front,
// its left side against the plate carrier, on a two-point sling round his neck, from the back of the receiver over his
// right shoulder and from the front of the handguard over his left: the end of its stock at a mark on the chest, so it
// moves with the trunk. Taking it, the arms are taken from
// the locomotion planner and the right hand reaches for the pistol grip over REACH: a soft goal goes from where the hand
// was (on the pelvis) to its seat on the rifle while the fingers close from relaxed into the grip found for it. Once it
// is there the rifle is attached to it, off the sling, and one hard goal on the end of its stock lifts it to low ready
// over LIFT while the left hand reaches for the handguard the same way and, once there, closes the loop. The grips are
// kept as found. Putting it away is the same backwards: the left hand lets go and goes back, the right lowers the rifle
// onto the sling and lets go, and the locomotion planner takes the arms back over REACH.

import { createRifle, gripRifle, LOW_READY, lowReady } from "@drawcall/example-stage/rifle"
import { type Goal, HandPose, type Humanoid, hard, mark, mix, type Pose, posture, type Side, soft, stay, Target } from "@drawcall/animate"
import { BoxGeometry, Group, MathUtils, Matrix4, Mesh, MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from "three"

const REACH = 0.35 // s the hands take to reach the rifle and close on it, or to open and leave it
const LIFT = 0.4 // s the held rifle takes from the sling to low ready, or back
const SIDES = ["right", "left"] as const
/** Where the end of the stock is on the sling, in the chest's frame (+X his left, +Z ahead): at his right collarbone,
 * the rifle across his front, its right side out, tilted 0.65 rad from upright so that it clears the swinging left arm
 * above and the thighs below, leaning 0.25 rad out at the muzzle so that it lies on the plate carrier's front, and
 * rolled 0.3 rad to turn the pistol grip out from the carrier toward the reaching right hand. */
const SLUNG = new Matrix4()
  .makeBasis(new Vector3(0, 0, 1), new Vector3(Math.cos(0.65), Math.sin(0.65), 0), new Vector3(-Math.sin(0.65), Math.cos(0.65), 0))
  .multiply(new Matrix4().makeRotationY(-0.25))
  .multiply(new Matrix4().makeRotationZ(-0.3))
  .setPosition(-0.13, 0.24, 0.14)

/** The rifle on `body`'s sling, the sling itself (`sling`, to add to the scene and lay with `drawSling` after each
 * solve), and the planner that takes the rifle into the hands and puts it away again. */
export function createCarryPlanner(body: Humanoid) {
  const { hands } = body,
    { rifle, butt } = createRifle(),
    { grips, seats } = gripRifle(hands, rifle),
    ready = lowReady(body),
    chest = body.get("chest"),
    slung = mark(chest, "slung", new Vector3().setFromMatrixPosition(SLUNG), new Quaternion().setFromRotationMatrix(SLUNG))
  const hang = () => {
    slung.add(rifle)
    rifle.position.copy(butt.position).negate()
    rifle.quaternion.identity()
    body.update()
  }
  hang()
  // the sling: a strap from each of its points on the rifle up to where it goes over a shoulder, the front one lying
  // on the plate carrier on the way, each a run of straight pieces
  const webbing = new MeshStandardMaterial({ color: 0x3b3a2c, roughness: 0.95 })
  const runs = [
    [mark(rifle, "slingRear", new Vector3(0, 0.015, 0.12)), mark(chest, "slingRight", new Vector3(-0.1, 0.27, 0.08))],
    [
      mark(rifle, "slingFront", new Vector3(-0.02, 0, -0.33)),
      mark(chest, "slingOnCarrier", new Vector3(0.12, 0.02, 0.2)),
      mark(chest, "slingLeft", new Vector3(0.11, 0.27, 0.08)),
    ],
  ]
  const pieces = runs.flatMap((run) => run.slice(1).map((to, i) => ({ from: run[i], to, mesh: new Mesh(new BoxGeometry(0.035, 0.004, 1), webbing) })))
  const sling = new Group()
  sling.name = "sling"
  sling.add(...pieces.map((piece) => piece.mesh))
  const reached = { right: 0, left: 0 }, // 0 the hand where it set out from, 1 on its seat on the rifle, closed on it
    holding = { right: false, left: false } // attached to the hand
  let back = 0, // 1 when the hands have just left the rifle, falling to 0 as the locomotion planner takes the arms back
    lift = 0 // 0 the rifle where it hangs on the sling, 1 at low ready
  const reach = { right: new Target(), left: new Target() },
    out = { right: new Matrix4(), left: new Matrix4() } // where each hand was when it set out, in the pelvis's frame
  const pelvis = body.get("pelvis"),
    carried = new Target() // where the end of the stock is, lifted part of the way, in the pelvis's frame
  pelvis.add(carried)
  const arm = (side: Side) => Object.keys(LOW_READY).filter((bone) => bone.endsWith(side === "right" ? "R" : "L")) // the bones of an arm
  const lowReadyOf = (side: Side): Pose => Object.fromEntries(arm(side).map((bone) => [bone, LOW_READY[bone]]))
  const there = (side: Side) => body.positionOf(hands[side].bone).distanceTo(body.positionOf(seats[side])) < 0.01
  const frameOf = (o: Object3D) => new Matrix4().compose(body.positionOf(o), body.quaternionOf(o), new Vector3(1, 1, 1))
  const taken = () => reached.right > 0 || reached.left > 0
  /** Where the end of the stock goes on its way between the sling and low ready, `u` of the way: a point on the pelvis,
   * where low ready is, so that the rifle moves with the body. */
  const between = (u: number) => {
    const position = new Vector3(),
      quaternion = new Quaternion()
    frameOf(pelvis).invert().multiply(frameOf(slung)).decompose(position, quaternion, new Vector3())
    return carried.set({ position: position.lerp(ready.position, u), quaternion: quaternion.slerp(ready.quaternion, u) })
  }

  return {
    rifle,
    grips,
    sling,
    /** Whether the arms are the carry's this frame (a hand on the rifle, or on its way to it or back), not the locomotion planner's. */
    get taken() {
      return taken()
    },
    /** Whether the rifle is in both hands. */
    get held() {
      return holding.right && holding.left
    },
    /** This frame's goals for the arms and the rifle, `dt` after the last, with the rifle `wanted` in the hands or not. */
    update(dt: number, wanted: boolean): Goal[] {
      const before = taken()
      if (holding.left && !wanted) {
        body.release("left", rifle)
        holding.left = false
      }
      if (holding.right) lift = Math.min(1, Math.max(0, lift + (wanted ? dt : -dt) / LIFT))
      if (holding.right && !wanted && lift === 0) {
        body.release("right", rifle)
        hang()
        holding.right = false
      }
      // the right hand goes for the rifle when it is wanted and stays on it until it is back on the sling; the left
      // goes for it once the right has it off the sling
      const wants = { right: wanted || holding.right, left: wanted && holding.right }
      for (const side of SIDES) {
        if (reached[side] === 0 && wants[side]) out[side].copy(frameOf(pelvis)).invert().multiply(frameOf(hands[side].bone))
        reached[side] = Math.min(1, Math.max(0, reached[side] + (wants[side] ? dt : -dt) / REACH))
        const u = MathUtils.smoothstep(reached[side], 0, 1),
          position = new Vector3(),
          quaternion = new Quaternion()
        out[side].clone().premultiply(frameOf(pelvis)).decompose(position, quaternion, new Vector3())
        reach[side].set({ position: position.lerp(body.positionOf(seats[side]), u), quaternion: quaternion.slerp(body.quaternionOf(seats[side]), u) })
        if (!holding[side] && wants[side] && reached[side] === 1 && there(side)) {
          body.hold(side, rifle, grips[side]) // the right takes it off the sling, the left closes the loop
          holding[side] = true
        }
        if (!holding[side]) hands[side].setPose(mix(HandPose.relaxed, grips[side].pose, u))
      }
      back = before && !taken() ? 1 : Math.max(0, back - dt / REACH)
      const goals: Goal[] = []
      const up = MathUtils.smoothstep(lift, 0, 1)
      if (holding.right) {
        goals.push(hard(butt, lift === 1 ? ready : lift === 0 ? slung : between(up)), posture(body, LOW_READY, up))
        // on the way the right arm stays near where it is, which the rifle alone leaves open
        if (up < 1) goals.push(stay(body, 1 - up, arm("right")))
      }
      // and so does the trunk, letting go as the rifle comes up or as the right hand goes back from the sling
      const still = holding.right ? 1 - up : wanted ? 0 : MathUtils.smoothstep(reached.right, 0, 1)
      if (still > 0) goals.push(stay(body, still, ["spine", "chest"]))
      for (const side of SIDES) {
        if (holding[side]) continue
        const u = MathUtils.smoothstep(reached[side], 0, 1)
        if (u > 0) goals.push(soft(hands[side].bone, reach[side], 100), posture(body, lowReadyOf(side), 0.1 * u, { unlistedWeight: 0 }))
        // the arm stays as it is: less and less as its hand reaches for the rifle, fully while the other arm is still
        // busy with it, and less and less as the locomotion planner takes it back
        const calm = u > 0 ? (wanted ? 1 - u : 0) : taken() ? 1 : back
        if (calm > 0) goals.push(stay(body, calm, arm(side)))
      }
      return goals
    },
    /** Lay the sling's straps where the last solve left their points, broad side toward the way he faces. */
    drawSling() {
      const ahead = new Vector3(0, 0, 1).applyQuaternion(body.quaternionOf(chest))
      for (const { from, to, mesh } of pieces) {
        const [a, b] = [body.positionOf(from), body.positionOf(to)]
        mesh.position.lerpVectors(a, b, 0.5)
        mesh.scale.z = a.distanceTo(b)
        mesh.up.copy(ahead)
        mesh.lookAt(b)
      }
    },
  }
}
