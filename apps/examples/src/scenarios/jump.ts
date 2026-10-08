import { MathUtils, Vector3 } from 'three';
import type { Box } from '@prohuman/core';
import type { Scenario } from '../scenario';
import { vec } from '../math';

const { clamp, smoothstep } = MathUtils;

/** the ditch (× body height): its near edge ahead of the start, its width (1 m for a 1.75 m body), how far it runs across (m) and how deep it is drawn */
const DITCH = { at: 1.6, width: 0.57, across: 3, depth: 0.4 };
/** the walk-to point stops this far past the far edge (× body height) */
const BEYOND = 1.8;

export const jump: Scenario = {
  id: 'jump',
  title: 'Jumping a ditch',
  drives: 'a walk-to point + a ditch (a floor obstacle)',
  description:
    'A walk-to point moves straight across a ditch too wide to step over (a 1 cm floor obstacle, drawn as a pit, sized to the body). Nobody scripts the jump: the walk stops at the edge with the feet together, the body sinks and swings its arms back, drives up and forward with the arms leading, flies a ballistic arc with the knees tucked and the legs reaching forward, lands on both heels, sinks to absorb it and walks on.',
  duration: 11,
  actors: [{}],
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    // (sized once the body is known)
    let ditch: Box | null = null;
    const pit = { position: new Vector3(), size: new Vector3() };
    return {
      inputs(t, dt, [{ proportions: p }]) {
        const H = p.height;
        if (!ditch) {
          ditch = { min: vec(-DITCH.across / 2, 0, DITCH.at * H), max: vec(DITCH.across / 2, 0.01, (DITCH.at + DITCH.width) * H) };
          pit.position.set(0, 0, (DITCH.at + DITCH.width / 2) * H);
          pit.size.set(DITCH.across, DITCH.depth, DITCH.width * H);
        }
        const end = (DITCH.at + DITCH.width + BEYOND) * H;
        // (easing into its stop, like someone arriving somewhere)
        s += 1.0 * smoothstep(t, 0.5, 1.8) * clamp((end - s) / 1.2, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, floorObstacles: [ditch] }];
      },
      props: () => (ditch ? [{ kind: 'pit', position: pit.position, size: pit.size }] : []),
    };
  },
};
