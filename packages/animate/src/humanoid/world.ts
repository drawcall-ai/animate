import type { Pose } from '../core/pose';

/**
 * The world the actors share, as plain data the behaviours read (and the app keeps up to date):
 * `bodies`, every actor's final pose of the last frame, by actor (bodies read each other only
 * through these, so the order they update in changes nothing).
 */
export interface World {
  bodies: Pose[];
}

/** A world of `parts`, empty otherwise. */
export function createWorld(parts: Partial<World> = {}): World {
  return { bodies: [], ...parts };
}
