# Throne Room

The closing scene of *Star Wars: A New Hope* (1977), built with @drawcall/animate: the Royal Award Ceremony in the Grand Audience Chamber of the Massassi temple on Yavin 4. It tests the library at every level, from single bones to a crowd.

## The scene, as filmed

1. **Entrance.** Huge doors open. Luke (centre), Han (on his left) and Chewbacca (on his right) walk up the long central aisle side by side, at a slow ceremonial pace. Han swaggers slightly; Luke looks around, a little awed; Chewbacca lumbers.
2. **The troops.** Hundreds of Rebel troops in khaki uniforms stand in tight ranks on both sides of the aisle, facing it, at attention. Officers stand at the front of the blocks. The heroes walk between them.
3. **The steps.** At the far end the trio climbs the steps to the dais and stops on the step below Leia.
4. **The dais.** Leia, in a white gown, stands at the centre. Dodonna and other officers stand beside her. C-3PO, polished gold, stands to one side next to a freshly repaired R2-D2, which rocks on its legs, turns its dome and whistles.
5. **The medals.** Leia takes a medal from an officer and hangs it around Luke's neck as he bows his head slightly. She does the same for Han, who winks at her. Chewbacca throws his head back and roars; Leia smiles.
6. **The finale.** The trio turns around to face the hall. The troops turn toward them and break into applause and cheers.

## The film

The `film` beat (the viewer's default) plays the whole scene as one film, cut and moved by a story camera ([src/film/camera.ts](src/film/camera.ts)) with sound ([src/film/sound.ts](src/film/sound.ts)): the doors open on the trio, they walk up the aisle and climb to Leia, the bearer hands her each medal and she lifts it on its ribbon over the hero's bowed head (Luke bows, Han tilts his head and winks, Chewbacca roars), and the trio turns to the hall as the troops applaud. It composes the other beats ([src/beats/film.ts](src/beats/film.ts) says how). It waits for a click on **Play with sound**, since browsers start audio only after one; **Orbit** looks around the hall from wherever the story camera is, and **Story camera** goes back to it.

## Layout

[src/hall.ts](src/hall.ts) holds the hall's dimensions, the stepped floor heights (`floorAt`) and named placement empties (`createMarks`). The doors are at the origin, the aisle runs along +Z to the steps, and the dais is 1 m high. `createHall` builds the textured chamber around them: 30 m walls, high windows, a beamed ceiling and the open doors (textures in public/models/hall-*). The viewer lights it with sun and sky and gives polished surfaces (C-3PO, R2's dome, the medals) an environment of the hall's colours to mirror.

## Code

- [src/cast.ts](src/cast.ts) creates the named characters, each on the skeleton measured for its own model ([src/skeletons/](src/skeletons/), models under `public/models/`); Han swaggers and Chewbacca lumbers (`stride`). R2-D2 is a creature of its own ([src/droids/](src/droids/)).
- [src/troops.ts](src/troops.ts) fills the ranks: khaki troopers (`trooper.glb`, a light 6k-triangle model) with an officer before each block. The officers, the front rank and half the second are simulated bodies, each with its own seed, reaction and clapping; the rest replay a random one of their block's poses up to 1.2 s later. The viewer runs the troops without development checks (the headless tests keep them) to hold 60 Hz.
- [src/gestures.ts](src/gestures.ts) holds the medal moment's gestures (bow, wink, roar, nod), each a look beside a `pose`.
- [src/models.ts](src/models.ts) lists each skeleton with the model measured for it.
- [src/beats/](src/beats/): each module exports one `beat` (see [src/beats/index.ts](src/beats/index.ts)) that the viewer lists and the headless test plays.
- [src/play.ts](src/play.ts) sets up a beat and steps its story and bodies at 60 Hz.

## Commands

From this folder:

- `pnpm dev` runs the viewer at http://localhost:5290/?beat=<id> (`&at=<s>` plays that far and pauses; `&cam=x,y,z,tx,ty,tz` places the camera and orbits).
- `node scripts/shot.mjs <beat> <out.png> [at] [cam]` saves a frame; several times (`10,20.5,30`) save `<out>-<at>.png` each from one page. `PORT=<n>` uses (or starts) a server on another port.
- `pnpm test` plays every beat headless; `FILM_PROBE=1 pnpm test film` prints the film's events, shots and sound cues with their times. `pnpm typecheck` checks types.

The scene uses the built package (`dist`), as an npm user would. After a library change, run `pnpm -F @drawcall/animate build` from the repository root.
