---
name: grab
description: Pose the fingers of a rigged humanoid hand with `@drawcall/grab` — named poses, and gripping a mesh (a handle, a ball, a board's edge, a trigger, a pinch, a pistol). Use when a hand must hold, touch or carry something, or must look natural at rest; not for moving the arm or body.
---

# Natural hands with @drawcall/grab

Every pose is checked against a person's range, and a grip closes the fingers onto the actual mesh. Your work is
the statement of the grip; never tune angles to fit an object.

A grip is found once, when the hand takes hold, and kept as it is while it holds: the hand and the thing are one
rigid piece. Never find it again every frame, and never move the hand on the thing by hand.

## Without a thing in the hand

`relaxed` for a hand at rest (never `flat`, which is for pushing or waving), `fist`, `point`. A sign no named pose
comes near: start from one and change one finger.

## A grip is five facts

```ts
grip(hand, target, { at, from, thumb, using, start })
```

1. **The target**: the object whose meshes the hand closes on. Grip the closed mesh.
2. **`at`**, in the target's frame: the point the grip is about.
   - With the palm: the point the hand takes hold of, on the target or in it: the palm comes in along `from` through
     it to the surface, meeting it at the crease at the base of the fingers, where a fist's fingers fold over, and the
     fingers' first bones lie along the target's side. A thing deeper than a finger is long, as a board or a plate held over its edge, the fingers
     hook over instead, and the point is under the palm's middle. The fingers reach about a palm's width either side
     of it along the target, so put it mid-way along the stretch of handle the hand covers.
   - Without the palm: the point the thumb and fingers hold between them, in the target (a point outside is taken
     in); a lone finger's point is on the surface, where its tip arrives.
3. **`from`**, in the target's frame: the side the hand comes from. With the palm taking part the palm faces the
   target from there. Without it the hand is behind the thing, its fingertips leading, and what it holds goes on away
   from the hand, never back over it.
4. **`thumb`**, in the target's frame: the side of the target the thumb goes to; only its part across `from` counts.
   With `from` it says exactly how the hand is turned, so the grip never flips. With the palm the knuckles run from
   the little finger to the index toward that side, so a long thing lies along the palm and the thumb's side is
   along it: a racket's head, a bottle's neck. Without the palm the thumb is on that side of the fingers, squeezing
   the target across it: state a thin thing's broad face. A key held by its bow, the blade along −y, 3 mm thick in z:
   `at` the bow's middle, `from: (0, 1, 0)`, `thumb: (0, 0, 1)`, `using: ['thumb', 'index']`; the hand is behind the
   bow, the index's pad on one face, the thumb's tip on the other, the blade going on away from the hand.
   - A racket: `from` the face of the handle the palm lies on, `thumb` toward the head.
   - A pen: from its side, `thumb` across the barrel, which goes out between the thumb and the index.
   - A card off a table: from its near edge, `from` out past that edge, `thumb` up out of the card.
   - A ball held up: from below, `from: (0, −1, 0)`, `thumb` any way across, in the fingertips.
   - A button: from the side it faces, `using: ['index']`, `thumb` the side of it the thumb is on.

5. **`using`**: what takes part, the palm and fingers, all by default.
   - All: a power grip — handles, bottles, a bar, a board's edge.
   - Without the thumb: a hook — a suitcase handle.
   - `['thumb', 'index']`: a pinch; add `'middle'` for a three-finger hold. The palm stays clear.
   - One finger: a press — a trigger, a button.

Never state where a handle seats, how the fingers wrap, in what order they close, or that the thumb comes level: the
solver does. How the hand is turned is yours to state, by `from` and `thumb`, and nothing else turns it.

Closing is enclosing: each joint turns in until its bone meets the target. The fingers close first, each straight
from its knuckle and spread only as far as it must to reach the target, and wrap it joint by joint. The thumb closes
last, the same way: with the palm it comes round the other side of the target, onto it where there is room or across
the backs of the fingers where they cover it, closing the ring; without the palm it presses the target against the
fingers. A finger with nothing to close on closes to its fist, which counts
as holding only round something within a finger's thickness. What is left out keeps `start` (`relaxed` by default)
as far as the target allows: where it is in the way it moves the least that clears. Give `start: fist` to curl the
fingers that take no part out of the way, as round a trigger.

## Adding a finger

A grip can start from another of the same target: the hand stays where that one has it, so `from` and `thumb` are
not needed, and
only what is `using` moves. A finger taking part alone goes to `at`. A pistol is the hand round the grip and then the
index on the trigger:

```ts
const held = grip(hand, pistol, { at: backStrap, from: right, thumb: up, using: ['palm', 'thumb', 'middle', 'ring', 'little'], start: point })
const firing = grip(hand, pistol, { at: trigger, using: ['index'], start: held })
```

## Using the result

A `Grip` is where the hand bone goes in the target's frame (`position`, `quaternion`) and the fingers' `pose`.
`hand.pose(held.pose)` sets the fingers. Then make the two one piece, whichever way round suits:

- The thing in the hand: hang it from the hand bone at the inverse of that place.
- The hand on the thing: hang the hand bone from a frame on the thing at that place.
- With `@drawcall/ik`: mark the place on the thing, `const seat = mark(racket, 'seat', held.position, held.quaternion)`,
  and attach it, `body.attach(racket, body.get('handR'), seat)`. To reach for a thing first, make `seat` the hand
  bone's goal and move the fingers in with `mix(relaxed, held.pose, u)`, then attach when the hand is there.

Read the `Hand` while the rig is still at rest, before an animation poses it.

## When it cannot hold as stated

A grip never fails for the target's size or shape: where the hand cannot close as asked it gives the nearest grip,
clear of the target, and `contacts` say how far each element is off and `fault` how far the hand is from holding (0
when it holds). No finger goes through the target. It throws only for a statement it cannot read: a target without a
mesh, nothing taking part, or a fresh grip without `from`, or without a `thumb` across it.

## Limits

- A ball bigger than the hand spans is not held across: the palm and fingers lie on it and the thumb rests on it
  beside them, or out of the way when left out.
- From above, a lever's stem can stand in the way of the fingers closing round its arm.
- A lone finger goes to a point only when `grip` is given it as `at`; without one it closes from straight till it
  meets the thing, wherever that is. Give a point on the thing's surface: for one off it the finger goes to where the
  way from its knuckle to the point meets the thing.

The rig must be at rest when the `Hand` is made; its fingers may rest curled and its thumb anywhere, since a pose
counts each finger from it straight in the palm, pointing as the rig points its first bone.
