import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { createWorld, idle, INDEX, type Frame, type Humanoid, type Placement, type World } from '@drawcall/animate';
import { Report } from '../../report';
import type { Prop, Scenario } from '../../scenario';
import { bearLance, bearShield, buckle, checkDraw, don, hangSword, putOnHelmet, takeLance, takeShield, walkOut } from './arming';
import { beltEnd, drawn, gauntlet, helmet, lance, scabbard, shield, solidsOf, strap, sword, type Gear } from './gear';
import { pause, type Knight } from './handling';
import { wear, Worn } from './worn';

/** the knight's variations: the helm's stand, the shield's wall and the lance's rack moved (m, on the floor), what lies on them higher (m), the knight's height (m), his pace (1: as timed) */
export interface Variation {
  shift?: { x: number; z: number };
  rise?: number;
  height?: number;
  pace?: number;
}

const UP = new Vector3(0, 1, 0);
const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a);
const place = (x: number, y: number, z: number, quaternion = new Quaternion()): Placement => ({ position: new Vector3(x, y, z), quaternion });

/** the armoury (m, the knight starting at the origin facing +z): the table before him, the helm's stand to his right, the shield's wall to his left, the lance's rack ahead right, the yard beyond */
const TABLE = { x: 0, z: 0.9, width: 1.6, depth: 0.6, top: 0.78 };
const STAND = { x: -1.6, z: 0.5, top: 1.3 };
const WALL = { x: 1.7, z: 0.6, peg: 1.1 };
const RACK = { x: -1.5, z: 2.6, grip: 1.2 };
const YARD = new Vector3(-0.5, 0, 6);
/** the sword in its scabbard leaning on the table's edge, nearly upright */
const LEANING = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.06);
/** where he looks round the yard: the gate, the stables, the sky over the lists */
const SIGHTS = [new Vector3(-4, 2.2, 10), new Vector3(3.5, 1.4, 8.5), new Vector3(0, 2.5, 14)];

/**
 * A knight arming in his armoury and going out to war: he buckles on his sword belt, hangs his
 * sword on it and checks it draws, puts on his helm, pulls on his gauntlets (each held open by the
 * other hand), takes his shield off the wall onto his left arm and his lance out of its rack, and
 * walks out into the yard bearing them, looking round.
 */
export function knightArming({ shift = { x: 0, z: 0 }, rise = 0, height, pace = 1 }: Variation = {}): Scenario {
  const top = TABLE.top + rise;
  const stand = { x: STAND.x + shift.x, z: STAND.z + shift.z };
  const wall = { x: WALL.x + shift.x, z: WALL.z + shift.z };
  const rack = { x: RACK.x + shift.x, z: RACK.z + shift.z };
  return {
    id: 'knight-arming',
    title: 'A knight arming',
    description:
      'In his armoury a knight buckles on his sword belt, hangs his sword on it and checks it draws, puts on his helm, pulls on his gauntlets, takes his shield onto his left arm and his lance in his right hand, and walks out into the yard, looking round.',
    duration: 78 / pace,
    actors: [{ height }],
    cameraDistance: 4.2,
    stage: () => {
      const report = new Report();
      const worn = new Worn();
      const gear = {
        buckle: beltEnd('buckle', place(0.45, top + 0.006, 0.66)),
        tongue: beltEnd('tongue', place(0, top + 0.004, 0.66)),
        // (leaning on the table's front edge, its chape on the floor, hilt up)
        scabbard: scabbard(place(0.72, 0.848, 0.601, LEANING)),
        sword: sword(place(0.72, 0.848, 0.601, LEANING)),
        // (palms down, fingers away: each where the other hand takes it, the left on the right)
        gauntlets: {
          left: gauntlet('left', place(-0.45, top + 0.03, 0.68, yaw(-Math.PI / 2))),
          right: gauntlet('right', place(-0.25, top + 0.03, 0.68, yaw(Math.PI / 2))),
        },
        // (on its stand, facing the way he will face putting it on)
        helmet: helmet(place(stand.x, STAND.top + rise + 0.09, stand.z, yaw(-Math.PI / 2))),
        // (on its peg, hung by its strap, its back to the room)
        shield: shield(place(wall.x - 0.1, WALL.peg + rise, wall.z, yaw(-Math.PI / 2))),
        // (upright in its rack)
        lance: lance(place(rack.x, RACK.grip + rise, rack.z, yaw(-Math.PI / 2))),
      };
      const all: Gear[] = [gear.buckle, gear.tongue, gear.scabbard, gear.sword, gear.gauntlets.left, gear.gauntlets.right, gear.helmet, gear.shield, gear.lance];
      // (the sword in its scabbard from the start)
      worn.put(gear.sword.item, gear.scabbard.item);
      let knight: Knight | null = null;
      let finished = false;
      const story = (k: Knight) =>
        function* () {
          yield* pause(k, 0.8)();
          yield* buckle(k, { buckle: gear.buckle.item, tongue: gear.tongue.item }, 0)();
          yield* hangSword(k, gear.scabbard.item, 0)();
          yield* checkDraw(k, gear.sword.item, gear.scabbard.item)();
          yield* putOnHelmet(k, gear.helmet.item, -Math.PI / 2)();
          yield* don(k, gear.gauntlets.left.item, 'left', 0)();
          yield* don(k, gear.gauntlets.right.item, 'right', 0)();
          yield* takeShield(k, gear.shield.item, Math.PI / 2)();
          // (bearing the shield from here on)
          yield* parallel<Frame<World>>(
            'race',
            function* () {
              yield* takeLance(k, gear.lance.item, -Math.PI / 2)();
              // (bearing the lance too)
              yield* parallel<Frame<World>>('all', bearLance(k, gear.lance.item), function* () {
                yield* walkOut(k, YARD, 0, SIGHTS)();
                finished = true;
              });
            },
            bearShield(k),
          );
        };
      return {
        world: createWorld(),
        report,
        done: () => !!knight && finished && armed(knight, worn, gear),
        props: () => {
          const props: Prop[] = [...armoury(top, stand, wall, rack, rise), ...all.flatMap(drawn)];
          const body = knight?.h;
          const hips = body ? body.pose.position(INDEX.hips).clone().addScaledVector(UP, 0.05 * body.proportions.scale) : new Vector3(0, -10, 0);
          props.push(...strap(gear.buckle.item.current.position, gear.tongue.item.current.position, hips, body?.gait.facing ?? 0, { height: top, away: new Vector3(0, 0, 1) }));
          return props;
        },
        solids: () => all.flatMap(solidsOf),
        script: (h: Humanoid<World>) => {
          const k: Knight = (knight = { h, worn, report, pace });
          return function* () {
            yield* parallel<Frame<World>>('all', idle(h), story(k), wear(worn));
          };
        },
      };
    },
  };
}

