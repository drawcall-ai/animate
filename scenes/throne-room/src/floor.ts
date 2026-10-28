import { Vector3 } from 'three';
import type { Body } from '@drawcall/animate';

/**
 * Stands bodies on a stepped floor. The library walks every body on the plane y = 0 (a body's `at.y`, a target's y and a driven root's
 * y are all dropped), so each body is raised after its update to the floor under its planted feet: it rises a step when a foot lands
 * on a higher tread. Its swinging foot still moves as over a flat floor, so a foot can brush a riser on the way up.
 *
 * The bodies think they stand at y = 0, so everything they aim at must be told in their own frame: `seenBy` lowers a world point by
 * the raise of the body looking or reaching, and `eyesOf` lifts a body's eyes (as the library reports them) by its raise.
 */
export interface Floor {
  /** raises every body to the floor under it; call after the bodies' update, each step (s) */
  update(seconds: number): void;
  /** how high `body` stands now (m) */
  heightOf(body: Body): number;
  /** a world point as `body` must be asked to aim at it: lowered by `body`'s raise (written into `point`) */
  seenBy(body: Body, point: Vector3): Vector3;
  /** where `body`'s eyes are in the world (written into `out`) */
  eyesOf(body: Body, out: Vector3): Vector3;
}

/** how quickly a body rises onto a higher tread (s): the time a foot takes to take the weight */
const RISE_TIME = 0.12;

export function createFloor(bodies: readonly Body[], heightAt: (z: number) => number): Floor {
  const heights = new Map<Body, number>();
  const under = (body: Body) => {
    const planted = body.feet.filter((foot) => foot.planted);
    if (!planted.length) return heights.get(body) ?? heightAt(body.position.z);
    // the highest tread a planted foot is on: the body's weight goes onto it
    return Math.max(...planted.map((foot) => heightAt(foot.position.z)));
  };
  const place = (body: Body) => {
    body.object.position.y = heights.get(body)!;
    body.object.updateMatrixWorld(true);
  };
  for (const body of bodies) {
    heights.set(body, under(body));
    place(body);
  }
  return {
    update(seconds) {
      const ease = 1 - Math.exp(-seconds / RISE_TIME);
      for (const body of bodies) {
        const height = heights.get(body)!;
        heights.set(body, height + (under(body) - height) * ease);
        place(body);
      }
    },
    heightOf: (body) => heights.get(body) ?? 0,
    seenBy: (body, point) => point.setY(point.y - (heights.get(body) ?? 0)),
    eyesOf(body, out) {
      const gaze = body.species.gaze;
      if (!gaze) throw new Error('that body has no eyes');
      return gaze.eyes(body.pose, out).setY(out.y + (heights.get(body) ?? 0));
    },
  };
}
