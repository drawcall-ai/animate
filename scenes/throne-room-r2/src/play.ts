import { Group, type Object3D, PerspectiveCamera } from 'three';
import { runTimeline } from '@pmndrs/timeline';
import type { Body } from '@drawcall/animate';
import type { Beat, Staged } from './beats';
import { castBodies, createCast, type Dress } from './cast';
import { createMarks } from './hall';
import { Sound } from './film/sound';

/** what a beat that films itself plays through: the story camera, the sound (its listener on that camera) and the hall's chamber */
export interface View {
  camera: PerspectiveCamera;
  sound: Sound;
  hall?: Object3D;
  /** whether crowds' bodies run their development checks (default true) */
  checkCrowds?: boolean;
}

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
  /** what the beat returned from staging (whether it is filmed, how to undo it) */
  staged: Staged;
  view: View;
}

/** sets `beat` up in a scene of its own; without a `view` (headless) its camera is one nobody looks through and its sound only logs */
export function play(beat: Beat, dress?: Dress, view: View = { camera: new PerspectiveCamera(), sound: new Sound() }): Playing {
  const scene = new Group();
  const marks = createMarks();
  beat.arrange?.(marks);
  scene.add(...Object.values(marks));
  const cast = createCast(marks, dress, beat.starts);
  for (const body of castBodies(cast)) scene.add(body.object);
  scene.updateMatrixWorld(true);
  view.sound.reset(scene);
  const staged = beat.stage({ scene, marks, cast, dress: dress ?? (() => undefined), camera: view.camera, sound: view.sound, hall: view.hall, checkCrowds: view.checkCrowds ?? true });
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
      view.sound.advance(seconds);
    },
    finished: () => finished,
    done: staged.done,
    staged,
    view,
  };
  return playing;
}
