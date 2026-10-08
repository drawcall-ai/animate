import { Box3, MathUtils } from 'three';
import type { Prop, Scenario } from '../scenario';
import { vec } from '../math';

/** a low tunnel along +z (m): where it begins and ends, its walls' inner faces and thickness, the slab above */
const TUNNEL = { from: 3.5, to: 6.5, halfWidth: 0.6, wall: 0.08, slab: 0.8 };
/** its ceiling's underside (× the body's height): every body ducks alike */
const CEILING = 0.8;
/** where the walk-to point comes to rest (m along z) */
const END = 11;

const { from, to, halfWidth, wall, slab } = TUNNEL;
const outer = halfWidth + wall;

export const crouch: Scenario = {
  id: 'crouch',
  title: 'Ducking through a low tunnel',
  drives: 'a walk-to point + a ceiling box',
  description:
    'A walk-to point moves straight through a tunnel 0.8 × the body’s height; its ceiling is a box the trunk and head keep clear of. Nobody scripts the duck: seeing the ceiling coming, the body stoops just before the entrance — the trunk bent forward, the knees a little, the head up looking ahead — walks through with shorter steps and a smaller arm swing, and straightens up after the exit.',
  duration: 15,
  actors: [{}],
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    const ceiling = new Box3(vec(-outer, 0, from), vec(outer, 0, to));
    const walls = [-1, 1].map((side) => new Box3(vec(side < 0 ? -outer : halfWidth, 0, from), vec(side < 0 ? -halfWidth : outer, 0, to)));
    const box = (b: Box3): Prop => ({ kind: 'box', position: b.getCenter(vec(0, 0, 0)), size: b.getSize(vec(0, 0, 0)), ghost: true });
    const shape = (height: number) => {
      ceiling.min.y = CEILING * height;
      ceiling.max.y = ceiling.min.y + slab;
      for (const w of walls) w.max.y = ceiling.min.y;
    };
    shape(1.75);
    return {
      inputs(t, dt, [{ proportions: p }]) {
        shape(p.height);
        // (easing into its stop, like someone arriving somewhere)
        s += 1.0 * MathUtils.smoothstep(t, 0.5, 1.8) * MathUtils.clamp((END - s) / 1.2, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, bodyObstacles: [ceiling], floorObstacles: walls }];
      },
      props: () => [ceiling, ...walls].map(box),
    };
  },
};
