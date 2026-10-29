import type { Group, Object3D, PerspectiveCamera } from 'three';
import type { ReusableTimeline } from '@pmndrs/timeline';
import type { Body } from '@drawcall/animate';
import type { Cast, Dress } from '../cast';
import type { Marks } from '../hall';
import type { Sound } from '../film/sound';

/**
 * What a beat is given: the hall's scene (the cast already in it), its marks and the cast at their marks; and, for a beat that films
 * itself, the story camera, the sound and the hall's chamber. Headless, the camera is one nobody looks through, the sound only logs
 * its cues and there is no chamber.
 */
export interface Setting {
  scene: Group;
  marks: Marks;
  cast: Cast;
  dress: Dress;
  camera: PerspectiveCamera;
  sound: Sound;
  hall?: Object3D;
}

/** One beat of the scene, playable on its own in the viewer and headless. */
export interface Beat {
  id: string;
  title: string;
  /** how long the beat may take (s); a run that has not finished by then failed */
  duration: number;
  /** where cast members start, if not at their default marks (the heroes default to the doors, the rest to the dais) */
  starts?: Partial<Record<keyof Cast, keyof Marks>>;
  /** moves marks before the cast is stood on them (a beat that starts its cast somewhere no mark is) */
  arrange?(marks: Marks): void;
  /** adds what the beat needs to the setting (props, extra bodies) and returns its story */
  stage(setting: Setting): Staged;
}

export interface Staged {
  story: ReusableTimeline<unknown, unknown>;
  /** bodies the beat added besides the cast (they are stepped and drawn like the cast) */
  extras?: Body[];
  /** whether the beat reached its end state */
  done(): boolean;
  /** runs after every body has updated, each step (s): what follows the bodies as they are drawn (the camera, drawn things, sounds) */
  afterStep?(seconds: number): void;
  /** whether the story moves the camera (the viewer then looks through it) */
  filmed?: boolean;
  /** undoes what the beat changed outside its scene (the hall), when the viewer replaces it */
  dispose?(): void;
}

/** The beats the viewer lists: every other module in this folder exports one as `beat`, ordered by `order` (scene order). */
export const BEATS: Beat[] = Object.values(import.meta.glob<{ beat: Beat & { order?: number } }>(['./*.ts', '!./index.ts'], { eager: true }))
  .map((module) => module.beat)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
