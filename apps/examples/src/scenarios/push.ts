import { Box3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { Scenario } from '../scenario';
import { minimumJerk, vec } from '../math';

const { smoothstep } = MathUtils;

/** the crate (m): its near face along +z at the start, width, depth, height */
const CRATE = { at: 1.2, width: 1, depth: 1, height: 1.1 };
/** the hands on its near face: this high, this far apart; the wrists this far off it (m) */
const GRIP = { height: 1, apart: 0.46, off: 0.035 };
/**
 * The script (s, m, m/s² — the force the hands exert per kg of body mass): the hands take
 * hold, the push builds up and the crate slides on slowly, stops; then the body pulls it back
 * a little and lets go. A heavy crate on a concrete floor: sliding friction ~0.4 × its weight,
 * 150 kg → ~600 N, ~8 m/s² for a 75 kg body — past what anyone pushes steadily; ~3.5 is a hard
 * sustained push (Snook & Ciriello 1991: sustained push forces 200–300 N).
 */
const HOLD = 2;
const PUSH = { from: 2.8, speed: 0.45, force: 3.5, distance: 3 };
const PULL = { from: 11, speed: 0.15, force: -2.5, distance: 0.6 };
const LET_GO = 16;

/** a hand's rotation with its palm on the face (forward, +z) and its fingers up (VRM hands at rest point out along ±x, the palms down) */
function palmForward(side: number): Quaternion {
  const x = new Vector3(0, side, 0);
  const y = new Vector3(0, 0, -1);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

/** how far along a move of `distance` at `speed`, easing in and out over a second, `t` s after it began (m) */
function slide(t: number, speed: number, distance: number): number {
  const T = distance / speed + 1;
  return distance * minimumJerk(t / T);
}

export const push: Scenario = {
  id: 'push',
  title: 'Pushing a heavy crate',
  drives: 'both hands (on the crate) + the force they exert + the crate (a floor obstacle)',
  description:
    'Hand targets on the near face of a heavy crate and the force the hands exert on it are given; the crate slides only as the body pushes. Nobody scripts the body: it leans into the crate with its centre of mass well ahead of its feet, as a hard push needs, the arms braced, and walks it forward with short steps; then pulls it back a little, leaning away, and lets go.',
  duration: 18,
  actors: [{}],
  cameraDistance: 4,
  create() {
    const crate = new Box3();
    const at = new Vector3();
    const force = new Vector3();
    const rots = [palmForward(1), palmForward(-1)];
    const grips = [new Vector3(), new Vector3()];
    return {
      inputs(t) {
        const z = CRATE.at + slide(t - PUSH.from - 1, PUSH.speed, PUSH.distance) - slide(t - PULL.from - 1, PULL.speed, PULL.distance);
        crate.set(vec(-CRATE.width / 2, 0, z), vec(CRATE.width / 2, CRATE.height, z + CRATE.depth));
        at.set(0, GRIP.height, z - GRIP.off);
        // the push builds up over a second and a half as the crate starts to give, and eases off as it stops; the pull likewise
        const pushing = smoothstep(t, PUSH.from - 0.5, PUSH.from + 1) * (1 - smoothstep(t, PULL.from - 2.5, PULL.from - 1.5));
        const pulling = smoothstep(t, PULL.from - 0.5, PULL.from + 1) * (1 - smoothstep(t, LET_GO - 2, LET_GO - 1));
        force.set(0, 0, PUSH.force * pushing + PULL.force * pulling);
        const w = smoothstep(t, 0.5, HOLD) * (1 - smoothstep(t, LET_GO, LET_GO + 0.5));
        grips[0].set(GRIP.apart / 2, 0, 0).add(at);
        grips[1].set(-GRIP.apart / 2, 0, 0).add(at);
        return [
          {
            leftHand: { position: grips[0], quaternion: rots[0], weight: w },
            rightHand: { position: grips[1], quaternion: rots[1], weight: w },
            handForce: force,
            floorObstacles: [crate],
          },
        ];
      },
      props: () => [{ kind: 'box', position: crate.getCenter(vec(0, 0, 0)), size: crate.getSize(vec(0, 0, 0)) }],
    };
  },
};
