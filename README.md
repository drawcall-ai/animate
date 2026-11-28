# animate

Procedural human animation for three.js: a body posed every frame from goals, not played from clips, and a face acted from emotions and recorded lines. The published package is [`@drawcall/animate`](packages/animate), with its skill in `packages/animate/skills/animate`; it bundles the workspace's private packages (`packages/ik`, `humanoid`, `hand`, `locomotion`, `face`, `speech`). The examples are characters built on it with `@drawcall/rig` and `@drawcall/physics`; what they share (the stage, the rigged tennis player and soldier, the racket and the rifle with how the hands hold them) is in `examples/stage`.

```
pnpm install
pnpm check        # typecheck, tests (they print their numbers), build the package and the examples, pack the package
pnpm soldier      # the rigged soldier walks with the PAC-9 rifle in both hands, aiming at a draggable target
pnpm tennis       # the rigged tennis player's forehand, two-handed backhand and serve
pnpm match        # two rigged tennis players rally a ball simulated by @drawcall/physics
pnpm controller   # the rigged soldier on a physics capsule, by keyboard or gamepad; R carries the PAC-9 rifle
pnpm grip         # a bare hand gripping changeable things
pnpm face         # Jean Phil, his face rigged by @drawcall/rig, feels and speaks lines (first `pnpm -F @drawcall/example-face data <dir>` copies his model in)
```

A release is a `v*` tag, which publishes `@drawcall/animate` at that version.
