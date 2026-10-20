import { Box3, Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { Body, HORSE_SKELETON, Item, Pose, place, facingAt, createWorld, eyesOnBefore, grab, handTo, hold, horseFollow, horseLeadPoint, idle, named, onBone, release, watch, wear, when, walkTo, withGaze, yawOf, type Behaviour, type Frame, type Humanoid, type World } from '@drawcall/animate';
import { Rope } from '../../../packages/animate/src/core/rope';
import { reachFor } from '../../../packages/animate/src/humanoid/hands/reach';
import { forwardOf } from '../math';
import { Report, reported, reporting } from '../report';
import type { Prop, Scenario } from '../scenario';
import { skeletonProps, line } from '../stage/props';

const UP = new Vector3(0, 1, 0);
// Tuned: 3 cm below square standing, rather than an 8 cm crouch; contacts plan further reserve.
export const HORSE = new Vector3(-1.2, 1.37, 3);
const RACK = new Vector3(1.1, 0.88, 2);
const KNOT = new Vector3(-0.25, 1.12, 3.6);
const HEAD = HORSE_SKELETON.index('head');
const NECK = HORSE_SKELETON.index('neck');
const APPENDAGES = [
  { bone: HORSE_SKELETON.index('leftEar'), tip: new Vector3(0, 0.18, 0.05), radius: 0.035 },
  { bone: HORSE_SKELETON.index('rightEar'), tip: new Vector3(0, 0.18, 0.05), radius: 0.035 },
  { bone: HORSE_SKELETON.index('tail'), tip: new Vector3(0, -0.6, -0.25), radius: 0.025 },
];
const HANDS = ['leftHand', 'rightHand'];
// Four Life seeds settle at 22.95–23.13 s; retain 1.27–1.45 s of idle.
const DURATION = 24.4;
const INSPECT = 0.85;
// Tuned matched walk through braking, checked against solved hip excursion (m/s).
const LEADING = { speed: 0.9 };
// Tuned pelvis station ahead of the horse pelvis (m), placing the handler beside the throatlatch.
const HANDLER_AHEAD = 1.22;
// Tuned lane beside the head, outside the foreleg swing (m).
const LEAD_ASIDE = 0.55;
// Minimum station-transition distance; a larger station change gets enough travel to stay monotonic (m).
const LEAD_EASE = 0.5;
// Tuned here against the visible halter distance: near hand below the jaw; slack hand low beside the hip (m).
const HALTER = new Vector3(0, -0.3, 0.05);
const NEAR_HAND = new Vector3(-0.4, 0.04, 0.3);
const SLACK_HAND = new Vector3(0.22, -0.08, 0.16);
// A 2.4 m lead rope: 1.2 m from the halter to the knot (the tie's reach), the slack beyond it; the
// second hand takes the slack where it meets it, offered 60 cm past the knot hand (about the
// hands' span, so it hangs between them) (m, and shares of its length).
export const LEAD_ROPE = 2.4;
const KNOT_AT = 1.2 / LEAD_ROPE;
const GATHER_AT = 1.8 / LEAD_ROPE;
// Tuned: a reaching hand closes on swinging rope within a palm's width of it (m).
const CATCH = 0.05;
// Tuned: the rope between the hands is a fifth longer than their span, so it hangs in a shallow loop.
const SLIDE = 1.2;
// Requested scene acceptance bound for the gathering elbow behind its shoulder (m).
const GATHER_BACK = 0.08;
// Read from half the 1.45 m barrel and half the 0.15 m gate post: halt with the trunk beyond the opening.
const BARREL_LENGTH = 1.45;
const GATE_POST = 0.15;
const GATE_CLEAR = (BARREL_LENGTH + GATE_POST) / 2;
// Original saddle proxy mesh dimensions (m); the carry envelope and drawing share them.
const SEAT = new Vector3(0.48, 0.16, 0.44);
const SKIRT = new Vector3(0.42, 0.29, 0.05);
const SKIRT_DROP = 0.13;
const SKIRT_ASIDE = 0.27;
const SADDLE_BOUNDS = new Box3().setFromCenterAndSize(new Vector3(), SEAT);
for (const side of [-1, 1]) SADDLE_BOUNDS.union(new Box3().setFromCenterAndSize(new Vector3(0, -SKIRT_DROP, side * SKIRT_ASIDE), SKIRT));
const SADDLED = new Vector3(0, 0.23, 0);
const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a);

