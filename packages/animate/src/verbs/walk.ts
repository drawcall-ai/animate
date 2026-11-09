import { during, type Miss, type Request } from '../kernel/requests';
import { Body, selfOf } from '../body/body';
import type { Self } from '../body/runtime';
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
  /**
   * how fast it may go (m/s; default a stroll's 1.3, slower with a load; where the floor rises or falls on its way — stairs — at most 0.7 ×
   * its scale, a person's height over the default 1.75 m, so a group sharing a climbing speed keeps under its smallest body's cap). An upper
   * limit: it gets there with room to, speeding up and braking quicker the faster it is asked. On a straight, asking faster does not arrive
   * later, within its last step or so; a walk that turns first or arrives turned goes as its turn lets it, and may. Its gait follows: a
   * person breaks into a run from 2 m/s, running by 3, and goes 4 m/s at most (× √ its legs' length); a creature as fast as its legs keep up.
   * Ending on arriving, held well short of a speed above a stroll it had the room for, it says so in its dev log (`walk speed not reached`).
   */
  speed?: number;
  /** ends on this instead of arriving (`true` if it stands there as it ends, turned; else `false`): a target that moves is followed until
   * then; it still throws if the walk stalls short of a target standing still */
  until?: Until;
}

/**
 * Walks to `target` (exactly there, on the floor under it: to stand within reach of something, `grab` or `reach` it), turning to
 * arrive facing as asked: a mover, it ends once there (within 15 cm × its scale, or a creature as near as its legs bring it), turned and
 * settled — its feet squared, a second or two after the body is there; end it on `until: arriving(body, 0.5)` to start what follows sooner.
 * It throws `Missed` if it stalls, `until` or not: no nearer a target standing still for 6 s (saying whether the body stood there and its
 * feet never settled). A body is no target: give one of its bones, or a point. It asks for the legs. A point or an empty off the floor
 * under it warns once on the console.
 */
export function walkTo(body: Body, target: Target, options: WalkOptions = {}): Verb {
  const { face, speed, until } = options;
  if (target instanceof Body) throw new Error('walkTo: a body is no target: give a point beside it (`other.position`), or one of its bones');
  if (speed !== undefined && !(Number.isFinite(speed) && speed > 0)) throw new Error(`walkTo: speed ${speed} is no pace`);
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
      if (mark && height > OFF_FLOOR) self.warn('walk target', `a walk target is ${height.toFixed(2)} m off the floor under it: its height is ignored`);
      return found.position;
    };
    const walk = new Walk(self, { to, face: yaw, velocity: (f) => find(f).velocity, speed, backs: true }, until === undefined);
    request.there = () => walk.stands(self.frame);
    const step = (f: Frame) => {
      const go = walk.step(f);
      request.eta = walk.ends;
      return go;
    };
    // (given `until`, it follows its target, however it moves, until then — or it stalls short of one standing still)
    if (until !== undefined) yield* during(request, 'go', 'asked', step, () => walk.stall !== null);
    else yield* during(request, 'go', 'asked', step, (f, _, time) => time > 0 && (walk.arrived(f) || walk.stall !== null));
    walk.report(self.frame);
    if (walk.stall) request.fail(stallOf(self, request, walk.stall));
    else request.met();
    // (there, the legs are its, standing, till its story moves on)
    yield* during(request, 'go', 'asked', () => {});
  }, { until });
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

/** what a walk of `request`'s stalled of: a newer verb taking the legs is why it got no nearer, whatever it looked like from here */
export function stallOf(self: Self, request: Request, stall: Miss): Miss {
  const over = self.owner('go')?.request;
  return over && over !== request ? { ...stall, why: `${over.label} took the legs from it` } : stall;
}
