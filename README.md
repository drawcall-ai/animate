# animate-2d

Procedural motion for a 2D stick figure, written as a short story of what the body does.

The figure is made of masses that keep their velocity and rods between them. Drivers aim one part against another with a strength, and the ground acts only through a planted foot. A story names the few things that matter (a lean, where a foot comes down, a drive toward an outcome) and waits on what physically happens.

```ts
function* shot(player: Actor<Pitch>): Story {
  const { ball } = player.world
  player.trunk({ lean: -16 }, { seconds: 0.2 })
  yield* player.step('left', { at: ball.p.x - 0.08, lands: 'firm', bend: 22 })
  yield* player.drive(kick('right', ['hip', 'knee']), { measure: (pitch) => pitch.struck?.speed ?? null, target: 27, powers: [0.4, 9] })
  yield* player.settle()
}
```

A drive is a recipe you write: a function that applies torques each step. `drive` tries it on a copy of the figure and its world, harder or softer, until the outcome you measure comes out at the target.

## Examples

`examples/football` is a shot at goal and `examples/javelin` a javelin throw. Each is its own small Vite app that brings its world, one drive recipe and its story.

```sh
pnpm install
pnpm -F football dev   # or: pnpm -F javelin dev
pnpm test              # both examples, headless
pnpm check             # types
```
