import { BufferGeometry, Group, Line, LineBasicMaterial, Vector3, type Object3D } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { arriving, carry, grab, horse, lookAt, reach, release, wait, walkTo } from '@drawcall/animate';
import type { Scenario, Solid } from '../scenario';
import { HORSE } from '../skeletons';
import { Rope } from '../stage/rope';
import { box, empty } from '../things';

/** where the horse stands tied, facing +Z (m, on the floor) */
export const TIED = new Vector3(-1.2, 0, 3);
/** the saddle rack: where the saddle rests astride its bar, along x, and its legs either side (m) */
const RACK = new Vector3(1.1, 0.88, 2);
const RACK_LEGS = [-0.25, 0.25];
/** the tie rail: along x = −0.35 between its posts at z 3.2 and 4.5, 1.12 m high; the knot on its horse's side (m) */
export const RAIL = { x: -0.35, from: 3.2, to: 4.5, height: 1.12 };
const KNOT = new Vector3(-0.45, 1.12, 3.6);
/** the gate's posts stand at z = 8.2 */
export const GATE = 8.2;
/** the saddle: its seat, a skirt on each side, its weight (kg) */
const SEAT = new Vector3(0.48, 0.16, 0.44);
const SKIRT = new Vector3(0.42, 0.29, 0.05);
const MASS = 8;
/** where it sits on the horse's trunk bone (m) */
const SADDLED = new Vector3(0, 0.23, 0);
/**
 * A lead rope 2.4 m long, tied 1.2 m from the halter (the tie's reach); its slack coiled in the knot's hand 1 m on, more than the
 * hands' span apart, so the rope hangs between them; and what it weighs, the knot and the coil (m, kg)
 */
export const LEAD_ROPE = 2.4;
const KNOT_AT = 1.2;
const SLACK_AT = 2.2;
const ROPE_MASS = { knot: 0.2, slack: 0.1 };
/** the halter's lead ring, on the horse's head bone (m) */
const HALTER = new Vector3(0, -0.3, 0.05);
/** checking the fit: the eyes sweep the saddle front to back in this long (s), the hand on its near skirt the second half of it */
const INSPECT = 0.85;
/** led, the handler walks 0.6 m to the horse's left, its pelvis 0.88 m ahead of the horse's trunk: beside the throatlatch (m) */
const LEAD_ASIDE = 0.6;
const LEAD_AHEAD = 0.88;
/** the leading walk's pace, the horse's catch-up walk's (m/s) */
const LEADING = 0.9;
const CATCHING_UP = 1.6;
/** setting off, the eyes on the horse this long, over the near shoulder (s) */
const LOOK_BACK = 1.5;

