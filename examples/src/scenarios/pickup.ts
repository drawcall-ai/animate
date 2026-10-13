import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { createWorld, grab, handTo, hold, idle, Item, lookAt, openHand, reached, walkTo, type Behaviour, type Frame, type Grips, type Humanoid, type Placement, type Target, type World } from '@drawcall/animate';
import type { Prop, Scenario } from '../scenario';
import { path } from '../keys';
import { forwardOf } from '../math';
import { Report, reported, reporting } from '../report';

/** the box's width, height and depth (m) */
const BOX = new Vector3(0.34, 0.26, 0.26);
/** the shelf: where its middle stands on the floor, its boards' heights, its width and depth (m); the body stands this far before its middle to put things up */
const SHELF = { x: -1.3, z: 4.4, boards: [0.4, 0.95, 1.4, 1.8], width: 1.0, depth: 0.34, stand: 0.4 };
/** how long the box takes from the floor up to the chest, and up onto the board (s) */
const LIFT = 1.8;
const PLACE = 1.8;
/** carried: the box this far in front of the hips and this high (m) */
const CARRIED = { ahead: 0.36, height: 1.05 };
/** letting go: the hands this far back off the box and down (m) */
const AWAY = 0.1;
const UP = new Vector3(0, 1, 0);
const HANDS = ['leftHand', 'rightHand'];

/** the box's variations: nearer (m, along its way), taller (m: its middle half that higher), turned round the body's start (rad), the shelf's top board lower (m), lifted to the chest in `lift` s */
export interface Variation {
  nearer?: number;
  taller?: number;
  around?: number;
  lower?: number;
  lift?: number;
}

/**
 * A box on the floor: the body walks to it, squats and takes it in both hands, lifts it to the chest,
 * carries it to a shelf, puts it on the top board above its head on its toes, and lets go.
 */
export function pickupShelf({ nearer = 0, taller = 0, around = 0, lower = 0, lift = LIFT }: Variation = {}): Scenario {
  const size = BOX.clone().setY(BOX.y + taller);
  const top = SHELF.boards[3] - lower;
  return {
    id: 'pickup-shelf',
    title: 'Pick up a box, shelve it overhead',
    description:
      'A box lies on the floor 2.6 m away: the body walks to it, squats and takes it in both hands, lifts it in front of the knees up to the chest, carries it to a shelf and puts it onto the top board above its head, on its toes; then lets go.',
    duration: 20,
    actors: [{}],
    stage: () => {
      const report = new Report();
      const box = new Item(new Vector3(0.35, size.y / 2, 2.6 - nearer).applyAxisAngle(UP, around), new Quaternion().setFromAxisAngle(UP, 0.35 + around), { left: grip(size, 1), right: grip(size, -1) });
      const shelved = new Vector3(SHELF.x, top + size.y / 2 + 0.005, SHELF.z - SHELF.depth / 2 + size.z / 2 + 0.01);
      return {
        world: createWorld(),
        report,
        // (the box let go of on the top board, where it was put)
        done: () => box.current.position.distanceTo(shelved) < 0.03,
        props: () => [{ kind: 'box', position: box.current.position.clone(), size, yaw: facingOf(box.current.quaternion) }, ...shelf(SHELF.boards[3] - top)],
        script: (h) =>
          function* () {
            yield* parallel<Frame<World>>('all', idle(h), tasks(h, box, size, top, lift, report));
          },
      };
    },
  };
}

/** the body's part: after a moment, it takes the box, carries it over and puts it up, its eyes on it and then on the board; then it lets go */
function tasks(h: Humanoid<World>, box: Item, size: Vector3, top: number, lift: number, report: Report): Behaviour<World> {
  const grips: Grips = { left: 'left', right: 'right' };
  return function* () {
    // (the eyes on the box until it is carried off, then on the board it goes to)
    const gaze = { on: box.current.position };
    yield* action({ until: timePassed(0.8, 'seconds') });
    yield* parallel<Frame<World>>(
      'race',
      reporting(report, HANDS, function* () {
        yield* grab(h, box, grips)();
        const goal: Placement = { position: box.current.position.clone(), quaternion: box.current.quaternion.clone() };
        yield* parallel<Frame<World>>('race', carry(h, goal, gaze, size, top, lift), hold(h, box, grips, { to: goal }));
      }),
      lookAt(h.gazer, reported(report, 'gaze', () => gaze.on)),
    );
    yield* release(h, report)();
  };
}

