import { Group } from 'three';
import { runTimeline } from '@pmndrs/timeline';
import type { Body } from '@drawcall/animate';
import type { Beat } from './beats';
import { castBodies, createCast, type Dress } from './cast';
import { createMarks } from './hall';

/** A beat set up and ready to step: the same for the viewer and headless runs. */
export interface Playing {
  beat: Beat;
  scene: Group;
  bodies: Body[];
  /** seconds played */
  time: number;
  /** advances the story, then every body, by `seconds` */
  step(seconds: number): void;
  /** whether the story has returned */
  finished(): boolean;
  /** whether the beat reached its end state */
  done(): boolean;
}

export function play(beat: Beat, dress?: Dress): Playing {
  const scene = new Group();
  const marks = createMarks();
  scene.add(...Object.values(marks));
  const cast = createCast(marks, dress, beat.starts);
  for (const body of castBodies(cast)) scene.add(body.object);
  scene.updateMatrixWorld(true);
  const staged = beat.stage({ scene, marks, cast, dress: dress ?? (() => undefined) });
  const extras = staged.extras ?? [];
  for (const body of extras) if (!body.object.parent) scene.add(body.object);
  scene.updateMatrixWorld(true);
  let finished = false;
  const update = runTimeline(function* () {
    yield* staged.story();
    finished = true;
  });
  const playing: Playing = {
    beat,
    scene,
    bodies: [...castBodies(cast), ...extras],
    time: 0,
    step(seconds) {
      update(undefined, seconds);
      for (const body of playing.bodies) body.update(seconds);
      staged.afterStep?.(seconds);
      playing.time += seconds;
    },
    finished: () => finished,
    done: staged.done,
  };
  return playing;
}