/** A morning's small job: fetch, saddle, untie, and go out together. */
export function stableMorning(): Scenario {
  return {
    id: 'stable-morning',
    title: 'Cold morning in the stable yard',
    description: 'A stable hand fetches a heavy saddle, saddles the waiting horse, unties its lead and walks it out through the gate.',
    // Seeded playback can finish after 28 s; leave the final halt visible.
    duration: 29,
    cameraDistance: 4.8,
    // (the front shot from beside the near foreleg, where the handler leads; the side keeps the profile)
    cameraAngles: { front: (5 * Math.PI) / 6, side: (2 * Math.PI) / 3 },
    stage: (cast) => {
      const handler = cast.person({ at: new Vector3(1.5, 0, 0), face: -0.1 });
      const scene = new Group();
      const rail = yard(scene);
      const saddle = saddleOn(scene);
      // (the lead's knot on the rail, its slack coiled in it)
      const knot = empty(rail, 'knot', KNOT.clone().sub(rail.position));
      const slack = empty(knot, 'slack', new Vector3(0, -0.06, 0));
      for (const [part, mass] of [[knot, ROPE_MASS.knot], [slack, ROPE_MASS.slack]] as const) Object.assign(part.userData, { mass, free: true });
      const tied = () => knot.parent === rail;
      let startle: Vector3 | undefined;
      const mare = cast.body(horse(HORSE), {
        at: TIED,
        life: { tether: () => (tied() ? { position: KNOT, length: KNOT_AT } : undefined), startle: () => startle },
      });
      // (its saddle's place on its back, turned the way the handler faces setting it there; the halter its lead hangs from)
      const saddled = empty(mare.bones.trunk, 'saddled', SADDLED);
      saddled.rotation.y = -Math.PI / 2;
      const halter = empty(mare.bones.head, 'halter', HALTER);
      const lead = leadRope(scene, [[0, halter], [KNOT_AT, knot], [SLACK_AT, slack]]);
      // (where the eyes go checking the fit, and the near skirt the hand touches)
      const glance = empty(saddle, 'glance', new Vector3());
      const skirt = empty(saddle, 'near skirt', new Vector3(0, -0.2, -0.32));
      // (where the hands keep the lead walking out, steady as the body goes: the near hand forward of the chest toward the horse, the
      // slack in front of the hip; where the eyes go; and where the horse walks led, in its lane at the handler's side a little behind)
      const height = (bone: Object3D) => bone.getWorldPosition(new Vector3()).y;
      const nearHand = empty(handler.object, 'near hand', new Vector3(-0.5, height(handler.bones.chest) + 0.1, 0.35));
      const slackHand = empty(handler.object, 'slack hand', new Vector3(0.22, height(handler.bones.hips) - 0.08, 0.16));
      const ahead = empty(handler.object, 'ahead', new Vector3(0, height(handler.bones.head), 4));
      const led = empty(scene, 'led', TIED);
      const besideHandler = () => {
        led.position.z = Math.max(TIED.z, handler.position.z - LEAD_AHEAD);
        return led;
      };
      let lookedBack = false, halted = false;
      return {
        scene,
        bodies: [handler, mare],
        story: () => parallel('all',
          action({ update: (_, clock) => lead.step(clock.delta) }),
          lookAt(mare, handler.bones.head, { until: Infinity }),
          // (untied, it walks at the handler's side till the handler halts)
          function* () {
            yield* wait(() => !tied());
            yield* walkTo(mare, besideHandler, { speed: CATCHING_UP, until: () => halted });
          },
          function* () {
            // (its eyes on the saddle's place from when its hands close on the saddle until it is there)
            yield* parallel('race', function* () {
              yield* grab(handler, saddle, { left: 'left', right: 'right' });
              yield* carry(handler, saddle, saddled);
            }, function* () {
              yield* wait(() => handler.holds(saddle));
              yield* lookAt(handler, saddled, { until: Infinity });
            });
            release(handler, saddle, saddled);
            // checking the fit: the eyes sweep it, the hand touches its near skirt, the horse startles at it
            yield* parallel('all', lookAt(handler, sweeping(glance), { until: INSPECT }), function* () {
              yield* wait(INSPECT / 2);
              startle = handler.position.clone();
              yield* reach(handler, { right: skirt }, { until: INSPECT / 2 });
            });
            // untied, the near hand takes the lead up by the halter and passes the slack across into the left hand
            yield* grab(handler, knot, { right: 'knot' });
            yield* grab(handler, slack, { left: 'slack' });
            yield* parallel('all',
              carry(handler, knot, nearHand, { until: Infinity }),
              carry(handler, slack, slackHand, { until: Infinity }),
              // (once both hands hold the lead where they keep it)
              function* () {
                yield* wait(arriving(handler, 0));
                halted = yield* walkTo(handler, new Vector3(TIED.x + LEAD_ASIDE, 0, GATE + 1 + LEAD_AHEAD), { face: 0, speed: LEADING });
              },
              function* () {
                yield* lookAt(handler, mare.bones.head, { until: LOOK_BACK });
                lookedBack = true;
                yield* lookAt(handler, ahead, { until: Infinity });
              },
            );
          },
        ),
        done: () => saddle.parent === saddled && lookedBack && halted && mare.position.z > GATE,
        // (the saddle rack's legs)
        solids: () => RACK_LEGS.map((x): Solid => ({
          name: 'saddle rack leg',
          a: new Vector3(RACK.x + x, 0.03, RACK.z),
          b: new Vector3(RACK.x + x, 0.71, RACK.z),
          radius: Math.SQRT2 * 0.03,
          touches: [],
        })),
      };
    },
  };
}

