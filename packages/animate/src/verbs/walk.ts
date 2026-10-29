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
  /**
   * the facing to arrive with: an angle (rad about +Y; 0 faces +Z) or a target to face; default the target's own (an `Object3D`'s), else
   * the way it comes. The body faces the way it walks and turns to this only over its last step or so — but a few steps back or aside
   * (under ~1.45 m at a stroll's pace, a few steps: less at a slower `speed`) asked to face within ~45° of how it faces keeps its facing all
   * the way, backing or side-stepping at ~⅔–¾ of its pace. A walk to where the body stands turns it on the spot (on a tread, its feet keep to it,
   * toes over the nosing if the tread is shorter than the foot); an about-turn goes round the side the body looks to (its head turned
   * past ~9°), else to the right. A target to face that moves re-aims the steps mid-swing, so turn to a fixed angle or point.
   */
  face?: number | Target;
  /** its top speed (m/s; default a stroll's 1.3, slower with a load; where the floor rises or falls on its way — stairs — at most 0.7 ×
   * its scale, a person's height over the default 1.75 m, so a group sharing a climbing speed keeps under its smallest body's cap) */
  speed?: number;
  /** how quickly it speeds up (m/s²; default 1.2) */
  accel?: number;
  /** ends on this instead of arriving (`true`, arrived or not): a target that moves is followed until then; still `false` if the walk stalls
   * short of a target standing still */
  until?: Until;
}

/**
 * Walks to `target` (exactly there, on the floor under it: to stand within reach of something, `grab` or `reach` it), turning to
 * arrive facing as asked: a mover, it ends once there, turned and settled — its feet squared, a second or two after the body is there; end
 * it on `until: arriving(body, 0.5)` to start what follows sooner. Given `until`, it returns `true` once that holds, arrived or not —
 * still walking after a target that moves, it stops where it is. It returns `false` if it stalls, `until` or not: no nearer a target
 * standing still for 6 s (said once in the dev log, with whether the body stood there and its feet never settled). It asks for the legs.
 * A point or an empty off the floor under it is said once in the dev log.
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
    const walk = new Walk(self, { to, face: yaw, velocity: (f) => find(f).velocity, speed, accel, backs: true }, until === undefined);
    const step = (f: Frame) => {
      const go = walk.step(f);
      request.eta = walk.ends;
      return go;
    };
    // (given `until`, it follows its target, however it moves, until then — or it stalls short of one standing still)
    if (until !== undefined) yield* during(request, 'go', 'asked', step, () => walk.stalled);
    else yield* during(request, 'go', 'asked', step, (f, _, time) => time > 0 && (walk.arrived(f) || walk.stalled));
    if (walk.stalled) request.fail();
    else request.met();
    // (there, the legs are its, standing, till its story moves on)
    yield* during(request, 'go', 'asked', () => {});
  }, until, false, true);
}

/**
 * A condition for `wait` and `until`: true once what `body`'s stories have begun moving it toward since the condition was made (that
 * instant included: a walk asked beside it counts) — its walk, its hands, what it carries — will arrive within `seconds`, or has (each
 * mover that has ended counts as there). False until one begins: made before or beside a walk, it waits for that walk, so it reads the
 * same however the story's branches are ordered. What the body does of itself (its hands backing out of what they let go) does not hold
 * it up. To wait until the body is at rest, `wait(() => body.settled)`.
 */
export function arriving(body: Body, seconds: number): () => boolean {
  const self = selfOf(body), since = self.time;
  return () => self.lastMover >= since && self.requests.every((request) =>
    request.aimer || request.owned || request.filed < since || request.outcome !== 'running' || request.eta <= seconds);
}
