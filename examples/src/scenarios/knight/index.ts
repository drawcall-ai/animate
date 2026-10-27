import { Euler, Group, Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, carry, grab, lookAt, release, wait, walkTo, type Target } from '@drawcall/animate';
import type { Scenario } from '../../scenario';
import { PERSON, scaled } from '../../skeletons';
import { ball, box, cylinder, empty } from '../../things';
import { beltEnd, gauntlet, harness, helm, lance, scabbard, shield, solidsOf, strap, sword } from './gear';

/**
 * The knight's variations: the helm's stand, the shield's wall and the lance's rack moved (m, on the floor), or all on the other side
 * (`mirror`); what lies on them higher (m); the helm turned on its stand and the wall turned (rad); the knight's standing height (m);
 * his pace (1: as tuned).
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

/**
 * The armoury (m, the knight starting at the origin facing +Z, his left +X): the table before him (its top 0.78 m), the helm's stand to
 * his right (its head form at 1.3 m), the shield's wall to his left (its peg at 1.1 m), the lance's rack ahead right (the lance's grip
 * at 1.2 m); each piece of furniture where it stands and the way one faces it.
 */
const TABLE = { z: 0.9, width: 1.6, depth: 0.6, top: 0.78 };
const STAND = { x: -1.6, z: 0.5, facing: -Math.PI / 2, top: 1.3 };
const WALL = { x: 1.7, z: 0.6, facing: Math.PI / 2, peg: 1.1 };
const RACK = { x: -1.5, z: 2.6, facing: -Math.PI / 2, grip: 1.2 };
/** the yard he walks out to (far enough for a few steady strides), and what he looks round at there: the gate, the stables, the sky over the lists */
const YARD = new Vector3(-0.5, 0, 11);
const SIGHTS = [new Vector3(-4, 2.2, 15), new Vector3(3.5, 1.4, 13.5), new Vector3(0, 2.5, 19)];
/** how long before what he does arrives his eyes go on to the next thing (s): the eyes lead the hands by about a second (Land & Hayhoe 2001) */
const LOOK_AHEAD = 0.8;
/** the default body's hip height (m): the places about the knight are measured from it */
const HIPS = 0.93;

/**
 * A knight arming in his armoury and going out to war: in harness, he buckles on his sword belt, hangs his sword at his left hip and
 * checks it draws, puts on his helm and buckles its strap, pulls on his gauntlets (each held open by the other hand), takes his shield
 * off the wall onto his left arm and his lance out of its rack, and walks out into the yard bearing them, looking round.
 */
