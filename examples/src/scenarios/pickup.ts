import { Box3, MathUtils, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { approach, arriving, carried, eyesOnBefore, carry, grab, hold, idle, Item, lookAt, when, release, type Behaviour, type Frame, type Humanoid, type Waypoint, type Placement, type Target } from '@drawcall/animate';
import type { Prop, Scenario } from '../scenario';
import { forwardOf } from '../math';
import { Report, reported, reporting } from '../report';

/** the box's width, height and depth (m) */
const BOX = new Vector3(0.34, 0.26, 0.26);
/** the shelf: where its middle stands on the floor, its boards' heights, its width and depth (m) */
const SHELF = { x: -1.3, z: 4.4, boards: [0.4, 0.95, 1.4, 1.8], width: 1.0, depth: 0.34 };
/** how long the box takes from the floor up to the chest, and up over the board's front edge and onto it (s) */
const LIFT = 1.8;
const PLACE = { over: 1.1, onto: 0.7 };
/** coming up to the shelf, the box rises this much higher (m) over the last RAISING s, on its way up onto the board */
const RAISED = 0.2;
const RAISING = 1;
/** lifted past the knees (m): the eyes go on from the box to the board it is for */
const KNEES = 0.6;
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
    duration: 17,
    actors: [{}],
    stage: () => {
      const report = new Report();
      const box = new Item(new Vector3(0.35, size.y / 2, 2.6 - nearer).applyAxisAngle(UP, around), new Quaternion().setFromAxisAngle(UP, 0.35 + around), { left: grip(size, 1), right: grip(size, -1) }, { bounds: new Box3().setFromCenterAndSize(new Vector3(), size) });
      const shelved = new Vector3(SHELF.x, top + size.y / 2 + 0.005, SHELF.z - SHELF.depth / 2 + size.z / 2 + 0.01);
      return {
        report,
        // (the box let go of on the top board, where it was put)
        done: () => box.current.position.distanceTo(shelved) < 0.03,
        props: () => [{ kind: 'box', position: box.current.position.clone(), size, quaternion: box.current.quaternion.clone() }, ...shelf(SHELF.boards[3] - top)],
        script: (h) =>
          function* () {
            yield* parallel<Frame>('all', eyesOnBefore(h, box, 0.4), idle(h), tasks(h, box, size, top, lift, report));
          },
      };
    },
  };
}

/**
 * the body's part: it takes the box, lifts it to the chest and carries it over to the shelf, its
 * eyes on the box and then on the board; a moment before it stands at the shelf the box is on its
 * way up onto the board; then it lets go
 */
function tasks(h: Humanoid, box: Item, size: Vector3, top: number, lift: number, report: Report): Behaviour {
  return function* () {
    // (the eyes on the box until it is up, then on the board it goes to)
    const gaze = { on: box.current.position };
    yield* parallel<Frame>(
      'race',
      reporting(report, HANDS, function* () {
        // (its eyes on the box as it comes up to it: it bows to see it, the head turned by the gaze below)
        yield* grab(h, { left: [box, 'left'], right: [box, 'right'] }, { look: () => gaze.on, first: true })();
        // (the eyes on to the board as the box comes up past the knees)
        const board = new Vector3(SHELF.x, top, SHELF.z);
        const up = () => box.current.position.y > KNEES;
        const lifting = lifted(h, box, lift);
        yield* parallel<Frame>('all', carry(h, box, lifting), function* () {
          yield* when(up);
          gaze.on = board;
        });
        yield* shelve(h, box, size, top)();
      }),
      lookAt(h.gazer, reported(report, 'gaze', () => gaze.on)),
    );
    yield* reporting(report, HANDS, release(h, ['left', 'right']))();
  };
}

/**
 * the lift's course (world), from where the box lies: up in front of the knees, then in close in
 * front of the chest, turning square with the body (the chest as the body will stand: its hips
 * over the feet, not back where they squat)
 */
function lifted(h: Humanoid, box: Item, seconds: number): Waypoint[] {
  const ahead = forwardOf(h.locomotion.facing);
  return [
    [seconds / 2, { position: box.current.position.clone().addScaledVector(ahead, 0.12).setY(KNEES) }],
    [seconds / 2, carried(h)],
  ];
}

/**
 * the box carried in front of the chest to the shelf, rising toward the face as the body comes up
 * to it (from RAISING s before it stands there), and once it is there (its feet may still be
 * settling), up over the board's front edge and onto it: its course ends on the board, where it rests
 */
function shelve(h: Humanoid, box: Item, size: Vector3, top: number): Behaviour {
  const arrived = arriving(h, 0.05);
  const front = SHELF.z - SHELF.depth / 2;
  const carryPose = carried(h);
  const raised = (f: Frame): Placement => {
    const at = carryPose(f);
    at.position.y += RAISED * (1 - MathUtils.smoothstep(h.locomotion.eta, 0, RAISING));
    return at;
  };
  const up: Waypoint[] = [
    [PLACE.over, { position: new Vector3(SHELF.x, top + size.y / 2 + 0.03, front - 0.02), quaternion: new Quaternion() }],
    [PLACE.onto, { position: new Vector3(SHELF.x, top + size.y / 2 + 0.005, front + size.z / 2 + 0.01) }],
  ];
  return function* () {
    yield* parallel<Frame>(
      'all',
      approach(h, new Vector3(SHELF.x, top + size.y / 2, SHELF.z), { face: 0 }),
      function* () {
        yield* hold(h, box, { to: raised, until: arrived })();
        yield* carry(h, box, up)();
      },
    );
  };
}

/** a grip on the middle of the box's face on side `sign` (+1 left): the wrist there, the hand turning as the arm brings it */
function grip(size: Vector3, sign: 1 | -1): Target {
  return { position: new Vector3(sign * (size.x / 2 + 0.015), 0, 0) };
}

/** the shelf drawn: its sides and boards (`lower`: the boards that much lower) */
function shelf(lower: number): Prop[] {
  const height = SHELF.boards[3] - lower;
  const side = (sign: number): Prop => ({ kind: 'box', position: new Vector3(SHELF.x + (sign * SHELF.width) / 2, height / 2, SHELF.z), size: new Vector3(0.02, height, SHELF.depth) });
  const board = (y: number): Prop => ({ kind: 'box', position: new Vector3(SHELF.x, y - 0.01, SHELF.z), size: new Vector3(SHELF.width, 0.02, SHELF.depth) });
  return [side(-1), side(1), ...SHELF.boards.map((y, i) => board(i === 3 ? height : y))];
}
