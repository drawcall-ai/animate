# @drawcall/hand

Hand poses for rigged humanoids: holding a hand in a pose, and finding how it grips a mesh. No time, no motion, no
arm. Three.js is the only dependency.

```ts
import { Hand, grip, hold } from '@drawcall/hand'

const hand = new Hand(rig, 'right')
// the palm on the handle's side facing -z, 7 cm up it
const held = grip(hand, racket, { at: new Vector3(0, 0.07, -0.0165), from: new Vector3(0, 0, -1) })
hold(hand, racket, held) // the hand onto the racket, or the racket into the hand if it hangs from the hand bone
```

## Exports

- `Hand(rig, side)`: a hand read from a rig at rest, scaled alike on all axes. `pose(pose)` turns the fingers;
  `segments(pose)` gives its bones as rods, in the hand bone's frame.
- `Pose`: per finger a `spread` and three `bend`s (rad); one pose mirrors on a left and a right hand. `relaxed`,
  `flat`, `fist` and `point` are poses.
- `grip(hand, target, { at, from, using, start })`: the target's place in the hand bone's frame, the pose that
  holds it, and where each element meets the target (`contacts`, in the target's frame). `using` lists the palm and fingers taking part (all by default); `start` is a pose for the rest, or an
  earlier grip on the same target to build on.
- `hold(hand, target, grip)`: puts the two together.

Whatever cannot be done throws, naming the part, by how much, and what to change.

A grip handed to an animation is both halves: `@drawcall/animate` takes the placement as where the hand bone is
against a thing, and the pose as what the fingers do.

## What a rig must have

Bones named `leftHand` / `rightHand`; under each, `{side}ThumbMetacarpal`, `{side}ThumbProximal`, `{side}ThumbDistal`
and `{side}{Index,Middle,Ring,Little}{Proximal,Intermediate,Distal}`, each hanging from the one before, and one bone
hanging from each distal bone at the fingertip (meshes may hang there too). At rest the hand may lie as the model has
it, the fingers curled and the thumb lifted or along the index: a pose counts each finger from it straight in the
palm's plane, pointing there as the rig points its first bone.

The skill in `skills/hand` says how to state a grip.
