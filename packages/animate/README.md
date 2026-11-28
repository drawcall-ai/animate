# @drawcall/animate

Procedural human animation for three.js: a body posed every frame from goals, not played from clips. Planners turn intent and time into the frame's goals (a locomotion planner walks, runs and jumps a humanoid after a moving point such as a physics capsule), one solve makes the pose, and hands grip the meshes they hold. A face planner acts any face that follows the ARKit blendshape standard: emotions that blend, eyes that look, and recorded lines spoken from their phones.

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

```ts
const acting = new FacePlanner(new Face(character), body)
const speech = await createSpeech(transcript, audioBuffer) // ahead of time

function frame(dt: number) {
  const goals = [...locomotion.update(dt, { position, velocity, taken: ["head"] }), ...acting.update(dt, { emotion: "happy", lookAt: camera.position })]
  solve(body, goals, dt)
}

// as the sound starts: what is heard of it, as the frame shows, keeps the mouth on it
acting.speak(speech, { heard: () => context.currentTime - startedAt - (context.outputLatency || 0) - context.baseLatency + 2 * dt })
```

The package ships its skill in `skills/animate`: how the frame loop, goals, planners, grips and faces fit together, for people and agents.