/** A morning's small job: notice, fetch, saddle, untie, and go out together. */
export function stableMorning(): Scenario {
  return {
    id: 'stable-morning', title: 'Cold morning in the stable yard',
    description: 'A stable hand fetches a heavy saddle, saddles the waiting horse, unties its lead and walks it out through the gate.',
    duration: DURATION, actors: [{ position: { x: 1.5, z: 0 }, yaw: -0.1 }],
    cameraDistance: 4.8,
    // Front moved from π/3 to 5π/6 to open the handler’s leading lane beside the near foreleg; side retains the profile.
    cameraAngles: { front: 5 * Math.PI / 6, side: 2 * Math.PI / 3 },
    stage: (dev = false) => {
      const report = new Report();
      const saddle = new Item(RACK.clone(), yaw(Math.PI / 2), {
        left: { position: new Vector3(0.22, 0, 0) },
        right: { position: new Vector3(-0.22, 0, 0) },
      }, { name: 'saddle', mass: 8, bounds: SADDLE_BOUNDS });
      const rope = new Item(KNOT.clone(), new Quaternion(), {
        knot: { position: new Vector3() },
      }, { name: 'rope' });
      // Where the second hand gathers the slack: it lies on the rope until taken.
      const loose = new Item(KNOT.clone(), new Quaternion(), {
        end: { position: new Vector3() },
      }, { name: 'rope slack' });
      let handler: Humanoid<World> | null = null;
      let lookedBack = false;
      let leadStart: number | null = null;
      const pose = new Pose(HORSE_SKELETON);
      pose.setRoot(HORSE);
      const follow = horseFollow(pose, () => {
        const travel = leadStart !== null && handler ? Math.max(0, handler.pose.position(0).z - leadStart) : 0;
        const reserve = leadStart === null ? 0 : HANDLER_AHEAD - (leadStart - HORSE.z);
        // Keep the target moving forward: the station change consumes at most half of the handler's travel.
        const length = Math.max(LEAD_EASE, 2 * Math.abs(reserve));
        const ease = Math.exp(-travel / length);
        const ahead = travel - reserve * (1 - ease);
        // The gate and horse share this straight lane; do not chase the handler's pelvic sway.
        const target = new Vector3(HORSE.x, HORSE.y, HORSE.z + ahead);
        const velocity = leadStart !== null && handler
          ? new Vector3(0, 0, handler.locomotion.velocity.z * (1 - reserve * ease / length)) : new Vector3();
        return { position: target, velocity };
      }, { person: () => handler?.pose.position(handler.pose.skeleton.index('head')),
        tether: () => rope.supported ? { position: KNOT, length: 1.2 } : undefined });
      const horse = new Body(HORSE_SKELETON, follow, { pose, dev });
      const halterAt = () => horse.pose.point(HEAD, HALTER, new Vector3());
      const lead = new Rope(halterAt(), KNOT.clone().lerp(halterAt(), -1 / KNOT_AT + 1), LEAD_ROPE);
      let gathering = false;

      const saddlePlace = onBone(horse, 0, { position: SADDLED, quaternion: yaw(-Math.PI / 2) });
      const gate = new Vector3(-0.2, 0, 8.2);
      const tasks = (h: Humanoid<World>): Behaviour<World> => function* () {
        yield* named('fetch the saddle', reporting(report, HANDS,
          grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }, {
            look: reported(report, 'gaze', () => saddle.current.position),
          })))();
        yield* named('carry and raise the saddle', reporting(report, HANDS,
          place(h, saddle, saddlePlace)))();
        yield* named('hands off, check the fit', function* () {
          yield* wear(horse, saddle, 0, { to: { position: SADDLED, quaternion: yaw(-Math.PI / 2) } })();
          follow.react(h.pose.position(0));
          yield* release(h, ['left', 'right'])();
          let start: number | null = null;
          yield* parallel<Frame<World>>('all',
            withGaze(h, reported(report, 'gaze', (f) => {
              start ??= f.time;
              const u = Math.min(1, (f.time - start) / INSPECT);
              return saddle.current.position.clone().add(new Vector3(0, 0.12 - 0.37 * u, 0.65 - 1.3 * u));
            }), () => when(timePassed(INSPECT, 'seconds'))),
            function* () {
              yield* when(timePassed(INSPECT / 2, 'seconds'));
              follow.react(h.pose.position(0));
              yield* parallel<Frame<World>>('race',
                () => when(timePassed(INSPECT / 2, 'seconds')),
                handTo(h, 'right', reported(report, 'rightHand', () => ({ position: saddle.current.position.clone().add(new Vector3(0.27, -0.25, 0)) })), { lead: false }),
              );
            },
          );
        })();
        yield* named('untie the rail knot', reporting(report, ['rightHand'], function* () {
          yield* grab(h, { right: [rope, 'knot'] }, { look: reported(report, 'gaze', KNOT) })();
        }))();
        yield* named('lead out through the gate', reporting(report, HANDS, function* () {
          const comfortable = facingAt(h, h.pose.skeleton.index('chest'), { position: NEAR_HAND });
          const near = (f: Frame<World>) => {
            const heading = yawOf(horse.pose.rotation(0));
            const halter = horseLeadPoint(horse.pose, new Vector3()), goal = comfortable(f);
            const aside = forwardOf(heading + Math.PI / 2);
            goal.position.addScaledVector(aside, 0.2 - goal.position.clone().sub(halter).dot(aside));
            return goal;
          };
          const slack = facingAt(h, 0, { position: SLACK_HAND });
          yield* parallel<Frame<World>>('race',
            function* () {
              yield* when(() => h.feet.some((foot) => foot.phase === 'swing'));
              leadStart = h.pose.position(0).z;
              yield* when(() => false);
            },
            function* () {
              yield* hold(h, rope, { to: near, until: timePassed(0.6, 'seconds') })();
              yield* hold(h, rope, { to: near })();
            },
            function* () {
              gathering = true;
              yield* reachFor(h, { left: [loose, 'end'] })();
              yield* hold(h, loose, { to: slack })();
            },
            function* () {
              yield* walkTo(h, { to: new Vector3(HORSE.x + LEAD_ASIDE, 0, gate.z + HANDLER_AHEAD + GATE_CLEAR), face: 0, ...LEADING })();
              yield* named('halt beyond the gate', () => when(timePassed(1, 'seconds')))();
            },
            function* () {
              // Look back as they set off, then attend to the short walk through the gate.
              yield* when(() => h.feet.some((foot) => foot.phase === 'swing'));
              yield* withGaze(h, reported(report, 'gaze', new Vector3(3, 1.75, -0.65)),
                () => when(timePassed(1.5, 'seconds')), { first: true })();
              lookedBack = true;
              yield* withGaze(h, reported(report, 'gaze', (f) => f.prev.position(0).clone().add(new Vector3(0, 0.5, 4))),
                () => when(() => false))();
            },
          );
        }))();
      };
      return {
        world: createWorld(), report, bodies: [horse],
        solids: () => [-0.2, 0.2].map((x) => ({
          name: 'saddle rack leg',
          a: RACK.clone().add(new Vector3(x, 0, 0)).setY(0.03),
          b: RACK.clone().add(new Vector3(x, 0, 0)).setY(0.71),
          radius: Math.SQRT2 * 0.03, touches: [],
        })),
        done: () => saddle.wornBy === horse && lookedBack && horse.pose.position(0).clone().sub(gate).dot(forwardOf(0)) > 0 && !!handler?.locomotion.settled,
        props: () => {
          const muzzle = horse.pose.point(HEAD, new Vector3(0, -0.42, 0.33), new Vector3());
          const poll = horse.pose.position(HEAD);
          const props: Prop[] = [...yard(), ...skeletonProps(horse.pose),
            line(horse.pose.position(NECK), poll, 0.1, 0x9b744c),
            line(poll, muzzle, 0.1, 0x9b744c),
            box(horse.pose.point(0, new Vector3(0, -0.13, -0.04), new Vector3()), 0.48, 0.48, BARREL_LENGTH, horse.pose.rotation(0).clone()),
            box(saddle.current.position.clone(), SEAT.x, SEAT.y, SEAT.z, saddle.current.quaternion.clone()),
          ];
          for (const { bone, tip, radius } of APPENDAGES) {
            props.push(line(horse.pose.position(bone), horse.pose.point(bone, tip, new Vector3()), radius, 0x9b744c));
          }
          // Two skirts make the simple saddle read above the horse's barrel.
          for (const side of [-1, 1]) props.push(box(new Vector3(0, -SKIRT_DROP, side * SKIRT_ASIDE).applyQuaternion(saddle.current.quaternion).add(saddle.current.position), SKIRT.x, SKIRT.y, SKIRT.z, saddle.current.quaternion.clone()));
          const { points } = lead;
          for (let k = 1; k < points.length; k++) props.push(line(points[k - 1].clone(), points[k].clone(), 0.012, 0xc4a273));
          return props;
        },
        script: (h) => {
          handler = h;
          return function* () {
            // The lead rope hangs from the halter and whatever holds it; ungathered, the slack's
            // gathering point moves with the rope.
            const gathered = () => h.holding.left?.item === loose;
            const leftHand = h.pose.skeleton.index('leftHand');
            let caught = false;
            let gatherAt = GATHER_AT;
            const swing = action<Frame<World>>({
              update: (f) => {
                const hand = f.current.position(leftHand);
                if (gathering && !caught) gatherAt = lead.nearest(hand, KNOT_AT + 0.1, 1);
                caught ||= gathering && hand.distanceTo(lead.at(gatherAt)) < CATCH;
                // The rope slides through the gathering hand as the hands part: it keeps more rope between them than their span.
                if (caught) gatherAt = Math.min(1, Math.max(gatherAt, KNOT_AT + SLIDE * hand.distanceTo(rope.current.position) / LEAD_ROPE));
                const pinned: [number, Vector3][] = [[0, halterAt()], [KNOT_AT, rope.current.position]];
                if (caught) pinned.push([gatherAt, loose.current.position]);
                lead.step(f.dt, pinned);
                // Caught, the rope point goes with the closing hand until the hold carries it.
                if (!gathered() && !loose.moved(f.time)) loose.move(f.time, caught ? hand : lead.at(gatherAt));
              },
            });
            yield* parallel<Frame<World>>('all',
              eyesOnBefore(h, saddle, 0.4), eyesOnBefore(h, rope, 0.4),
              watch('gather the loose end', (f) => {
                if (h.holding.right?.item !== rope || h.holding.left?.item === loose) return null;
                const p = f.prev, bone = (name: string) => p.skeleton.index(name);
                const elbow = p.position(bone('leftLowerArm')).clone().sub(p.position(bone('leftUpperArm')))
                  .applyQuaternion(p.rotation(bone('chest')).clone().invert());
                const value = -elbow.z;
                return value > GATHER_BACK
                  ? { check: 'elbow behind shoulder (m)', value, limit: GATHER_BACK, where: 'left elbow' } : null;
              }),
              idle(h), tasks(h), () => swing,
            );
          };
        },
      };
    },
  };
}

