import { Group, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { carry, grab, lookAt, release, wait } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { box, empty } from '../things';

/** the box's width, height and depth (m), and its weight (kg) */
const BOX = new Vector3(0.34, 0.26, 0.26);
const MASS = 2;
/** the shelf: where its middle stands on the floor, its boards' heights, its width and depth (m) */
const SHELF = { x: -1.3, z: 4.4, boards: [0.4, 0.95, 1.4, 1.8], width: 1.0, depth: 0.34 };
/** lifted past the knees (m): the eyes go on from the box to the board it is for */
const KNEES = 0.6;
/** how long a lift to the chest takes at the carry's own pace (s) */
const LIFT = 1.8;

/** the box's variations: nearer (m, along its way), taller (m), turned round the body's start (rad), the shelf's top board lower (m), lifted to the chest in `lift` s */
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
  return {
    id: 'pickup-shelf',
    title: 'Pick up a box, shelve it overhead',
    description:
      'A box lies on the floor 2.6 m away: the body walks to it, squats and takes it in both hands, lifts it in front of the knees up to the chest, carries it to a shelf and puts it onto the top board above its head, on its toes; then lets go.',
    duration: 17,
    stage: (cast) => {
      const person = cast.person();
      const scene = new Group();
      const size = BOX.clone().setY(BOX.y + taller);
      const parcel = box(scene, 'box', size, new Vector3(0.35, size.y / 2, 2.6 - nearer).applyAxisAngle(UP, around));
      parcel.rotation.y = 0.35 + around;
      parcel.userData.mass = MASS;
      // (taken as the hands come: the box's sides have no one way to hold them)
      empty(parcel, 'left', new Vector3(size.x / 2 + 0.015, 0, 0));
      empty(parcel, 'right', new Vector3(-size.x / 2 - 0.015, 0, 0));
      const top = shelf(scene, SHELF.boards[3] - lower);
      // (its place on the top board, set there from in front over the board's front edge; +Z the way the body faces putting it there)
      const front = -SHELF.depth / 2;
      const shelved = empty(top, 'shelved', new Vector3(0, size.y / 2 + 0.005, front + size.z / 2 + 0.01));
      empty(top, 'over the edge', new Vector3(0, size.y / 2 + 0.03, front - 0.02));
      shelved.userData.approach = ['over the edge'];
      return {
        scene,
        bodies: [person],
        story: function* () {
          yield* grab(person, parcel, { left: 'left', right: 'right' });
          // (its eyes on the box as it lifts it, and on to the board once it is past the knees)
          yield* parallel('race', carry(person, parcel, shelved, { speed: (0.5 * LIFT) / lift }), function* () {
            yield* wait(() => parcel.getWorldPosition(new Vector3()).y > KNEES);
            yield* lookAt(person, top, { until: Infinity });
          });
          release(person, parcel, shelved);
        },
        done: () => parcel.parent === shelved && parcel.position.length() === 0,
      };
    },
  };
}

/** the shelf's sides and boards under `scene` (the top one at `height`), and its top board */
function shelf(scene: Group, height: number): Group {
  const sides = new Vector3(0.02, height, SHELF.depth), board = new Vector3(SHELF.width, 0.02, SHELF.depth);
  for (const sign of [-1, 1]) box(scene, 'shelf side', sides, new Vector3(SHELF.x + (sign * SHELF.width) / 2, height / 2, SHELF.z));
  for (const y of SHELF.boards.slice(0, 3)) box(scene, 'board', board, new Vector3(SHELF.x, y - 0.01, SHELF.z));
  const top = new Group();
  top.name = 'top board';
  top.position.set(SHELF.x, height, SHELF.z);
  box(top, 'board', board, new Vector3(0, -0.01, 0));
  scene.add(top);
  return top;
}

const UP = new Vector3(0, 1, 0);
