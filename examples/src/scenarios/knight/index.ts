import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { idle, INDEX, when, wear, type Frame, type Humanoid, type Item, type Placement } from '@drawcall/animate';
import { forwardOf, leftOf } from '../../math';
import { Report } from '../../report';
import type { Prop, Scenario } from '../../scenario';
import { bearLance, bearShield, takeLance, takeShield } from './arms';
import { don } from './gauntlets';
import { putOnHelmet } from './helm';
import { flow, walkOut, type Knight } from './knight';
import { buckle, checkDraw, hangSword } from './sword';
import { beltEnd, drawn, gauntlet, harness, helmet, lance, scabbard, shield, solidsOf, strap, sword, type Gear } from './gear';

/**
 * The knight's variations: the helm's stand, the shield's wall and the lance's rack moved (m, on
 * the floor), or all on the other side (`mirror`); what lies on them higher (m); the helm turned on
 * its stand and the wall turned (rad); the knight's height (m); his pace (1: as timed).
 */
export interface Variation {
  shift?: { x: number; z: number };
  mirror?: boolean;
  rise?: number;
  helmTurn?: number;
  wallTurn?: number;
  height?: number;
  pace?: number;
}

/** a piece of furniture: where it stands on the floor, and the way one faces it */
interface Furniture {
  at: Vector3;
  facing: number;
}

const UP = new Vector3(0, 1, 0);
const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a);
const place = (x: number, y: number, z: number, quaternion = new Quaternion()): Placement => ({ position: new Vector3(x, y, z), quaternion });

/**
 * The armoury (m, the knight starting at the origin facing +z): the table before him (its top 0.78
 * m), the helm's stand to his right (its head form at 1.3 m), the shield's wall to his left (its
 * peg at 1.1 m), the lance's rack ahead right (the lance's grip at 1.2 m), the yard beyond.
 */
const TABLE = { x: 0, z: 0.9, width: 1.6, depth: 0.6, top: 0.78 };
const STAND = { x: -1.6, z: 0.5, facing: -Math.PI / 2, top: 1.3 };
const WALL = { x: 1.7, z: 0.6, facing: Math.PI / 2, peg: 1.1 };
const RACK = { x: -1.5, z: 2.6, facing: -Math.PI / 2, grip: 1.2 };
/** the yard he walks out to (far enough for a few steady strides), the way he faces there, and where he looks round it: the gate, the stables, the sky over the lists */
const YARD = new Vector3(-0.5, 0, 11);
const SIGHTS = [new Vector3(-4, 2.2, 15), new Vector3(3.5, 1.4, 13.5), new Vector3(0, 2.5, 19)];
/** the sword in its scabbard leaning on the table's edge, nearly upright */
const LEANING = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.06);

/**
 * A knight arming in his armoury and going out to war: in harness, he buckles on his sword belt,
 * hangs his sword on it and checks it draws, puts on his helm and buckles its strap, pulls on his
 * gauntlets (each held open by the other hand), takes his shield off the wall onto his left arm and
 * his lance out of its rack, and walks out into the yard bearing them, looking round.
 */