export function knightArming({ shift = { x: 0, z: 0 }, mirror = false, rise = 0, helmTurn = 0, wallTurn = 0, height, pace = 1 }: Variation = {}): Scenario {
  return {
    id: 'knight-arming',
    title: 'A knight arming',
    description:
      'In his armoury a knight in harness buckles on his sword belt, hangs his sword on it and checks it draws, puts on his helm and buckles its strap, pulls on his gauntlets, takes his shield onto his left arm and his lance in his right hand, and walks out into the yard, looking round.',
    duration: 50 + 24 / pace,
    cameraDistance: 4.2,
    stage: (cast) => {
      const knight = cast.person({ tempo: pace }, height === undefined ? undefined : scaled(PERSON, height / 1.75));
      const scale = (knight.species.person?.height ?? 1.75) / 1.75;
      harness(knight.bones, scale);
      const scene = new Group();
      const side = mirror ? -1 : 1;
      const furniture = (name: string, { x, z, facing }: { x: number; z: number; facing: number }, turn = 0) => {
        const group = new Group();
        group.name = name;
        group.position.set(side * x + shift.x, 0, z + shift.z);
        group.rotation.y = side * facing + turn;
        scene.add(group);
        return group;
      };
      const top = TABLE.top + rise;
      armoury(scene, top);
      const [standGroup, wallGroup, rackGroup] = [furniture('helm stand', STAND), furniture('shield wall', WALL, wallTurn), furniture('lance rack', RACK)];
      drawFurniture(standGroup, wallGroup, rackGroup, rise);

      // the gear where it lies: the belt's ends and the gauntlets on the table (fingers away, each on the side of the hand that takes
      // it), the sword sheathed in its scabbard leaning on the table's edge, the helm on its stand (its face away from him), the shield
      // on its peg (its back to the room), the lance upright in its rack
      const gear = { buckle: beltEnd('buckle'), tongue: beltEnd('tongue'), scabbard: scabbard(), sword: sword(), helm: helm(), shield: shield(), lance: lance(), left: gauntlet('left'), right: gauntlet('right') };
      lay(scene, gear.buckle, new Vector3(0.25, top + 0.006, 0.66));
      lay(scene, gear.tongue, new Vector3(-0.2, top + 0.004, 0.66));
      lay(scene, gear.left, new Vector3(-0.45, top + 0.03, 0.68), -Math.PI / 2);
      lay(scene, gear.right, new Vector3(-0.25, top + 0.03, 0.68), Math.PI / 2);
      lay(scene, gear.scabbard, new Vector3(0.62, 0.848, 0.601)).rotation.x = 0.06;
      const [mouth, drawn, hilt] = [gear.scabbard.getObjectByName('mouth')!, gear.scabbard.getObjectByName('drawn')!, gear.sword.getObjectByName('hilt')!];
      lay(mouth, gear.sword, new Vector3());
      lay(seat(standGroup, 'on the stand', new Vector3(0, STAND.top + rise + 0.09, 0), new Vector3(0, 0.2, 0)), gear.helm, new Vector3(), helmTurn);
      lay(seat(wallGroup, 'on the peg', new Vector3(0, WALL.peg + rise, -0.1), new Vector3(0, 0.05, -0.25)), gear.shield, new Vector3(), Math.PI);
      lay(seat(rackGroup, 'in the rack', new Vector3(0, RACK.grip + rise, 0), new Vector3(0, 0.2, 0)), gear.lance, new Vector3());
      scene.add(strap(gear.buckle, gear.tongue, knight.bones.hips, () => knight.facing));

      // where things go about him (m, the default body's, scaled to his height): before him (turned as he faces) and on his bones (worn)
      const at = (parent: Object3D, name: string, x: number, y: number, z: number, turn?: Euler) => {
        const place = empty(parent, name, new Vector3(x, y, z).multiplyScalar(scale));
        if (turn) place.quaternion.setFromEuler(turn);
        return place;
      };
      const before = knight.object, hips = knight.bones.hips;
      const places = {
        // the belt's ends lifted out before him, round the hips (the strap behind them) and drawn round to the belly, buckled there
        buckleRound: [at(before, 'buckle out', 0.3, HIPS + 0.14, 0.34), at(before, 'buckle round', 0.26, HIPS + 0.07, -0.05), at(before, 'buckle before', 0.17, HIPS + 0.06, 0.22)],
        tongueRound: [at(before, 'tongue out', -0.3, HIPS + 0.14, 0.34), at(before, 'tongue round', -0.26, HIPS + 0.07, -0.05), at(before, 'tongue before', -0.17, HIPS + 0.06, 0.22), at(hips, 'tongue through', 0.01, 0.07, 0.175)],
        belt: at(before, 'the belt before him', 0, HIPS, 0.45),
        buckled: at(hips, 'buckled', 0.035, 0.07, 0.165),
        tongued: at(hips, 'tongued', -0.05, 0.07, 0.16),
        // the scabbard out beside him, then hung before the left hip, the hilt up and forward, its chape back and out (clear of the
        // thigh swinging back); tilted forward to present the hilt
        aside: at(before, 'scabbard aside', 0.3, HIPS + 0.32, 0.3),
        hanging: at(hips, 'hanging', 0.2, 0.03, 0.1, new Euler(0.6, 0, 0.22, 'YXZ')),
        presented: at(before, 'presented', 0.2, HIPS + 0.06, 0.22, new Euler(1.0, 0, 0.1, 'YXZ')),
        // the helm before his face (a look into it), raised over his head and lowered onto it, round the skull; the eyes ahead and down
        faced: at(before, 'helm before the face', 0, 1.68, 0.3),
        raised: at(before, 'helm raised', 0, 1.96, 0.26),
        helmed: at(knight.bones.head, 'helmed', 0, 0.15, 0.02),
        bowed: at(before, 'bowed', 0, HIPS + 0.15, 1.6),
        level: at(before, 'level', 0, 1.6, 3),
        // each gauntlet held open before the belly (fingers ahead and across, palm down), and worn on its hand
        open: { left: at(before, 'held open left', 0.07, 1.055, 0.36, new Euler(0, -1.92, 0)), right: at(before, 'held open right', -0.07, 1.055, 0.36, new Euler(0, 1.92, 0)) },
        gloved: { left: at(knight.bones.leftHand, 'gloved', 0, 0, 0), right: at(knight.bones.rightHand, 'gloved', 0, 0, 0) },
        // the shield borne on the left forearm across the belly, its face out to the front and left; the lance upright by the right side
        borne: at(before, 'shield borne', 0.2, HIPS + 0.16, 0.3, new Euler(0, Math.PI + 0.35, 0)),
        upright: at(before, 'lance upright', -0.27, HIPS + 0.3, 0.1),
      };
      // (put on from straight above it)
      at(knight.bones.head, 'over the head', 0, 0.4, 0.02);
      places.helmed.userData.approach = ['over the head'];
      const yard = YARD.clone().setX(side * YARD.x), downTheYard = yard.clone().add(new Vector3(0, 1.5, 4));

      /** the eyes on to `next` as what the body moves arrives (run it in a race with that) */
      const ahead = (next: Target) => function* () {
        yield* wait(arriving(knight, LOOK_AHEAD));
        yield* lookAt(knight, next, { until: Infinity });
      };
      let finished = false;
      return {
        scene,
        bodies: [knight],
        story: function* () {
          // the sword belt: both ends off the table, round the hips, the tongue through the buckle, the eyes on it
          yield* grab(knight, gear.buckle, { left: 'end' });
          yield* grab(knight, gear.tongue, { right: 'end' });
          yield* parallel('race', parallel('all', carry(knight, gear.buckle, [...places.buckleRound, places.buckled]), carry(knight, gear.tongue, [...places.tongueRound, places.tongued])),
            lookAt(knight, places.belt, { until: Infinity }), ahead(gear.scabbard));
          release(knight, gear.buckle, places.buckled);
          release(knight, gear.tongue, places.tongued);

          // the sword, in its scabbard, hung at the left hip; its draw checked: the scabbard tilted, the sword drawn 30 cm and sheathed
          yield* grab(knight, gear.scabbard, { left: 'throat' });
          yield* carry(knight, gear.scabbard, [places.aside, places.hanging]);
          yield* parallel('race', lookAt(knight, hilt, { until: Infinity }), function* () {
            yield* carry(knight, gear.scabbard, places.presented);
            yield* grab(knight, gear.sword, { right: 'hilt' });
            yield* carry(knight, gear.sword, drawn);
            yield* wait(0.5);
            yield* carry(knight, gear.sword, mouth);
          });
          release(knight, gear.sword, mouth);
          yield* parallel('race', carry(knight, gear.scabbard, places.hanging), ahead(gear.helm));
          release(knight, gear.scabbard, places.hanging);

          // the helm off its stand in both hands, lifted before the face, raised over the head and lowered on, the head bowed; its strap buckled
          yield* grab(knight, gear.helm, { left: 'left', right: 'right' });
          yield* carry(knight, gear.helm, places.faced);
          yield* wait(0.4);
          yield* parallel('race', carry(knight, gear.helm, [places.raised, places.helmed]), function* () {
            yield* wait(arriving(knight, 1.2));
            yield* lookAt(knight, places.bowed, { until: Infinity });
          });
          release(knight, gear.helm, places.helmed);
          // (the eyes ahead while the hands are under the chin: on the strap, which moves with the head, they would chase it round)
          yield* parallel('race', lookAt(knight, places.level, { until: Infinity }), function* () {
            yield* grab(knight, gear.helm, { left: 'strapLeft', right: 'strapRight' });
            yield* grab(knight, gear.helm, { left: 'chinLeft', right: 'chinRight' });
            yield* wait(0.6);
          });
          release(knight, gear.helm, places.helmed);

          // the gauntlets, each held open by the other hand, the hand sliding in
          for (const [hand, other] of [['left', 'right'], ['right', 'left']] as const) {
            const worn = gear[hand];
            yield* grab(knight, worn, { [other]: 'cuff' });
            yield* carry(knight, worn, places.open[hand]);
            yield* grab(knight, worn, { [hand]: 'inside' }, { speed: 0.3 });
            release(knight, worn, places.gloved[hand]);
          }

          // the shield off its peg: steadied by its edge, the left fist through its strap to the handle, borne on the forearm
          yield* grab(knight, gear.shield, { right: 'edge', left: 'enter' });
          yield* grab(knight, gear.shield, { left: 'handle' }, { speed: 0.3 });
          release(knight, { right: gear.shield });
          yield* parallel('race', carry(knight, gear.shield, places.borne), ahead(gear.lance));

          // the lance out of its rack, upright in the right hand; out to the yard as it comes upright, looking round from a second before he stops
          yield* grab(knight, gear.lance, { right: 'grip' });
          yield* parallel('all', carry(knight, gear.lance, places.upright), function* () {
            yield* wait(arriving(knight, 0.5));
            // (the eyes down the yard as he goes, on the sights round it from a second before he stops)
            yield* parallel('all', walkTo(knight, yard, { face: 0 }), function* () {
              yield* lookAt(knight, downTheYard, { until: arriving(knight, 1) });
              for (const sight of SIGHTS) yield* lookAt(knight, sight, { until: 1.4 });
            });
          });
          finished = true;
        },
        solids: () => solidsOf([gear.scabbard, gear.sword, gear.helm, gear.shield, gear.lance]),
        done: () => finished && knight.holds(gear.shield) && knight.holds(gear.lance) && knight.settled && knight.position.distanceTo(yard) < 0.3 &&
          gear.buckle.parent === places.buckled && gear.tongue.parent === places.tongued && gear.scabbard.parent === places.hanging &&
          gear.sword.parent === mouth && gear.helm.parent === places.helmed &&
          gear.left.parent === places.gloved.left && gear.right.parent === places.gloved.right,
      };
    },
  };
}

