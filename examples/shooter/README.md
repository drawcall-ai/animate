# Full-body shooter

A first-person shooter on a training course, where the player and a NavCat-controlled opponent are both full procedural bodies built with `@drawcall/animate`, moved by `@drawcall/physics` capsules and holding a physical rifle.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:shooter
```

Open http://localhost:5289 and click **Enter the course**. Requires a keyboard and mouse.

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Shift | Sprint forward |
| Space | Jump |
| C (hold) | Crouch |
| Right mouse (hold) | Aim |
| Left mouse | Fire |
| R | Reload, throwing the spent magazine away |
| E | Get into the Land Rover by its doorway, or out once stopped; get on the ladder at its foot or top; facing the lift's panel, press its button to send it up or down, or at a landing's post, to call it |
| W / S | Climb up or down (on the ladder), stepping off past either end |
| W / S | Accelerate; brake, then reverse (seated) |
| A / D | Steer (seated) |
| Space | Handbrake (seated) |
| Backspace | Reset the encounter and course |
| Esc | Pause and release the mouse |

The course has stairs, a ramp, raised walkways, step-height blocks, a crouch tunnel, cover, a lift that rides up and down at the press of a button on its panel, or is called by the post at either landing, targets, physics crates and an open-topped military Land Rover to drive.

Serve it with COOP/COEP headers (configured for dev and preview).

```sh
pnpm -F shooter test
pnpm -F shooter typecheck
pnpm -F shooter build
pnpm -F shooter preview
pnpm -F shooter test:browser  # with the dev server running; SHOOTER_CAPTURE_DIR saves screenshots
```
