// What the stories ask of each body right now, as the metrics read it: the target of a running `lookAt` ('gaze'), of a `reach` for each
// hand ('leftWrist', 'rightWrist') and of a `track` ('head' and the wrists). `asked.ts` records them by wrapping the verbs, so a story
// reports nothing itself.
import { Vector3, type Object3D } from 'three';
import type { Body, Target, Verb } from '@drawcall/animate';

const goals = new WeakMap<Body, Map<string, Target>>();

/** `verb`, run as it is, with `body`'s goals `named` asked for as long as it runs */
export function* asking(body: Body, named: Readonly<Record<string, Target | undefined>>, verb: Verb): Verb {
  const mine = goals.get(body) ?? new Map<string, Target>();
  goals.set(body, mine);
  const entries = Object.entries(named).filter((entry): entry is [string, Target] => entry[1] !== undefined);
  for (const [name, target] of entries) mine.set(name, target);
  try {
    return yield* verb;
  } finally {
    for (const [name, target] of entries) if (mine.get(name) === target) mine.delete(name);
  }
}

/** what `body`'s stories ask of it now, each goal where it is (world) at the body's `time` (s) */
export function askedOf(body: Body, time: number): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  for (const [name, target] of goals.get(body) ?? []) out.set(name, pointOf(typeof target === 'function' ? target(time) : target));
  return out;
}

const pointOf = (at: Vector3 | Object3D) => (at instanceof Vector3 ? at.clone() : at.getWorldPosition(new Vector3()));
