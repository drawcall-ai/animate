---
name: animate
description: Write natural human motion with `@drawcall/animate`'s `Body` — walking, running, jumping, kicks, throws, reaches, holding and letting go of things, and a character a game leads and interrupts. Use when writing or fixing a story or a game's frame loop, or when a motion comes out short or unnatural; not for changing the library itself.
---

# Writing a motion

A story states only what must hold: where a hand, a foot, a thing or the hips are, by when, and how fast they move
there. Everything between — strides, balance, wind-up, follow-through, the free arm, the lean — is the body's. Write
the one or two facts that define the action and leave the rest out; adding in-between places makes it worse.

```ts
function* shot(body: Body, ball: Thing): Story {
  body.run({ speed: 4, at: 6, plant: 'left', arrive: 2.5 }) // takes effect now; not waited for
  yield* body.foot.right.to(place, { velocity })            // there, moving so, at the first moment the run allows
  yield* body.stand()                                       // nothing is undone when a story ends
}
```

## Frames

Every hand, foot and bound thing is a channel: each statement writes one frame — a place, a moment, a velocity, a
turn — and the channel goes there from whatever state it is in, on the smoothest way it is strong enough for.

- **When:** nothing said is the first moment the body lets it be there; `by(moment, …)` a moment you name
  (`body.when(place)` for when the hips come by a place, `body.highest()` for the top of the jump he is making);
  `{ seconds }` a pace you set. Frames for one end are met in order.
- **Where:** a place in the scene; `on: body` for a pose of his own (goes with him); `on: mesh` for something that
  moves (the end follows it until sent elsewhere).
- **How fast:** `velocity` is for a strike, a throw, a kick: it makes the limb draw back as far as its joints and
  strength need and swing through after. Never for putting something down.
- **Turned:** `palm` and `pointing` for a hand; `with: 'index' | 'palm'` plans that part instead of the wrist.
- **What it cannot do** it does as nearly as it can — out of reach, too fast, too soon — and the frame is marked
  short (`yield*` gives `false`). Change the ask, not the steps.

## Cancel

`hand.cancel()`, `foot.cancel()`, `thing.cancel()` and `body.cancel()` drop what was asked and go on from the state
it is in: moving, it swings on; a new frame written straight after takes over smoothly. `body.stand()` cancels and
comes to rest.

## Things: bind, hold, let go

`const ball = body.bind(mesh)` makes a thing his; `ball.on(body.hand.right, grip)` puts a hand on it by a grip from
`@drawcall/hand` (read from the rig at rest). With a hand on it, send **the thing**, never that hand: `ball.to(…)`,
`ball.by(release, place, { velocity })` — the body plans it as the end of the leading arm; a second hand follows its
grip. `ball.off(hand)` takes a hand off; `ball.free()` lets it go and returns its velocity for physics. Sending a hand
that is on a thing is an error. Before any hand is on it, a bound thing is still the world's.

`body.bind(mesh, { outside: true })`: the game or physics sets it every frame (a rifle along the aim, a lever) and the
hands follow it, never moving it. A thing the game carries with him is followed with his hips.

## Ownership

Each channel has one owner at a time: the story that wrote its frame, the thing it is bound to, the outside, or the
body (free). The gait owns the hips and the feet unless a story puts a foot (`foot.to(ground place)` is a step) or a
walk, run or jump is stated.

## Led by a game

Each frame, before `body.update(delta)`: `body.go(velocity)`, `body.hips.at(place)` where the world has him,
`body.face(way)` if not the way he goes, `body.look(place)`. An action whose legs are timed — run-up, plant, lunge,
jump — is a story played with `body.play`; on fresh input (a new direction, a new action) the game calls
`body.cancel()` and leads him from there. Delay from key to motion should be one frame.

## Seeing it

`?debug=plan,gait,hand,body` on any example page (bare `?debug` for all, I key to toggle): `plan` shows each channel's
way and frames, `gait` the lead, stride and footfalls, `hand` the grips, `body` how far each limb came from its plan
(red = short). Headless: step `body.update(dt)` while `body.playing` and read `value`/`velocity`; `body.intent()`
gives the same data.

## Sizes

Count places from `body.size` (`arm`, `leg`, `stand`, `shoulder`…) so a story fits any rig.
