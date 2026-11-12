# animate-2d

Procedural motion for a physically simulated person in three.js, written as a timeline of what the body does.

A `Humanoid` is a ragdoll in a [Rapier](https://rapier.rs) world whose parts are three.js meshes. Every joint has a muscle, and the actions of a [timeline](https://pmndrs.github.io/timeline) say what a part is to do; whatever asks last in a step is obeyed, and a part nothing asks anything of goes back to rest. A balance assist keeps the figure standing while a foot is on the ground.

```ts
function* shot(human: Humanoid, ball: RigidBody, speed: number) {
  const { rightThigh, rightShin } = human.parts
  yield* action({ update: [pose(rightThigh, back), pose(rightShin, folded)], until: timePassed(0.4, 'seconds') })
  const kick = solve(human, (trial, power) => whip(trial, power), {
    measure: (trial) => launch(trial.world.getRigidBody(ball.handle)),
    target: speed,
    within: 0.5,
    powers: [0.1, 1],
  })
  if (!kick.ok) return kick
  yield* whip(human, kick.power)
  return kick
}

const human = new Humanoid(world)
scene.add(human)
human.play(shot(human, ball, 20))
renderer.setAnimationLoop(() => {
  human.update(timer.getDelta())
  renderer.render(scene, camera)
})
```

`solve` rehearses a recipe on copies of the humanoid and its world, harder or softer, until the outcome you measure comes out at the target. When the target is out of reach it says so, and what is in reach.

## Examples

`examples/football` is a shot at a ball and `examples/javelin` a standing javelin throw. Each is its own small Vite app that brings its world, its timeline and one recipe.

```sh
pnpm install
pnpm -F football dev   # or: pnpm -F javelin dev
pnpm test              # both examples, headless
pnpm check             # types
```
