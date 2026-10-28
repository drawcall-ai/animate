import { during } from '../kernel/requests';
import { selfOf, type Body } from '../body/body';
import type { Frame } from '../kernel/frame';
import { OFF_FLOOR } from '../kernel/dev';
import { bodyOf } from '../things/hold';
import { headingOf, headingOfTurn } from '../kernel/math';
import { Walk } from '../legs/walk';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a walk goes. */
export interface WalkOptions {
  /** the facing to arrive with: an angle (rad about +Y; 0 faces +Z) or a target to face; default the target's own (an `Object3D`'s), else the way it comes */
  face?: number | Target;
  /** its top speed (m/s; default a stroll's 1.3, slower with a load; where the floor rises or falls on its way — stairs — at most 0.7) */
  speed?: number;
  /** how quickly it speeds up (m/s²; default 1.2) */
  accel?: number;
  /** ends on this instead of arriving: a target that moves is followed until then */
  until?: Until;
}

/**
 * Walks to `target` (exactly there, on the floor under it: to stand within reach of something, `grab` or `reach` it), turning to
 * arrive facing as asked: a mover, it ends once there, turned and settled. It asks for the legs. It returns `false` if the walk stalls:
 * no nearer for 6 s. A point or an empty off the floor under it is said once in the dev log.
 */
export function walkTo(body: Body, target: Target, options: WalkOptions = {}): Verb {
  const { face, speed, accel, until } = options;
  for (const [name, value] of [['speed', speed], ['accel', accel]] as const) {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) throw new Error(`walkTo: ${name} ${value} is no pace`);
  }
  if (typeof face === 'number' && !Number.isFinite(face)) throw new Error('walkTo: the facing is no angle');
  return verb(body, 'walkTo', (request) => function* () {
    const self = selfOf(body);
    if (self.drive) throw new Error('walkTo: the body walks where its app drives it');
    const find = finder(self, target), facing = typeof face === 'number' || face === undefined ? null : finder(self, face);
    const yaw = (f: Frame): number | null => {
      if (typeof face === 'number') return face;
      if (facing) {
        const at = facing(f).position, from = f.prev.position(0);
        return headingOf(at.x - from.x, at.z - from.z);
      }
      const turn = find(f).quaternion;
      return turn ? headingOfTurn(turn) : null;
    };
    // (a target above or below the floor is walked to where it is over the floor. A thing or a body walked to is above it as things
    // are; a point or an empty — a mark to stand on — off it says so, once)
    const to = (f: Frame) => {
      const found = find(f), at = found.position, height = Math.abs(at.y - self.floor(at.x, at.z));
      const mark = !found.object || (found.object.type === 'Object3D' && !bodyOf(found.object));
      if (mark && height > OFF_FLOOR) {
        f.dev?.once(f.time, { check: 'walk target off the floor, its height ignored (m)', value: height, limit: OFF_FLOOR, where: 'target' });
      }
      return found.position;
    };
    const walk = new Walk(self, { to, face: yaw, velocity: (f) => find(f).velocity, speed, accel }, until === undefined);
    const step = (f: Frame) => {
      const go = walk.step(f);
      request.eta = walk.ends;
      return go;
    };
    // (given `until`, it follows its target, however it moves, until then)
    if (until !== undefined) yield* during(request, 'go', 'asked', step);
    yield* during(request, 'go', 'asked', step, (f, _, time) => time > 0 && (walk.arrived(f) || walk.stalled));
    if (walk.stalled) request.fail();
    else request.met();
    // (there, the legs are its, standing, till its story moves on)
    yield* during(request, 'go', 'asked', () => {});
  }, until);
}

/**
 * A condition for `wait` and `until`: true once what `body`'s stories move it toward (its walk, its hands, what it carries) will arrive
 * within `seconds` — or, moving nothing, once it has come to rest. What the body does of itself (its hands backing out of what they let
 * go) does not hold it up.
 */
export function arriving(body: Body, seconds: number): () => boolean {
  const self = selfOf(body);
  return () => {
    const movers = self.requests.filter((request) => !request.aimer && !request.owned && request.outcome === 'running');
    return movers.length ? movers.every((request) => request.eta <= seconds) : self.locomotion.settled;
  };
}