/** armed and borne as he goes out: the belt, the sword and its scabbard, the helm and the gauntlets worn where they go; the shield on the left arm, the fist on its grip; the lance in the right hand */
function armed(k: Knight, worn: Worn, gear: { buckle: Gear; tongue: Gear; scabbard: Gear; sword: Gear; gauntlets: { left: Gear; right: Gear }; helmet: Gear; shield: Gear; lance: Gear }): boolean {
  const { h } = k;
  const near = (g: Gear, bone: number, local: Vector3, within: number) => {
    const at = local.clone().multiplyScalar(h.proportions.scale).applyQuaternion(h.pose.rotation(bone)).add(h.pose.position(bone));
    return g.item.current.position.distanceTo(at) < within;
  };
  const sheathed = gear.sword.item.current.position.distanceTo(gear.scabbard.item.current.position) < 0.01;
  return (
    [gear.buckle, gear.tongue, gear.scabbard, gear.sword, gear.gauntlets.left, gear.gauntlets.right, gear.helmet, gear.shield].every((g) => worn.has(g.item)) &&
    sheathed &&
    near(gear.helmet, INDEX.head, new Vector3(0, 0.15, 0), 0.01) &&
    near(gear.gauntlets.left, INDEX.leftHand, new Vector3(), 0.015) &&
    near(gear.gauntlets.right, INDEX.rightHand, new Vector3(), 0.015) &&
    h.holding.left?.item === gear.shield.item &&
    h.holding.right?.item === gear.lance.item &&
    h.pose.position(INDEX.hips).distanceTo(YARD.clone().setY(h.pose.position(INDEX.hips).y)) < 0.3
  );
}

/** the armoury drawn: the table, the helm's stand, the wall and its peg, the lance's rack */
function armoury(top: number, stand: { x: number; z: number }, wall: { x: number; z: number }, rack: { x: number; z: number }, rise: number): Prop[] {
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number): Prop => ({ kind: 'box', position: new Vector3(x, y, z), size: new Vector3(sx, sy, sz) });
  return [
    box(TABLE.x, top - 0.02, TABLE.z, TABLE.width, 0.04, TABLE.depth),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(TABLE.x + sx * (TABLE.width / 2 - 0.05), (top - 0.04) / 2, TABLE.z + sz * (TABLE.depth / 2 - 0.05), 0.05, top - 0.04, 0.05))),
    { kind: 'cylinder', position: new Vector3(stand.x, (STAND.top + rise) / 2, stand.z), radius: 0.025, length: STAND.top + rise },
    box(stand.x, 0.02, stand.z, 0.4, 0.04, 0.4),
    { kind: 'ball', position: new Vector3(stand.x, STAND.top + rise + 0.07, stand.z), radius: 0.08 },
    // (the shield's wall: two posts and a rail, its peg on it)
    ...[-1, 1].map((s) => box(wall.x + 0.03, 0.9, wall.z + s * 0.45, 0.06, 1.8, 0.06)),
    box(wall.x + 0.03, WALL.peg + rise + 0.28, wall.z, 0.06, 0.06, 1.0),
    box(wall.x - 0.02, WALL.peg + rise + 0.28, wall.z, 0.04, 0.03, 0.03),
    box(rack.x, 0.03, rack.z, 0.25, 0.06, 0.6),
    box(rack.x - 0.08, 0.75, rack.z, 0.04, 1.5, 0.04),
    box(rack.x - 0.04, 1.5 + rise, rack.z, 0.12, 0.04, 0.6),
  ];
}