/** `thing` laid under `parent` at `position`, turned `yaw` (rad) */
function lay(parent: Object3D, thing: Object3D, position: Vector3, yaw = 0): Object3D {
  thing.position.copy(position);
  thing.rotation.y = yaw;
  parent.add(thing);
  return thing;
}

/** a place things sit in under `furniture` at `position`, taken out (and put back) by way of `out` above or beside it */
function seat(furniture: Object3D, name: string, position: Vector3, out: Vector3): Object3D {
  const place = empty(furniture, name, position);
  empty(furniture, `${name}: out`, position.clone().add(out));
  place.userData.approach = [`${name}: out`];
  return place;
}

/** the table */
function armoury(scene: Group, top: number): void {
  box(scene, 'table top', new Vector3(TABLE.width, 0.04, TABLE.depth), new Vector3(0, top - 0.02, TABLE.z));
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(scene, 'table leg', new Vector3(0.05, top - 0.04, 0.05), new Vector3(x * (TABLE.width / 2 - 0.05), (top - 0.04) / 2, TABLE.z + z * (TABLE.depth / 2 - 0.05)));
}

/** the helm's stand, the shield's wall and its peg, the lance's rack (each in its own frame: left +X, up +Y, away +Z of one facing it) */
function drawFurniture(stand: Object3D, wall: Object3D, rack: Object3D, rise: number): void {
  cylinder(stand, 'stand post', 0.025, STAND.top + rise, new Vector3(0, (STAND.top + rise) / 2, 0));
  box(stand, 'stand foot', new Vector3(0.4, 0.04, 0.4), new Vector3(0, 0.02, 0));
  ball(stand, 'head form', 0.08, new Vector3(0, STAND.top + rise + 0.07, 0));
  for (const x of [-1, 1]) box(wall, 'wall post', new Vector3(0.06, 1.8, 0.06), new Vector3(x * 0.45, 0.9, 0.03));
  box(wall, 'wall rail', new Vector3(1.0, 0.06, 0.06), new Vector3(0, WALL.peg + rise + 0.28, 0.03));
  box(wall, 'wall peg', new Vector3(0.03, 0.03, 0.04), new Vector3(0, WALL.peg + rise + 0.28, -0.02));
  box(rack, 'rack foot', new Vector3(0.6, 0.06, 0.25), new Vector3(0, 0.03, 0));
  box(rack, 'rack post', new Vector3(0.04, 1.5, 0.04), new Vector3(0, 0.75, 0.08));
  box(rack, 'rack bar', new Vector3(0.6, 0.04, 0.12), new Vector3(0, 1.5 + rise, 0.04));
}