export function knightArming({ shift = { x: 0, z: 0 }, mirror = false, rise = 0, helmTurn = 0, wallTurn = 0, height, pace = 1 }: Variation = {}): Scenario {
  const top = TABLE.top + rise;
  const side = mirror ? -1 : 1;
  const furniture = (f: { x: number; z: number; facing: number }, turn = 0): Furniture => ({ at: new Vector3(side * f.x + shift.x, 0, f.z + shift.z), facing: side * f.facing + turn });
  const stand = furniture(STAND);
  const wall = furniture(WALL, wallTurn);
  const rack = furniture(RACK);
  const yard = YARD.clone().setX(side * YARD.x);
  return {
    id: 'knight-arming',
    title: 'A knight arming',
    description:
      'In his armoury a knight in harness buckles on his sword belt, hangs his sword on it and checks it draws, puts on his helm and buckles its strap, pulls on his gauntlets, takes his shield onto his left arm and his lance in his right hand, and walks out into the yard, looking round.',
    // Walking keeps its own pace; leave time for hands to settle to rest between tasks and a look round the yard.
    duration: 50 + 24 / pace,
    actors: [{ height }],
    cameraDistance: 4.2,
    stage: () => {
      const report = new Report();
      const gear = {
        buckle: beltEnd('buckle', place(0.45, top + 0.006, 0.66)),
        tongue: beltEnd('tongue', place(0, top + 0.004, 0.66)),
        // (leaning on the table's front edge, its chape on the floor, hilt up)
        scabbard: scabbard(place(0.62, 0.848, 0.601, LEANING)),
        sword: sword(place(0.62, 0.848, 0.601, LEANING)),
        // (palms down, fingers away: each where the other hand takes it, the left on the right)
        gauntlets: {
          left: gauntlet('left', place(-0.45, top + 0.03, 0.68, yaw(-Math.PI / 2))),
          right: gauntlet('right', place(-0.25, top + 0.03, 0.68, yaw(Math.PI / 2))),
        },
        // (on its stand, facing away from where one takes it)
        helmet: helmet({ position: stand.at.clone().setY(STAND.top + rise + 0.09), quaternion: yaw(stand.facing + helmTurn) }),
        // (on its peg, hung by its strap, its back to the room)
        shield: shield({ position: wall.at.clone().addScaledVector(forwardOf(wall.facing), -0.1).setY(WALL.peg + rise), quaternion: yaw(wall.facing + Math.PI) }),
        // (upright in its rack)
        lance: lance({ position: rack.at.clone().setY(RACK.grip + rise), quaternion: yaw(rack.facing) }),
      };
      const all: Gear[] = [gear.buckle, gear.tongue, gear.scabbard, gear.sword, gear.gauntlets.left, gear.gauntlets.right, gear.helmet, gear.shield, gear.lance];
      let knight: Knight | null = null;
      let pieces: Gear[] = [];
      const story = (k: Knight) =>
        function* () {
          const atTable = { ahead: 0.45 * k.h.proportions.armLength };
          yield* wear(k.h, gear.sword.item, gear.scabbard.item)();
          // (each thing flowing into the next: it sets off as the hands let go of the last)
          const arms = function* () {
            yield* takeShield(k, gear.shield.item)();
            // (bearing the shield from here on; the lance too, once taken: out to the yard as it comes upright)
            let upright = false;
            const lance = function* () {
              yield* takeLance(k, gear.lance.item)();
              upright = true;
              yield* bearLance(k, gear.lance.item)();
            };
            yield* parallel<Frame>('all', bearShield(k), lance, function* () {
              yield* when(() => upright);
              yield* walkOut(k, yard, 0, SIGHTS)();
            });
          };
          yield* flow(
            k,
            [
              [buckle(k, { buckle: gear.buckle.item, tongue: gear.tongue.item }, atTable), ['left', 'right']],
              [hangSword(k, gear.scabbard.item), ['left']],
              [checkDraw(k, gear.sword.item, gear.scabbard.item), ['left'], { left: new Vector3(0.35, -0.15, 0.25) }],
              [putOnHelmet(k, gear.helmet.item), ['left', 'right']],
              [don(k, gear.gauntlets.left.item, 'left', atTable), ['right']],
              // Release below and ahead of the sword hilt before the free arm joins the walk.
              [don(k, gear.gauntlets.right.item, 'right', atTable), ['left'], { left: new Vector3(0.25, -0.1, 0.25) }],
            ],
            arms,
          )();
        };
      return {
        report,
        done: () => !!knight && armed(knight.h, gear, yard),
        props: () => {
          const props: Prop[] = [...armoury(top, stand, wall, rack, rise), ...all.flatMap(drawn), ...pieces.flatMap(drawn)];
          const body = knight?.h;
          const hips = body ? body.pose.position(INDEX.hips).clone().addScaledVector(UP, 0.05 * body.proportions.scale) : new Vector3(0, -10, 0);
          props.push(...strap(gear.buckle.item.current.position, gear.tongue.item.current.position, hips, body?.locomotion.facing ?? 0, { height: top, away: new Vector3(0, 0, 1) }));
          return props;
        },
        solids: () => all.flatMap(solidsOf),
        // (in harness from the start: its pieces on their bones, borne)
        wearing: (_, p) => {
          const dressed = harness(p);
          pieces = dressed.map(({ gear }) => gear);
          return dressed.map(({ bone, gear }) => ({ item: gear.item, on: INDEX[bone], at: { position: new Vector3() } }));
        },
        script: (h: Humanoid) => {
          const k: Knight = (knight = { h, report, pace });
          return function* () {
            yield* parallel<Frame>('all', idle(h), story(k));
          };
        },
      };
    },
  };
}

