import type { ReadonlyPose } from '../core/pose';

/**
 * The world the actors share, as plain data the behaviours read (and the app keeps up to date):
 * `bodies`, all humanoids' and other bodies' final poses from the last frame (bodies read each other only
 * through these, so the order they update in changes nothing).
 */
export interface World {
  bodies: ReadonlyPose[];
}

/** A world of `parts`, empty otherwise. */
export function createWorld(parts: Partial<World> = {}): World {
  return { bodies: [], ...parts };
}
