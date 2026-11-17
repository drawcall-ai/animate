# @drawcall/animate

Procedural human animation for three.js: a body posed every frame from goals, not played from clips. Planners turn intent and time into the frame's goals (a locomotion planner walks, runs and jumps a humanoid after a moving point such as a physics capsule), one solve makes the pose, and hands grip the meshes they hold.

```
npm install @drawcall/animate three
```

```ts
import { Humanoid, LocomotionPlanner, solve } from "@drawcall/animate"

const body = new Humanoid({ rig: character }) // or new Humanoid() for bones of its own
scene.add(body.root, character) // the rig goes into the same parent as the body's root
const locomotion = new LocomotionPlanner(body)

function frame(dt: number) {
  // where the character is to be on the ground and how it moves, from your physics or input
  solve(body, locomotion.update(dt, { position, velocity }), dt)
}
```

The package ships its skill in `skills/animate`: how the frame loop, goals, planners and grips fit together, for people and agents.
