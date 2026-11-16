# @drawcall/animate

Human motion for three.js, written down as what the body does.

A `Body` is a person as joints that turn, which turn the bones of a rigged humanoid. A story says what must hold —
where a foot, a hand, a thing he holds or the hips are to be, by when, and how fast they move there — and the body
plans the rest: each hand, foot and thing is a channel that goes from frame to frame on the smoothest way its strength
allows, drawing back before a fast arrival and swinging on after it; the gait steps the feet under the hips; joints
turn only as far as joints do; what is not written reacts (the trunk leans and turns after the hands, he gets down for
a low one, the arms swing against the legs). An ask he cannot meet he meets as nearly as he can.

```ts
import { Body, type Story } from '@drawcall/animate'

function* shot(body: Body, ball: Ball): Story {
  const spot = ball.position.z
  // the left foot comes down beside the ball and a little behind it, he brakes onto it, and the right foot meets the ball
  body.run({ speed: 3.6, plant: 'left', at: spot - 0.35, arrive: 2.5 })
  const through = meeting(ball, 20, degrees(8.6))
  yield* body.foot.right.to(through.at, through)
  strike(ball, body.foot.right.value, body.foot.right.velocity)

  yield* body.stand()
}

const body = new Body(rig)
scene.add(rig)
body.play(shot(body, ball))
renderer.setAnimationLoop(() => {
  body.update(timer.getDelta())
  renderer.render(scene, camera)
})
```

`rig` is the rigged character, a three.js `Object3D` with its bones under it; `meeting`, `strike` and `degrees` are the example's own: where a foot meets the ball, what the ball does then, and degrees as radians. The strides and how they come out onto the planted foot, the moment of the strike, the leap onto the planted foot, the backswing, the lean back, the follow-through and the steps that bring him to a stand are not in the story.

How to write stories and lead a character from a game is in the skill, [`skills/animate/SKILL.md`](skills/animate/SKILL.md).

## The rig

`new Body(rig)` takes a humanoid rigged with [`@drawcall/rig`](https://www.npmjs.com/package/@drawcall/rig), the `scene` its loader gives or the object given to its `skin()`, and from then on turns its bones. It finds them by the names a body asks of a rig: `hips`, `spine`, `head`, and on each side `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `leftUpperArm`, `leftLowerArm`, `leftHand`; one that is missing, or does not hang from the one before it, is an error. A hand may have fingers: `leftThumbMetacarpal`, `leftThumbProximal`, `leftThumbDistal`, and `leftIndexProximal`, `leftIndexIntermediate`, `leftIndexDistal`, with `Middle`, `Ring` and `Little` named like the index: each finger three bones from the knuckle out, hanging from one another, and one bone hanging from its last where the fingertip is, as a skeleton for `@drawcall/rig` ends every chain. A hand has all five or none; with none, whatever a story says of fingers is an error. Any other bone stays as it is against the bone it hangs from. The rig faces +z, its left at +x, and stands on y = 0, in metres, and the pose it is given in is its rest pose, arms out or half down, the elbows straight or a little bent. A hand with fingers may rest bent at the wrist, its forearm turned any way and its fingers curled: its knuckles tell how it lies, and it is counted in line with its forearm, the palm facing the thigh were the arm let down. One without fingers is counted as the rig has it, which is then to be in line with the forearm and palm down with the arm out. Its ankles are above the ground and lower than the ball of a foot is ahead of them, 0.182 of the leg: boots walk, stilts are an error. Nothing in a rig tells how it stood before it was posed, so a body is made of a rig at rest, and one that plainly is not, turned round, off the ground, its trunk not upright or a leg not straight down, is an error; a rig in other units than metres cannot be told, and gives a body of that size.

`body.size` is what the body measures there, between its joints, in the lengths of what holds the rig, so that the rig's own `scale` counts: scaled to half, it is a body half as large. Everything it does is a share of that: `size.stand` is how high the hips stand, `size.ankle` how high an ankle is above the ground it stands on, `size.hip` how far out from the middle a hip is, `size.leg` and `size.arm` how long a leg is from hip to ankle and an arm from shoulder to wrist. Its times and speeds follow from the leg and gravity: `size.beat` is how long the leg, hanging, takes over a radian of its swing, which is 2π there and back (0.3 s for a man), and `size.pace` how fast that is over its length (2.9 m/s). A body of another size makes the same motion in its own lengths and its own time, so a story that is to play on any rig counts its places in `size.leg` or `size.stand`, its speeds in `size.pace` and its moments in `size.beat`; one written in metres and seconds is for the size it was written for. The bones go far from where the mesh was bound, so a skinned mesh wants `frustumCulled = false`.

## Examples

The examples are in `../../examples`, each a small Vite app with a story page and a game: `football`, `javelin`,
`bowling`, `basketball`, `shelf`, `boxing`, `fencing`, `tennis`, `volleyball`, `hurdles`, `button`, `shooter` (a model
rigged as it loads), `rifleman`, `patrol`, `led` and `gait`. Those with something in the hand take its grip from
`@drawcall/hand`. The character they share is `mannequin.ts`, skinned to the skeleton in `person.ts`, on whose bare
bones the tests stand a body.

```sh
pnpm install
pnpm -F football dev   # or any example
pnpm test              # headless, through whole bodies
pnpm check             # types
```
