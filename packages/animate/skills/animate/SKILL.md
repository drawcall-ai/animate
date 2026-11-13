---
name: animate
description: Write natural human motion for `@drawcall/animate`'s `Body` — walking, running, jumping, kicks, throws, reaches, holding and using things, a character led by a game. Use when authoring or fixing a story or a frame loop, or when one throws or looks unnatural; not for changing the library itself.
---

# Writing a motion

A story states only what must hold: where a foot, a hand or the hips are, when, and how they are moving there. The strides, the balance, the wind-up, the follow-through, the arms, the lean and the turn of the body are the body's, and it does them better than a story can spell them out. So a natural motion comes from writing less: find the one or two facts that define the action, state them, and leave everything else out.

## Finding the facts

Most actions are a way of getting somewhere and one moment that matters: the foot meets the ball, the hand lets go, the hips are at the top of a jump. Write how the body gets there as a walk or a run, and the moment as where the foot or hand is and how fast it is moving there.

```ts
function* action(body: Body): Story {
  body.run({ speed: 4, at: 6, plant: 'left', arrive: 2.5 }) // takes effect at once, and the story goes on
  yield* body.foot.right.to(place, { velocity }) // is there, moving so, at the first moment the run brings it within reach
  yield* body.stand()
}
```

A statement takes effect at once and holds until another replaces it; `yield*` waits for it. So the body is sent on its way without `yield*`, and the story waits for the moment it is about: a walk or a run waited for is over, and what was to happen as he arrives comes too late. A limb is planned when it is sent, on where the body is going by then, and one sent where the body never brings it within reach is an error at that statement. Nothing is taken back when a story ends: one that is to leave him standing ends with `yield* body.stand()`.

A `velocity` is what makes a limb draw back first and swing on after: it is for a strike, a throw, a kick, and not for letting go of something or putting it down. Writing the wind-up and the follow-through as places of their own gives a stiff motion in pieces. The body swings an arm the story says nothing about, so what both hands do, both are told.

## Choosing between the ways to say it

- **Where a place is counted from.** Something that is where it is, a ball or a rung, is a place in the scene as it stands. A pose of his own, a hand by the ear or a release beside the shoulder, is `on: body`: counted from the hip or the shoulder, going with him and turning as he turns. Something that moves is `on: thing`, a three.js object: a hand sent there stays on it as it moves until it is sent elsewhere or let `free`, which is how he holds a tool the scene moves, one statement for each hand. The `velocity` is always how the hand or foot is moving in the scene, so a ball let go leaves exactly so.
- **When it can, or by a moment.** With nothing said a hand or a foot is there at the first moment the body lets it be, with a short wind-up. `by` a moment well ahead gives it the full one, drawn back as far as its joints turn; the moment is usually the body's: `body.when(place)` tells when the hips come by, or come to rest where a walk ends, and `body.highest()` the top of the jump he is making. `seconds` is for a pace the story sets itself.
- **Going somewhere.** A walk or a run goes to a place on the ground, `{ x, z }`, or a number along z, and he faces the way he goes, turning round for what is more than a stride behind him. `body.face(way)` has him face another way as he walks, which is how he backs off or sidesteps, and `body.face()` gives it back; at a run he faces the way he goes. A walk is over when he has come to rest; a run is over as he comes by, so a run at a walk's speed is how a story passes a corner without stopping.
- **Which foot, where.** A run's `plant` and `at`, or a walk's `plant`, end it on a chosen foot, the strides coming out even onto it; a run's `arrive` has him brake onto it. That is how he arrives for a kick, a throw, a delivery or a jump off one leg.
- **A jump.** `body.jump(place)` is where the hips are at its top, a trunk and an arm under a hand stretched up. Stated straight after the run or walk, without waiting, he takes off from the foot that ends on. In the air his feet can be sent, and are his again when he lands; a run stated there takes over at the landing.
- **A stance.** A foot sent to rest at `body.ground(side, place)` is a step: it comes down there and he stands between his feet, as high as his legs allow and turned side-on as far as they are apart, with nothing said about the hips. A stance is one foot placed, an advance the front foot and then the back one, a lunge the front foot placed far ahead, a recovery the same foot placed back: one foot at a time, each waited for, and what a hand does in the step stated after the foot and before waiting for it. The next walk, run or `stand()` takes the feet back.
- **The hand itself.** Which way the `palm` faces and the fingers, or what they hold, are `pointing` is said with the place, as directions counted the way the place is; `with: 'palm' | 'grip' | 'index'` makes the place and the velocity that part of the hand's, the palm for hitting, pushing and lying flat on something, a fingertip for a button, the grip for the middle of what he holds. With a `velocity` they hold at the moment only, and the wrist whips through like the rest of the arm. `hand.shape('flat' | 'fist' | 'point' | { around: radius })` is what the fingers do; it holds until another is stated, through `free()` and `stand()`, `hand.shape()` lets them relax, and `{ by: moment }` has them so at a moment, which is how a thing is let go: `shape('flat', { by: release })`. A thing held in one hand is hung on `hand.grip`, at its origin along its z, the way a handle leaves the hand past thumb and index. A tool held in both hands is hung on a bone of his trunk, or posed from his body after each `update`, and each hand is sent to it once, `on` the tool with a `palm`: the palm wins, and the elbow swings to serve it. Keep such places well inside his reach, since he gives a little as he brakes and turns.
- **One thing after another for the same hand or foot.** Sends are carried out in order, each holding until the next has to set off: a pose to carry until the moment and the moment itself are two statements, the first without `yield*`. A hand sent on straight after a strike swings out of it into the next place, so a punch and the way back to the guard need no time given.

