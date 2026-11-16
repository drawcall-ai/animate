# @drawcall/grab

Hand poses for rigged humanoids: holding a hand in a pose, and finding how it grips a mesh. It is visual only: no time, no motion, no forces, no arm. Three.js is the only dependency.

```ts
import { Hand, grip } from "@drawcall/grab"

const hand = new Hand(rig, "right")
// the palm on the handle's side facing -z, 7 cm up it, the thumb toward the head (+y)
const held = grip(hand, racket, { at: new Vector3(0, 0.07, -0.0165), from: new Vector3(0, 0, -1), thumb: new Vector3(0, 1, 0) })
hand.pose(held.pose)
// held.position, held.quaternion: where the hand bone is in the racket's frame
```

A grip is found once, when the hand takes hold, and kept as it is for as long as it holds: the hand and the thing are one rigid piece. Hang the thing from the hand bone there, or with `@drawcall/ik` mark that place on the thing and attach it to the hand bone; to reach for a thing first, make that mark the hand bone's goal.

## Exports

- `Hand(rig, side)`: a hand read from a rig at rest, scaled alike on all axes. `pose(pose)` turns the fingers; `segments(pose)` gives its bones as rods, in the hand bone's frame.
- `Pose`: per finger a `spread` and three `bend`s (rad); one pose mirrors on a left and a right hand. A finger spreads only while its knuckle is open: as it bends, its folding turns to aim at the heel of the hand, so closed fingertips converge there whatever the spread. `relaxed`, `flat`, `fist` and `point` are poses; `mix(a, b, u)` is the pose a share `u` of the way from `a` to `b`, to move into a grip.
- `grip(hand, target, { at, from, thumb, using, start })`: how the hand holds the target, at the point `at` coming from the side `from`, the thumb to the side `thumb` (all in the target's frame; only the part of `thumb` across `from` counts, and the two together fix how the hand is turned), with the palm and fingers `using` (all by default), the rest held as in `start` (`relaxed` by default). A `Grip` is where the hand bone goes in the target's frame (`position`, `quaternion`), the fingers' `pose`, where each element meets the target (`contacts`, in its frame) and how far the hand is from holding (`fault`, 0 when it holds). Started from an earlier grip of the same target, the hand stays where that one has it and only what is `using` moves: a finger taking part alone goes to `at`, as onto a trigger.

No finger goes through the target: each closes only till it meets it, one the target is in the way of gets out of its way, and where the hand cannot hold as stated it gives the nearest grip it can, clear of the target. The grip depends on the hand, the target's shape and the statement alone, not on where either stands. Only a statement that cannot be read throws: no mesh, nothing taking part, no side to come from or for the thumb.

## What a rig must have

Bones named `leftHand` / `rightHand`; under each, `{side}ThumbMetacarpal`, `{side}ThumbProximal`, `{side}ThumbDistal` and `{side}{Index,Middle,Ring,Little}{Proximal,Intermediate,Distal}`, each hanging from the one before, and one bone hanging from each distal bone at the fingertip (meshes may hang there too). At rest the hand may lie as the model has it, the fingers curled and the thumb lifted or along the index: a pose counts each finger from it straight in the palm's plane, pointing there as the rig points its first bone.

The skill in `skills/grab` says how to state a grip.