function box(position: Vector3, x: number, y: number, z: number, quaternion?: Quaternion): Prop {
  return { kind: 'box', position, size: new Vector3(x, y, z), quaternion };
}
function yard(): Prop[] {
  return [
    // Door opening, lintel and stable wings, low rack, tie rail, and open gate.
    box(new Vector3(3, 1.15, -0.65), 1.5, 2.3, 0.18),
    box(new Vector3(-0.2, 1.15, -0.65), 1.5, 2.3, 0.18),
    box(new Vector3(1.4, 2.35, -0.65), 4.7, 0.15, 0.25),
    box(RACK.clone().setY(0.76), 0.48, 0.08, 0.65),
    ...[-0.2, 0.2].map((x) => box(RACK.clone().add(new Vector3(x, 0, 0)).setY(0.37), 0.06, 0.74, 0.06)),
    box(new Vector3(-0.35, 0.6, 4.5), 0.08, 1.2, 0.08),
    box(new Vector3(-0.35, 1.12, 3.65), 0.08, 0.08, 1.7),
    box(new Vector3(-0.35, 0.6, 2.8), 0.08, 1.2, 0.08),
    ...[0.9, -2.65].map((x) => box(new Vector3(x, 0.8, 8.2), GATE_POST, 1.6, GATE_POST)),
    ...[0.55, 1.15].map((y) => box(new Vector3(0.9, y, 9.2), 0.06, 0.07, 2)),
    ...[0.55, 1.15].map((y) => box(new Vector3(-3.65, y, 8.2), 2, 0.07, 0.06)),
  ];
}