/**
 * armed and borne in the yard: the belt, the scabbard and the sword in it, the helm and the
 * gauntlets worn where they go and home there; the shield on the left forearm, the fist on its
 * grip; the lance in the right hand; come to rest in the yard
 */
function armed(h: Humanoid, gear: { buckle: Gear; tongue: Gear; scabbard: Gear; sword: Gear; gauntlets: { left: Gear; right: Gear }; helmet: Gear; shield: Gear; lance: Gear }, yard: Vector3): boolean {
  const on = (g: Gear, carrier: number | Item) => h.worn.get(g.item)?.on === carrier;
  const home = (g: Gear, bone: number, local: Vector3, within: number) => {
    const at = local.clone().multiplyScalar(h.proportions.scale).applyQuaternion(h.pose.rotation(bone)).add(h.pose.position(bone));
    return on(g, bone) && g.item.current.position.distanceTo(at) < within;
  };
  const hips = h.pose.position(INDEX.hips);
  return (
    on(gear.buckle, INDEX.hips) &&
    on(gear.tongue, INDEX.hips) &&
    on(gear.scabbard, INDEX.hips) &&
    on(gear.sword, gear.scabbard.item) &&
    gear.sword.item.current.position.distanceTo(gear.scabbard.item.current.position) < 0.005 &&
    home(gear.helmet, INDEX.head, new Vector3(0, 0.15, 0.02), 0.005) &&
    home(gear.gauntlets.left, INDEX.leftHand, new Vector3(), 0.005) &&
    home(gear.gauntlets.right, INDEX.rightHand, new Vector3(), 0.005) &&
    on(gear.shield, INDEX.leftLowerArm) &&
    h.holding.left?.item === gear.shield.item &&
    h.holding.right?.item === gear.lance.item &&
    Math.hypot(hips.x - yard.x, hips.z - yard.z) < 0.3 &&
    h.locomotion.settled
  );
}

/** the armoury drawn: the table, the helm's stand, the wall and its peg, the lance's rack */
function armoury(top: number, stand: Furniture, wall: Furniture, rack: Furniture, rise: number): Prop[] {
  const box = (at: Vector3, sx: number, sy: number, sz: number, facing = 0): Prop => ({ kind: 'box', position: at, size: new Vector3(sx, sy, sz), quaternion: yaw(facing) });
  /** a point of a piece of furniture (left +x of one facing it, up +y, away +z) */
  const of = (f: Furniture, x: number, y: number, z: number) => f.at.clone().addScaledVector(leftOf(f.facing), x).addScaledVector(forwardOf(f.facing), z).setY(y);
  return [
    box(new Vector3(TABLE.x, top - 0.02, TABLE.z), TABLE.width, 0.04, TABLE.depth),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(new Vector3(TABLE.x + sx * (TABLE.width / 2 - 0.05), (top - 0.04) / 2, TABLE.z + sz * (TABLE.depth / 2 - 0.05)), 0.05, top - 0.04, 0.05))),
    { kind: 'cylinder', position: stand.at.clone().setY((STAND.top + rise) / 2), radius: 0.025, length: STAND.top + rise },
    box(stand.at.clone().setY(0.02), 0.4, 0.04, 0.4, stand.facing),
    { kind: 'ball', position: stand.at.clone().setY(STAND.top + rise + 0.07), radius: 0.08 },
    // (the shield's wall: two posts and a rail, its peg on it)
    ...[-1, 1].map((s) => box(of(wall, s * 0.45, 0.9, 0.03), 0.06, 1.8, 0.06, wall.facing)),
    box(of(wall, 0, WALL.peg + rise + 0.28, 0.03), 1.0, 0.06, 0.06, wall.facing),
    box(of(wall, 0, WALL.peg + rise + 0.28, -0.02), 0.03, 0.03, 0.04, wall.facing),
    box(rack.at.clone().setY(0.03), 0.6, 0.06, 0.25, rack.facing),
    box(of(rack, 0, 0.75, 0.08), 0.04, 1.5, 0.04, rack.facing),
    box(of(rack, 0, 1.5 + rise, 0.04), 0.6, 0.04, 0.12, rack.facing),
  ];
}
