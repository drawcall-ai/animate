---
name: animate
description: Write natural human motion with `@drawcall/animate`'s `Body` — walking, running, jumping, kicks, throws, reaches, holding and letting go of things, and a character a game leads and interrupts. Use when writing or fixing a story or a game's frame loop, or when a motion comes out short or unnatural; not for changing the library itself.
---

# Writing a motion

A story states only what must hold: where a hand, a foot, a thing or the hips are, by when, and how fast they move
there. Strides, balance, wind-up, follow-through, the free arm and the lean are the body's. Write the one or two facts
that define the action; in-between places fight the planner and make it worse.

```ts
function* shot(body: Body, ball: Thing): Story {
  body.run({ speed: 4, at: 6, plant: 'left', arrive: 2.5 }) // takes effect now; not waited for
  yield* body.foot.right.to(place, { velocity })            // there, moving so, at the first moment the run allows
  yield* body.stand()                                       // nothing is undone when a story ends
}
```

A statement takes effect when it is made; `yield*` only waits for it. Places count from where the rig stood when the
`Body` was made, along its axes (+z the way he faced), and are best told in `body.size` (`arm`, `leg`, `stand`,
`shoulder`…) so a story fits any rig.

## Frames

Every hand, foot and bound thing is a channel: each statement writes one frame — a place, a moment, a velocity, a
turn — and the channel goes there from whatever state it is in, as smoothly as it is strong enough to.

- **When:** say nothing and it is the first moment the body can be there at its ease (he gets down first for a low
  place); `by(moment, …)` names one (`body.when(place)` is when the hips come by a place, `body.highest()` the top of
  his jump); `{ seconds }` counts from the frames already written to that end, which are met in order.
- **Where:** a place as above; `on: body` a place on him, carried as he goes; `on: mesh` a place on something that
  moves, followed until sent elsewhere.
- **How fast:** `velocity` is for a strike, a throw, a kick: the limb draws back as far as its joints and strength
  need and swings through after. Leave it out to arrive at rest, as when putting something down.
- **Turned:** `palm` and `pointing` for a hand; `with: 'index' | 'palm' | 'knuckles' | …` puts that part of the hand
  at the place instead of the wrist.
- **Out of reach, too fast, too soon:** it comes as near as it can and `yield*` gives `false`. Change the ask (the
  moment, the place, his stance) rather than adding steps.

## Cancel

`hand.cancel()`, `foot.cancel()`, `thing.cancel()` and `body.cancel()` drop what was asked and go on from the state it
is in: moving, it swings on; a frame written straight after takes over without a stop. `body.cancel()` keeps the hands
on what they hold; `body.stand()` cancels and brings him to rest.

## Things: bind, hold, let go

`const ball = body.bind(mesh)` makes a thing his; `ball.on(body.hand.right, grip)` puts a hand on it by a grip from
`@drawcall/hand`. Make each `Hand` before the `Body`: it reads the rig at rest, and the body poses it. `on` is planned
like any frame: the hand goes to its grip on the thing where it is, moving or at rest, closing its fingers, and from
the moment it arrives they are one (`yield* ball.on(…)` waits for that). A thing he holds from the start is put there
with `ball.in(hand, grip)`.

With a hand on it, send the thing, not the hand: `ball.to(…)`, `ball.by(release, place, { velocity })`. The body
plans it as the end of the first hand's arm, and the other hands go with it; sending a hand that is on a thing throws.
`ball.off(hand)` takes a hand off; `ball.free()` lets go, each hand going on as it moved, and returns the thing's
velocity for physics. With no hand on it, a bound thing is still the world's.

`body.bind(mesh, { outside: true })` is for a thing the game or physics moves every frame (a rifle along the aim, a
lever): the hands follow it as far as the arms reach and never move it. Setting `thing.outside` hands it over at that
moment.

## Ownership

One owner at a time for each part: the story that wrote its frame, the thing it is bound to, the game (`outside`), or
the body, which has whatever nothing else has. The gait has the hips and the feet: `walk`, `run`, `jump` and `go` ask
it; a foot sent to a place on the ground is a step it takes; a foot sent anywhere else is the story's until met or
cancelled.

## Led by a game

Each frame, before `body.update(delta)`: `body.go(velocity)`, `body.hips.at(place)` where the world has him,
`body.face(way)` if he is not to face the way he goes, `body.look(place)`. An action with timed legs (run-up, plant,
lunge, jump) is a story given to `body.play`; on fresh input, a new direction or action, call `body.cancel()` and
lead him from there.

## Seeing it

`?debug=plan,gait,hand,body` on an example page (bare `?debug` for all, I to toggle): `plan` each channel's way and
frames, `gait` the lead, stride and footfalls, `hand` the grips, `body` how far each limb came from its plan (red is
far). Headless, step `body.update(dt)` while `body.playing`; `body.intent()` gives the channels and gaps,
`body.gait.intent()` the gait.
