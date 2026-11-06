import { Object3D, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { selfOf, type Body } from '../body/body';
import { personOf, type Person } from '../body/person';
import { during } from '../kernel/requests';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import { INDEX, sideOf, type Side } from '../species/humanoid/bones';
import { carry } from './carry';
import { pose } from './pose';
import { release, type Released } from './release';
import { verb, wait, type Verb } from './story';

/** How a throw goes. */
export interface ThrowOptions {
  /** the speed it leaves the hand at (m/s; default the least that carries it to the target on a 40° arc, at most `MOST`): what
   * `released` reports, aimed at the target */
  speed?: number;
  /** called as the thing leaves the hand, with how it is moving: the velocity aimed at the target (or as the hand moved it, with no
   * target) and the spin the hand gave it — give them to your physics */
  released?: (motion: Released) => void;
}

/**
 * Throws `thing`, held in one of a person's hands, overhand at `target` (a point, or an object; none: straight ahead): the arm goes out
 * and up and cocks the thing behind the head as the trunk coils away from the target, the weight going onto the back foot and the free
 * arm rising toward the target; then the trunk uncoils ahead of the arm, the weight going forward, and the arm whips the thing over the
 * shoulder, letting go of it ahead of the head on its way down, and follows through down across the body. Every place is the body's own,
 * scaled to it, so any person throws so, along the way it faces: turn it toward the target first (a `lookAt` with `trunk`, or a walk's
 * `face`), the arm aimed at it then. The thing is left in the world
 * where it was let go (`release`); its flight is your physics', from what `released` is given. A mover, it ends `true` once the hand
 * has let go, `false` if no hand holds the thing alone.
 */
export function* throwAt(body: Body, thing: Object3D, target?: Vector3 | Object3D, options: ThrowOptions = {}): Verb {
  const self = selfOf(body), held = Thing.of(thing), hands = handsOn(self, held);
  if (!body.species.person) throw new Error(`throwAt: a ${body.species.name ?? 'custom species'} has no arms to throw with`);
  if (hands.length !== 1) throw new Error(`throwAt: "${thing.name}" is held in ${hands.length} hands; throw what one hand holds`);
  const person = personOf(self), side = sideOf(hands[0]), off: Side = side === 'right' ? 'left' : 'right', x = side === 'right' ? -1 : 1;
  const at = (direction: Vector3, share: number) => () => body.armPoint(side, new Vector3(x * direction.x, direction.y, direction.z), share);
  const freeArm = person.holding[off] ? {} : { arms: { [off]: OFF.raised } };
  const scale = person.proportions.scale;
  // (cocked: out beside the shoulder and up, then back behind the head — straight back, the way passes over the head)
  const cocked = at(COCK.behind, COCK.share);
  yield* parallel('race',
    pose(body, freeArm),
    trunk(body, person, x * COIL.twist, -COIL.bow, -COIL.shift),
    carry(body, thing, [at(COCK.aside, COCK.share), cocked], { speed: COCK.speed * scale, step: false, until: settled(thing, cocked, scale) }));
  // (whipped: the trunk leading the arm round and forward, the arm over the shoulder toward the target, let go ahead of the head)
  const shoulder = () => body.pose.position(INDEX[`${side}UpperArm`]);
  let let_go = false;
  yield* parallel('race',
    pose(body, person.holding[off] ? {} : { arms: { [off]: OFF.pulled } }),
    trunk(body, person, -x * COIL.twist, UNCOIL.bow, UNCOIL.shift),
    function* () {
      yield* carry(body, thing, at(WHIP.toward, WHIP.share), { speed: WHIP.speed * scale, step: false, until: () => ahead(body, thing, shoulder()) > WHIP.ahead * person.proportions.armLength });
      const motion = release(body, thing);
      if (target) motion.velocity.copy(aimed(thing.getWorldPosition(new Vector3()), target instanceof Object3D ? target.getWorldPosition(new Vector3()) : target, options.speed));
      options.released?.(motion);
      let_go = true;
      yield* wait(FOLLOW);
    });
  return let_go;
}

/** how the trunk coils, at its joints' own quick pace (rad, the throwing side's shoulder back), how far it bows (rad) and the weight shifts
 * back (m, × the body's scale) for the cock */
const COIL = { twist: 0.7, bow: 0.12, shift: 0.06 };
/** how fast the trunk coils and uncoils at most (rad/s): a thrower's hips and chest turn some 6–10 rad/s */
const TWISTING = 7;
/** how far the trunk bows and the weight comes forward through the whip (rad, m × scale) */
const UNCOIL = { bow: 0.35, shift: 0.08 };
/** where the throwing hand cocks the thing (`Body.armPoint`, the throwing side's frame: +X away from the body's middle): out beside the
 * shoulder, then behind the head; how far out (× the arm's length) and how fast (m/s, × scale) */
const COCK = { aside: new Vector3(1, 0.35, 0), behind: new Vector3(0.3, 0.8, -0.5), share: 0.75, speed: 2 };
/** where the whip goes (toward the target ahead and down, × the arm's length), how fast (m/s, × scale), and how far ahead of the shoulder
 * the thing is let go (× the arm's length) */
const WHIP = { toward: new Vector3(-0.1, -0.2, 1), share: 0.95, speed: 4, ahead: 0.25 };
/** the free arm raised toward the target for the cock, and pulled down into the body for the whip (`ArmPosture`) */
const OFF = { raised: { forward: 1.5, out: 0.3, elbow: 0.3 }, pulled: { forward: 0.3, elbow: 1.2 } };
/** how long the throw goes on after the let-go, the trunk bowed and the hand following through (s) */
const FOLLOW = 0.35;
/** the fastest a default throw sets out (m/s) and the arc it sets out on (rad) */
const MOST = 25, ARC = (40 * Math.PI) / 180;

/** the trunk of `person` twisted `twist` (at `TWISTING`) and bowed `bow` (rad), its weight shifted `shift` (m × scale) ahead */
function trunk(body: Body, person: Person, twist: number, bow: number, shift: number): Verb {
  return verb(body, 'throwAt', (request) => function* () {
    yield* during(request, 'trunk', 'asked', () => person.poise.add({
      twist, twistRate: TWISTING, bow,
      shift: new Vector3(0, 0, shift * person.proportions.scale).applyQuaternion(new Quaternion().setFromAxisAngle(UP, person.locomotion.facing)),
    }));
  }, undefined, true);
}

/** whether `thing` has come within `NEAR.within` (× scale) of `point()`, or stopped there short of it (its arm's joints holding it off) */
function settled(thing: Object3D, point: () => Vector3, scale: number): () => boolean {
  const was = new Vector3(Infinity, 0, 0);
  let still = 0;
  return () => {
    const at = thing.getWorldPosition(new Vector3()), off = at.distanceTo(point());
    still = at.distanceTo(was) < NEAR.moving * scale && off < NEAR.short * scale ? still + 1 : 0;
    was.copy(at);
    return off < NEAR.within * scale || still > NEAR.frames;
  };
}

/** how near the cock the thing is there (m × scale); how little it moves a frame (m × scale), for how many frames, within how far of it
 * (m × scale), to have stopped short of it */
const NEAR = { within: 0.04, moving: 0.002, frames: 6, short: 0.2 };

/** how far ahead of `shoulder` `thing` is, along the body's facing (m) */
function ahead(body: Body, thing: Object3D, shoulder: Vector3): number {
  return thing.getWorldPosition(new Vector3()).sub(shoulder).dot(new Vector3(Math.sin(body.facing), 0, Math.cos(body.facing)));
}

/** the velocity from `from` that carries a thing to `to` under gravity: at `speed`, on its lower arc (none: the least on `ARC`) */
function aimed(from: Vector3, to: Vector3, speed?: number): Vector3 {
  const flat = new Vector3(to.x - from.x, 0, to.z - from.z), d = flat.length(), h = to.y - from.y;
  if (d < 1e-6) return new Vector3(0, speed ?? 0, 0);
  flat.divideScalar(d);
  let angle = ARC, v = speed;
  if (v === undefined) {
    const lift = d * Math.tan(ARC) - h;
    v = lift > 0 ? Math.min(MOST, Math.sqrt((G * d * d) / (2 * Math.cos(ARC) ** 2 * lift))) : MOST;
  }
  // (the lower of the two arcs at that speed; out of its reach, 45°, as far as it goes)
  const root = v ** 4 - G * (G * d * d + 2 * h * v * v);
  if (root >= 0) angle = Math.atan((v * v - Math.sqrt(root)) / (G * d));
  else angle = Math.PI / 4;
  return flat.multiplyScalar(v * Math.cos(angle)).setY(v * Math.sin(angle));
}

const G = 9.81, UP = new Vector3(0, 1, 0);