/** the saddle on its rack under `scene`: its seat, a skirt hanging on each side, a grip at its front and back (taken as the hands come) */
function saddleOn(scene: Group): Object3D {
  const saddle = box(scene, 'saddle', SEAT, RACK);
  saddle.userData.mass = MASS;
  for (const side of [-1, 1]) box(saddle, 'skirt', SKIRT, new Vector3(0, -0.13, side * 0.27));
  empty(saddle, 'left', new Vector3(0.22, 0, 0));
  empty(saddle, 'right', new Vector3(-0.22, 0, 0));
  return saddle;
}

/**
 * The lead rope under `scene` (named 'lead rope'), held where each of `pins` is so far along it (m), the first at one end, laid
 * straight from there through the second to begin with; `step` moves it on a frame's time.
 */
function leadRope(scene: Group, pins: readonly [along: number, at: Object3D][]) {
  const [[, from], [along, through]] = pins.map(([along, at]) => [along, at.getWorldPosition(new Vector3())] as const);
  const rope = new Rope(from, from.clone().lerp(through, LEAD_ROPE / along), LEAD_ROPE);
  const line = new Line(new BufferGeometry().setFromPoints(rope.points), new LineBasicMaterial({ color: 0xc4a273 }));
  line.name = 'lead rope';
  line.frustumCulled = false;
  scene.add(line);
  return {
    step(seconds: number) {
      rope.step(seconds, pins.map(([along, at]) => [along / LEAD_ROPE, at.getWorldPosition(new Vector3())]));
      line.geometry.setFromPoints(rope.points);
    },
  };
}

/** a target sweeping from the front of `glance`'s saddle to its back over `INSPECT` s, from when it is first read */
function sweeping(glance: Object3D) {
  const front = new Vector3(0.65, 0.12, 0), back = new Vector3(-0.65, -0.25, 0);
  let start: number | undefined;
  return (time: number) => {
    glance.position.lerpVectors(front, back, Math.min(1, (time - (start ??= time)) / INSPECT));
    return glance;
  };
}

/** the stable yard under `scene`: the stable's wall and door, the saddle rack, the tie rail and the open gate; the rail */
function yard(scene: Group): Object3D {
  box(scene, 'wall', new Vector3(1.5, 2.3, 0.18), new Vector3(3, 1.15, -0.65));
  box(scene, 'wall', new Vector3(1.5, 2.3, 0.18), new Vector3(-0.2, 1.15, -0.65));
  box(scene, 'lintel', new Vector3(4.7, 0.15, 0.25), new Vector3(1.4, 2.35, -0.65));
  box(scene, 'rack', new Vector3(0.65, 0.08, 0.2), RACK.clone().setY(0.76));
  for (const x of RACK_LEGS) box(scene, 'rack leg', new Vector3(0.06, 0.74, 0.06), new Vector3(RACK.x + x, 0.37, RACK.z));
  for (const z of [RAIL.from, RAIL.to]) box(scene, 'rail post', new Vector3(0.08, 1.2, 0.08), new Vector3(RAIL.x, 0.6, z));
  const rail = box(scene, 'tie rail', new Vector3(0.08, 0.08, RAIL.to - RAIL.from), new Vector3(RAIL.x, RAIL.height, (RAIL.from + RAIL.to) / 2));
  for (const x of [0.9, -2.65]) box(scene, 'gate post', new Vector3(0.15, 1.6, 0.15), new Vector3(x, 0.8, GATE));
  for (const y of [0.55, 1.15]) {
    box(scene, 'gate', new Vector3(0.06, 0.07, 2), new Vector3(0.9, y, GATE + 1));
    box(scene, 'fence', new Vector3(2, 0.07, 0.06), new Vector3(-3.65, y, GATE));
  }
  return rail;
}
