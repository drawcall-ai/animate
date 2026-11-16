# ik

Procedural human animation for three.js, in four small packages:

- [`@drawcall/ik`](packages/ik): goal-driven whole-body inverse kinematics on three.js bones. One pose per frame from hard and soft goals between points; no time in the goals, no memory in the solver.
- [`@drawcall/humanoid`](packages/humanoid): a humanoid for it. The skeleton, joint limits, rest pose, balance goal and named points, procedural or on a rigged character.
- [`@drawcall/locomotion`](packages/locomotion): one locomotion planner for that humanoid. Walk to sprint, crouch, jump, stairs and turning around from a desired velocity, as this frame's goals.
- [`@drawcall/grab`](packages/grab): hand poses for rigged humanoids, and finding how a hand grips a mesh.

All use three.js types throughout (`Object3D`, `Bone`, `Vector3`, `Quaternion`); three is the only dependency of the packages. The examples add `@drawcall/physics` (the ball, the character's capsule) and `@drawcall/rig` (the tennis players).

```
pnpm install
pnpm check        # typecheck, tests (they print their numbers), build the examples
pnpm soldier      # walking with a rifle held in both hands, aiming at a draggable target
pnpm tennis       # forehand, two-handed backhand and serve; drag the contact point
pnpm grip         # state a grip (thing, point on it, side the hand comes from); the hand holds on as the thing moves
pnpm match        # two rigged players rally; the ball is simulated by @drawcall/physics (?follow=A stays close to one)
pnpm controller   # a physics capsule on keyboard or gamepad, and the body that follows it with planned steps
```

## Layout

```
packages/ik          the solver, the body (kinematic tree), goals
packages/humanoid    the humanoid: skeleton, limits, rest pose, balance, points; procedural or a rigged character's
packages/locomotion  the locomotion planner
packages/grab        the hand, its poses and the grip finder
examples/controller  the capsule character controller of @drawcall/physics and the planner following it; test
examples/soldier   scripted walk + rifle (closed loop), test
examples/tennis    three strokes as timed keys, test
examples/grip      a bare hand gripping changeable things, test
examples/match     two tennis players, each planned every frame from the real ball; 60 s headless test
examples/stage     what the examples share: a three.js stage and simple flesh on bones
```

Packages export their TypeScript source directly; there is no build step for them.

## ik and grab

`@drawcall/ik` decides where bones are; `@drawcall/grab` finds how a hand holds a thing, once: where the hand bone goes on it and what the fingers do. That place is a frame on the thing, to attach to the hand bone with `body.attach`, or to reach for as the hand bone's goal. The two are independent. The humanoid has no finger joints yet, so the soldier and the tennis player hold their rifle and racket with a rigid hand, and the grip example uses a bare hand of its own.

## The match

`examples/match` is the first thing built on the layer above the solver: planners. Nothing in it is a framework.

- `court.ts`: floor, net and ball in `@drawcall/physics` (Rapier). `predict` integrates the ball forward, bounce included; `launch` gives the velocity that lands it at a point. A racket only ever sets the ball's velocity at contact.
- `rig.ts`: the player's character, a generated model rigged by `@drawcall/rig`; `@drawcall/humanoid` puts the body on its skeleton.
- `player.ts`: a stroke planner over `@drawcall/locomotion`. Every frame it moves to where it is to stand, predicts the real ball, picks the contact (a time on the frame grid it can be standing for), forehand or backhand, asks the locomotion planner for the stance ("this foot planted here, turned so, by then"), and builds the swing from the racket's current position and velocity so that the sweet spot is at the ball at that time. The time and stroke are fixed once the swing starts, the path 0.15 s before contact.
- `match.ts`: the rules, and the contact itself.

The floor is frictionless so that a bounce is exactly predictable; the ball therefore keeps its pace through the bounce and the players stand well behind the baseline.
