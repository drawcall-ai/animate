# Throne Room

The closing scene of *Star Wars: A New Hope* (1977), built with @drawcall/animate: the Royal Award Ceremony in the Grand Audience Chamber of the Massassi temple on Yavin 4. It tests the library at every level, from single bones to a crowd.

## The scene, as filmed

1. **Entrance.** Huge doors open. Luke (centre), Han (on his left) and Chewbacca (on his right) walk up the long central aisle side by side, at a slow ceremonial pace. Han swaggers slightly; Luke looks around, a little awed; Chewbacca lumbers.
2. **The troops.** Hundreds of Rebel troops in khaki uniforms stand in tight ranks on both sides of the aisle, facing it, at attention. Officers stand at the front of the blocks. The heroes walk between them.
3. **The steps.** At the far end the trio climbs the steps to the dais and stops on the step below Leia.
4. **The dais.** Leia, in a white gown, stands at the centre. Dodonna and other officers stand beside her. C-3PO, polished gold, stands to one side next to a freshly repaired R2-D2, which rocks on its legs, turns its dome and whistles.
5. **The medals.** Leia takes a medal from an officer and hangs it around Luke's neck as he bows his head slightly. She does the same for Han, who winks at her. Chewbacca throws his head back and roars; Leia smiles.
6. **The finale.** The trio turns around to face the hall. The troops turn toward them and break into applause and cheers.

## Layout

[src/hall.ts](src/hall.ts) holds the hall's dimensions, the stepped floor heights (`floorAt`) and named placement empties (`createMarks`). The doors are at the origin, the aisle runs along +Z to the steps, and the dais is 1 m high.

## Code

- [src/cast.ts](src/cast.ts) creates the named characters, each on the skeleton measured for its rigged model. R2-D2 is a scaled-person stand-in (an unrigged R2 mesh is `public/models/artoo.glb`); the Rebel trooper's model and skeleton are `public/models/trooper.glb` and `src/skeletons/trooper.ts`.
- [src/models.ts](src/models.ts) lists each skeleton with the model measured for it.
- [src/beats/](src/beats/): each module exports one `beat` (see [src/beats/index.ts](src/beats/index.ts)) that the viewer lists and the headless test plays.
- [src/play.ts](src/play.ts) sets up a beat and steps its story and bodies at 60 Hz. A beat's setting also offers a story camera and positional sound (`src/film/sound.ts`), for beats that film themselves.

## Commands

From this folder:

- `pnpm dev` runs the viewer at http://localhost:5291/?beat=<id> (`&at=<s>` plays that far and pauses; `&cam=x,y,z,tx,ty,tz` places the camera).
- `node scripts/shot.mjs <beat> <out.png> [at] [cam]` saves a frame.
- `pnpm test` plays every beat headless; `pnpm typecheck` checks types.

The scene uses the built package (`dist`), as an npm user would. After a library change, run `pnpm -F @drawcall/animate build` from the repository root.
