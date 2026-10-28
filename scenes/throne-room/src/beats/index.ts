import type { Group } from 'three';
import type { ReusableTimeline } from '@pmndrs/timeline';
import type { Body } from '@drawcall/animate';
import type { Cast, Dress } from '../cast';
import type { Marks } from '../hall';

/** What a beat is given: the hall's scene (the cast already in it), its marks and the cast at their marks. */
export interface Setting {
  scene: Group;
  marks: Marks;
  cast: Cast;
  dress: Dress;
}

/** One beat of the scene, playable on its own in the viewer and headless. */
export interface Beat {
  id: string;
  title: string;
  /** how long the beat may take (s); a run that has not finished by then failed */
  duration: number;
  /** where cast members start, if not at their default marks (the heroes default to the doors, the rest to the dais) */
  starts?: Partial<Record<keyof Cast, keyof Marks>>;
  /** adds what the beat needs to the setting (props, extra bodies) and returns its story */
  stage(setting: Setting): Staged;
}

export interface Staged {
  story: ReusableTimeline<unknown, unknown>;
  /** bodies the beat added besides the cast (they are stepped and drawn like the cast) */
  extras?: Body[];
  /** whether the beat reached its end state */
  done(): boolean;
}

/** The beats the viewer lists: every other module in this folder exports one as `beat`, ordered by `order` (scene order). */
export const BEATS: Beat[] = Object.values(import.meta.glob<{ beat: Beat & { order?: number } }>(['./*.ts', '!./index.ts'], { eager: true }))
  .map((module) => module.beat)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
