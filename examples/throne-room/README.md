# Throne Room

The closing scene of *Star Wars: A New Hope* (1977), built with @drawcall/animate: the Royal Award Ceremony in the Grand Audience Chamber of the Massassi temple on Yavin 4. It tests the library at every level, from single bones to a crowd.

## Commands

From this folder:

- `pnpm dev` runs the viewer at http://localhost:5290/?beat=<id> (`&at=<s>` plays that far and pauses; `&cam=x,y,z,tx,ty,tz` places the camera and orbits).
- `node scripts/shot.mjs <beat> <out.png> [at] [cam]` saves a frame; several times (`10,20.5,30`) save `<out>-<at>.png` each from one page. `PORT=<n>` uses (or starts) a server on another port.
- `pnpm test` plays every beat headless; `FILM_PROBE=1 pnpm test film` prints the film's events, shots and sound cues with their times. `pnpm typecheck` checks types.