## Led by a game

A frame loop needs no story for the legs. Each frame it states how he is to be going, `body.go(velocity)`, and, if not the way he goes, which way he faces, `body.face(way)`; `body.hips.at(place)` tells where the world has put him when a wall stopped him, `body.hips.to({ y })` how high he keeps his hips as he goes, and `body.facing` reads the way he faces. Hands, kicks and jumps are stated as in a story, once, when they begin; stories for them are played alongside with `body.play`. An error raised in `body.update` is thrown once, after the frame is done and what could not be kept has been let go: catch it there and decide what the character does next.

## What makes it natural

A limb swings its end across itself far faster than it can stretch it. A fast arrival wants the limb about square to the way it is to move: a foot kicks forward from under the hip, a hand throws forward from above and behind the shoulder, and bowls or swings forward from below it. Asked to arrive fast along its own length or at full stretch, it will be an error or a jab.

Speed comes from the whole chain. A hand sent `by` a moment a second or so ahead gets all of it: the trunk turns away first and the pelvis leads it through, and on feet apart his weight goes onto the rear foot and through onto the front one. So a swing across the body is a foot placed ahead and one hand `by` its moment, arriving with the arm nearly stretched. A run-up is a large part of a hard throw, and standing still makes the same ask harder.

The body knows its own trunk, and an arm sent through it is an error; it knows nothing else that is in the way: a place for the hands wants a forearm's length clear of the head, and a way round an edge is a place of its own.

How long his legs and arms are and how high he stands is `body.size`, measured from his rig: places and heights in a story that is to fit any body are counted from it. For a hand sent lower than it reaches he bends and comes down, in time for the moment and no sooner: a low place needs no squat written for it. Going along or on feet put apart he comes down as far as a lunge; to the floor only standing with his feet together.

## When it throws

An error names the part, what it cannot do, by how much, and one change that would help. It is nearly always the ask that is wrong: a place out of reach, a speed along the limb, too little time, too short a run, a wrist turned further than it goes. Change that fact; adding steps to help the body along makes the motion worse. What arrives moving swings on and comes back by itself, so `stand()` straight after the moment does not cut the follow-through short.

## Seeing it

Run the story headless: `body.update(seconds)` in small steps while `body.playing`, reading each part's `value` and `velocity`. How a hand or a foot was moving at its moment is read in the story, straight after the `yield*` that waited for it: a step later it has moved on.