/** where the box is carried (into `goal`, and the eyes into `gaze`): up from the floor to the chest, over to the shelf, up onto its top board */
function carry(h: Humanoid<World>, goal: Placement, gaze: { on: Vector3 }, size: Vector3, top: number, duration: number): Behaviour<World> {
  const facing = new Quaternion();
  const turned = goal.quaternion?.clone() ?? new Quaternion();
  return function* () {
    // up in front of the knees, then in close in front of the chest, turning square with the body
    const hips = h.pose.position(0);
    const ahead = forwardOf(h.gait.facing);
    const from = goal.position.clone();
    const lift = path(from, from.clone().addScaledVector(ahead, 0.12).setY(0.6), hips.clone().addScaledVector(ahead, CARRIED.ahead).setY(CARRIED.height), duration);
    let began = -1;
    yield* action<Frame<World>>({
      update: (f) => {
        if (began < 0) began = f.time;
        goal.position.copy(lift(f));
        goal.quaternion?.copy(turned).slerp(facing.setFromAxisAngle(UP, h.gait.facing), Math.min(1, (f.time - began) / duration));
      },
      until: timePassed(duration, 'seconds'),
    });
    // carried in front of the chest to the shelf, the eyes on its top
    gaze.on = new Vector3(SHELF.x, top, SHELF.z);
    const stand = new Vector3(SHELF.x, 0, SHELF.z - SHELF.stand);
    yield* parallel<Frame<World>>(
      'race',
      walkTo(h, { to: stand, face: 0 }),
      action<Frame<World>>({
        update: (f) => {
          goal.position.copy(f.prev.position(0)).addScaledVector(forwardOf(h.gait.facing), CARRIED.ahead).setY(CARRIED.height);
          goal.quaternion?.setFromAxisAngle(UP, h.gait.facing);
        },
      }),
    );
    // up over the board's front edge, then onto it
    const front = SHELF.z - SHELF.depth / 2;
    const up = path(goal.position.clone(), new Vector3(SHELF.x, top + size.y / 2 + 0.03, front - 0.02), new Vector3(SHELF.x, top + size.y / 2 + 0.005, front + size.z / 2 + 0.01), PLACE);
    yield* action<Frame<World>>({
      update: (f) => {
        goal.position.copy(up(f));
        goal.quaternion?.identity();
      },
      until: timePassed(PLACE + 0.3, 'seconds'),
    });
  };
}

/** letting go: the hands open, back off the box and down a little; then the free arms have them */
function release(h: Humanoid<World>, report: Report): Behaviour<World> {
  return function* () {
    const away = (side: 'left' | 'right') => {
      const hand = h.pose.position(h.rig.skeleton.index(`${side}Hand`)).clone();
      return { position: hand.addScaledVector(forwardOf(h.gait.facing), -AWAY).setY(hand.y - AWAY) };
    };
    const left = away('left');
    const right = away('right');
    const hand = (side: 'left' | 'right') => h.rig.skeleton.index(`${side}Hand`);
    // (both hands on their way until both are there)
    const there = (f: Frame<World>) => reached(f.prev2, f.prev, f.dt, hand('left'), left, undefined) && reached(f.prev2, f.prev, f.dt, hand('right'), right, undefined);
    yield* openHand(h, 'left')();
    yield* openHand(h, 'right')();
    yield* parallel<Frame<World>>('all', handTo(h, 'left', reported(report, 'leftHand', left), { until: there }), handTo(h, 'right', reported(report, 'rightHand', right), { until: there }));
  };
}

/** a grip on the middle of the box's face on side `sign` (+1 left): the wrist there, the hand turning as the arm brings it */
function grip(size: Vector3, sign: 1 | -1): Target {
  return { position: new Vector3(sign * (size.x / 2 + 0.015), 0, 0) };
}

/** the facing (about +y) of a rotation */
function facingOf(q: Quaternion): number {
  const f = new Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}

/** the shelf drawn: its sides and boards (`lower`: the boards that much lower) */
function shelf(lower: number): Prop[] {
  const height = SHELF.boards[3] - lower;
  const side = (sign: number): Prop => ({ kind: 'box', position: new Vector3(SHELF.x + (sign * SHELF.width) / 2, height / 2, SHELF.z), size: new Vector3(0.02, height, SHELF.depth) });
  const board = (y: number): Prop => ({ kind: 'box', position: new Vector3(SHELF.x, y - 0.01, SHELF.z), size: new Vector3(SHELF.width, 0.02, SHELF.depth) });
  return [side(-1), side(1), ...SHELF.boards.map((y, i) => board(i === 3 ? height : y))];
}
