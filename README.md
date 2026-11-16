# ik

Procedural human animation for three.js, in two small packages:

- [`@drawcall/ik`](packages/ik): goal-driven whole-body inverse kinematics on three.js bones. One pose per frame from hard and soft goals between points; no time in the goals, no memory in the solver.
- [`@drawcall/grab`](packages/grab): hand poses for rigged humanoids, and finding how a hand grips a mesh.

Both use three.js types throughout (`Object3D`, `Bone`, `Vector3`, `Quaternion`); three is the only dependency (the match example adds `@drawcall/physics` for the ball).

```
pnpm install
pnpm check        # typecheck, tests (they print their numbers), build the examples
pnpm soldier      # walking with a rifle held in both hands, aiming at a draggable target
pnpm tennis       # forehand, two-handed backhand and serve; drag the contact point
pnpm grip         # state a grip (thing, point on it, side the hand comes from) and the hand takes it
pnpm match        # two players rally; the ball is simulated by @drawcall/physics
```

## Layout

```
packages/ik        the solver, the body (kinematic tree), goals, a procedural humanoid
packages/grab      the hand, its poses and the grip finder
examples/soldier   scripted walk + rifle (closed loop), test
examples/tennis    three strokes as timed keys, test
examples/grip      a bare hand gripping changeable things, test
examples/match     two tennis players, each planned every frame from the real ball; 60 s headless test
examples/stage     what the examples share: a three.js stage and simple flesh on bones
```

Packages export their TypeScript source directly; there is no build step for them.

## The two packages together

They are independent. `@drawcall/ik` decides where bones are; `@drawcall/grab` decides what the fingers of a hand bone do and where a thing sits in it. The humanoid in `@drawcall/ik` has no finger bones yet, so the soldier and the tennis player hold their rifle and racket with a rigid hand, and the grip example uses a bare hand of its own.

## The match

`examples/match` is the first thing built on the layer above the solver: planners. Nothing in it is a framework.

- `court.ts`: floor, net and ball in `@drawcall/physics` (Rapier). `predict` integrates the ball forward, bounce included; `launch` gives the velocity that lands it at a point. A racket only ever sets the ball's velocity at contact.
- `walker.ts`: a locomotion planner in plain code. The pelvis moves towards where it is asked to be, the feet step to stay under where it will be, one in the air at a time; a foot in the air is committed. Others ask it explicitly: "this foot planted here, turned so, by then".
- `player.ts`: a stroke planner. Every frame it predicts the real ball, picks the contact (a time on the frame grid it can be standing for), forehand or backhand, asks the walker for the stance, and builds the swing from the racket's current position and velocity so that the sweet spot is at the ball at that time. The time and stroke are fixed once the swing starts, the path 0.15 s before contact.
- `match.ts`: the rules, and the contact itself.

The floor is frictionless so that a bounce is exactly predictable; the ball therefore keeps its pace through the bounce and the players stand well behind the baseline.
