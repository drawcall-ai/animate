---
name: hand
description: Pose the fingers of a rigged humanoid hand with `@drawcall/hand` — named poses, and gripping a mesh (a handle, a ball, a board's edge, a trigger, a pinch, a pistol). Use when a hand must hold, touch or carry something, or must look natural at rest; not for moving the arm or body.
---

# Natural hands with @drawcall/hand

Every pose is checked against a person's range, and a grip closes the fingers onto the actual mesh. Your work is
the statement of the grip; never tune angles to fit an object.

## Without a thing in the hand

`relaxed` for a hand at rest (never `flat`, which is for pushing or waving), `fist`, `point`. A sign no named pose
comes near: start from one and change one finger.

## A grip is four facts

```ts
grip(hand, target, { at, from, using, start })
```

1. **The target**: the object whose meshes the hand closes on. Grip the closed mesh.
2. **`at`**, in the target's frame: the point the grip is about.
   - With the palm: the point the hand takes hold of, on the surface coming from `from`. The palm comes in on it at
     the crease at the base of the fingers, where a fist's fingers fold over, and the fingers' first bones lie along
     the target's side. A thing deeper than a finger is long, as a board or a plate held over its edge, the fingers
     hook over instead, and the point is under the palm's middle. The fingers reach about a palm's width either side
     of it along the target, so put it mid-way along the stretch of handle the hand covers.
   - Without the palm: the point the thumb and fingers hold between them, inside the target; a lone finger's point
     is on the surface, where its tip arrives.
3. **`from`**, in the target's frame: the side the hand comes from. With the palm taking part the palm faces the
   target from there. Without it the hand is behind the thing, its fingers pointing the way it comes, along −`from`.
   A key held by its bow, the blade along −y: `at` the bow's middle, `from: (0, 1, 0)`, `using: ['thumb', 'index']`;
   the hand is behind the bow, the index running the way the blade points, the blade going on past its tip.
   - A pen: from behind the nib, `from` toward the long end, which lies back over the web, the nib ahead.
   - A card off a table: from its near edge, `from` out past that edge.
   - A ball held up: from below, `from: (0, −1, 0)`, in the fingertips.
   - A button: from the side it faces, `using: ['index']`.

   A flat thing may be pressed by the thumb against the side of the index, as the key is.

4. **`using`**: what takes part, the palm and fingers, all by default.
   - All: a power grip — handles, bottles, a bar, a board's edge.
   - Without the thumb: a hook — a suitcase handle.
   - `['thumb', 'index']`: a pinch; add `'middle'` for a three-finger hold. The palm stays clear.
   - One finger: a press — a trigger, a button.

Never state where a handle seats, how the fingers wrap, in what order they close, or that the thumb comes level: the
solver does. The hand rolls by itself about `from`: without the palm the line from thumb to fingers lies across the
target's thin direction, so the pads land on its two broad faces; with it a long thing lies along the palm from the
heel to the index knuckle, and the
target's bulk (a racket's head, a mug's body) goes out on the thumb's side. Where there is no bulk to one side, as
round the middle of a rod, a ball or a plate, either way round holds; the thumb then goes to the target's +y side,
else +z, else +x. To have it the other way, state `from` and `at` on the target turned over, or give it a bulk.

Closing is enclosing: each joint turns in until its bone meets the target. The fingers close first, each straight
from its knuckle and spread only as far as it must to reach the target, and wrap it joint by joint. The thumb closes
last, the same way: with the palm it comes round the other side of the target, onto it where there is room or across
the backs of the fingers where they cover it, closing the ring; without the palm it presses the target against the
fingers. A finger with nothing to close on closes to its fist, which counts
as holding only round something within a finger's thickness. What is left out keeps `start` (`relaxed` by default)
as far as the target allows: where it is in the way it opens or folds the least that clears, and only if it cannot
is that an error. Give `start: fist` to curl the fingers that take no part out of the way, as round a trigger.

## Composing grips

A grip can start from another on the same target: its placement is kept, so `from` is not asked for, and only the
new elements reach for the new `at`, which they must come within a finger's breadth of. A pistol is the hand round the grip and then the index on the trigger:

```ts
const held = grip(hand, pistol, {
  at: backStrap,
  from: right,
  using: ['palm', 'thumb', 'middle', 'ring', 'little'],
  start: point,
})
const firing = grip(hand, pistol, { at: trigger, using: ['index'], start: held })
```

## Using the result

`grip` returns the target's place in the hand bone's frame and the pose. `hold(hand, target, grip)` puts them
together either way: if the target hangs from the hand bone it is moved into the hand; otherwise the hand is moved
onto the target where it stands. For an arm, the hand bone's goal is the target's matrix times the inverse of the
grip's placement.

To hand a grip to an animation, give it both halves: the placement says where the hand bone is against the target,
the pose what the fingers do. A thing carried in the hand is hung on the hand bone at the placement; a thing the hand
goes to has the hand sent to the placement on it. Read the `Hand` while the rig is still at rest, before the
animation poses it.

## When it throws

Each error names what failed, by how much, in which direction of the target's frame, and the one change to make to
the statement: move `at`, come from another `from`, leave an element out, or `start` it elsewhere.

## Limits

- A ball bigger than the hand spans cannot be held across with the thumb: the thumb ends on the fingers' side.
  Leave the thumb out, or come from a side where the hand reaches round.
- From above, a lever's stem can stand in the way of the fingers closing round its arm.
- A straight finger pressing a trigger is only had by composing: a lone finger in a fresh grip presses with its pad,
  slightly bent.

The rig must be at rest when the `Hand` is made; its fingers may rest curled and its thumb anywhere, since a pose
counts each finger from it straight in the palm, pointing as the rig points its first bone.
