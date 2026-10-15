import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import {
  Body, HORSE_SKELETON, HORSE_WALK, Item, Legs, Pose,
  approach, arriving, carried, carry, createWorld, eyesOnBefore, grab, handTo, hold, horseLegs, horseCarriage, horsePelvis, idle,
  named, onBone, openHand, wear, when, walkTo, withGaze,
  type Behaviour, type Frame, type Humanoid, type World,
} from '@drawcall/animate';
import { forwardOf } from '../math';
import { Report, reported, reporting } from '../report';
import type { Prop, Scenario } from '../scenario';
import { skeletonProps } from './legs';

const UP = new Vector3(0, 1, 0);
// Tuned: 3 cm below square standing, rather than an 8 cm crouch; contacts plan further reserve.
const HORSE = new Vector3(1.2, 1.37, 3);
const RACK = new Vector3(-1.1, 0.88, 2);
const KNOT = new Vector3(0.25, 1.12, 3.6);
const HEAD = HORSE_SKELETON.index('head');
const NECK = HORSE_SKELETON.index('neck');
const HANDS = ['leftHand', 'rightHand'];
const INSPECT = 0.85;
const SADDLED = new Vector3(0, 0.23, 0);
const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a);

/** A morning's small job: notice, fetch, saddle, untie, and go out together. */
export function stableMorning(): Scenario {
  return {
    id: 'stable-morning', title: 'Cold morning in the stable yard',
    description: 'A stable hand fetches a heavy saddle, saddles the waiting horse, unties its lead and walks it out through the gate.',
    duration: 50, actors: [{ position: { x: -1.5, z: 0 }, yaw: 0.1 }],
    cameraDistance: 4.8, facing: -Math.PI / 3,
    cameraAngles: { front: -Math.PI / 3, side: -11 * Math.PI / 18 },
    stage: (dev = false) => {
      const report = new Report();
      const saddle = new Item(RACK.clone(), yaw(-Math.PI / 2), {
        left: { position: new Vector3(0.22, 0, 0) },
        right: { position: new Vector3(-0.22, 0, 0) },
      }, { name: 'saddle', mass: 8 });
      const rope = new Item(KNOT.clone(), new Quaternion(), {
        knot: { position: new Vector3() },
      }, { name: 'rope' });
      let handler: Humanoid<World> | null = null;
      let lookedBack = false;
      let leading = false;
      const pose = new Pose(HORSE_SKELETON);
      pose.setRoot(HORSE);
      const legs = new Legs(pose, horseLegs(), HORSE_WALK);
      const horse = new Body(HORSE_SKELETON, () => action<Frame>({ update: (f) => {
        // Muzzle is 1.63 m ahead of the root. At 0.95 m/s the pursuit lag is
        // v²/(2a) = 0.69 m: a 1.6 m offset leaves about 0.66 m of lead, beside the handler.
        const ahead = leading && handler ? Math.max(0, handler.pose.position(0).z - HORSE.z - 1.6) : 0;
        // The gate and horse share this straight lane; do not chase the handler's pelvic sway.
        const target = new Vector3(HORSE.x, HORSE.y, HORSE.z + ahead);
        const velocity = leading && handler ? new Vector3(0, 0, handler.gait.velocity.z) : new Vector3();
        if (ahead === 0) velocity.set(0, 0, 0);
        horsePelvis(f, legs);
        legs.toward(f, { position: target, velocity }, { speed: 0.95, accel: 0.65 });
        horseCarriage(f, legs, handler?.pose.position(handler.pose.skeleton.index('head')));
      } }), { pose, dev });

      const saddlePlace = onBone(horse, 0, { position: SADDLED, quaternion: yaw(Math.PI / 2) });
      const gate = new Vector3(0.2, 0, 8.2);
      const tasks = (h: Humanoid<World>): Behaviour<World> => function* () {
        // A breath and a look across the yard; idle supplies the movement underneath.
        yield* named('cold air at the door', withGaze(h, reported(report, 'gaze', new Vector3(-3, 1.9, 5)), () => when(timePassed(1.3, 'seconds'))))();
        yield* named('cross the yard', withGaze(h, reported(report, 'gaze', new Vector3(0.2, 1.4, 4)), walkTo(h, { to: new Vector3(0.2, 0, 2.5), face: 0 }), { first: false }))();
        yield* named('notice the horse', withGaze(h, reported(report, 'gaze', () => horse.pose.position(HEAD).clone()),
          () => when(timePassed(0.65, 'seconds')), { first: false }))();
        yield* named('fetch the saddle', reporting(report, HANDS,
          grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }, {
            face: -Math.PI / 2, stand: { ahead: 1.05 * h.proportions.armLength }, look: reported(report, 'gaze', () => saddle.current.position), first: false,
          })))();
        yield* named('carry and raise the saddle', reporting(report, HANDS,
          withGaze(h, reported(report, 'gaze', () => saddlePlace(horse.frame).position), function* () {
            yield* parallel<Frame<World>>('all',
              approach(h, saddlePlace(horse.frame).position, { face: Math.PI / 2 }),
              function* () {
                yield* carry(h, saddle, [[0.35, carried(h)]])();
                yield* hold(h, saddle, { to: carried(h), until: arriving(h, 0.25) })();
                yield* carry(h, saddle, [
                  [1.1, { position: SADDLED.clone().add(new Vector3(-0.24, 0.21, 0)), quaternion: yaw(Math.PI / 2) }],
                  [0.75, { position: SADDLED, quaternion: yaw(Math.PI / 2) }],
                ], { on: [horse, 0], support: true })();
              },
            );
          }, { first: false })))();
        yield* named('hands off, check the fit', function* () {
          yield* wear(horse, saddle, 0, { to: { position: SADDLED, quaternion: yaw(Math.PI / 2) } })();
          // The right hand immediately inspects; don't give release a competing arm target.
          yield* openHand(h, 'left')();
          yield* openHand(h, 'right')();
          let start: number | null = null;
          yield* parallel<Frame<World>>('all',
            withGaze(h, reported(report, 'gaze', (f) => {
              start ??= f.time;
              const u = Math.min(1, (f.time - start) / INSPECT);
              return saddle.current.position.clone().add(new Vector3(0, 0.12 - 0.37 * u, 0.65 - 1.3 * u));
            }), () => when(timePassed(INSPECT, 'seconds')), { first: false }),
            function* () {
              yield* parallel<Frame<World>>('race',
                () => when(timePassed(INSPECT, 'seconds')),
                handTo(h, 'right', reported(report, 'rightHand', () => ({ position: saddle.current.position.clone().add(new Vector3(-0.27, -0.25, 0)) })), { lead: false }),
              );
            },
          );
        })();
        yield* named('untie the rail knot', reporting(report, ['rightHand'], function* () {
          yield* grab(h, { right: [rope, 'knot'] }, { face: 0, stand: { ahead: 0.4, aside: -0.4 }, look: reported(report, 'gaze', KNOT), first: false })();
          yield* withGaze(h, reported(report, 'gaze', () => rope.current.position), function* () {
            yield* carry(h, rope, [
              [0.55, { position: KNOT.clone().add(new Vector3(0.1, 0.12, -0.08)) }],
              [0.5, { position: KNOT.clone().add(new Vector3(0.2, -0.1, -0.18)) }],
              [0.45, { position: KNOT.clone().add(new Vector3(0.08, 0.08, -0.06)) }],
              [0.5, { position: KNOT.clone().add(new Vector3(0.23, -0.12, -0.22)) }],
            ])();
          }, { first: false })();
        }))();
        yield* named('lead out through the gate', reporting(report, ['rightHand'], function* () {
          const beside = carried(h, 'right');
          const low = (f: Frame<World>) => {
            const goal = beside(f);
            // A slack lead rests just below the hip, within an upright arm's reach.
            goal.position.y -= 0.12 * h.scale;
            return goal;
          };
          let stopped: Vector3 | null = null;
          yield* parallel<Frame<World>>('all',
            hold(h, rope, { to: (f) => stopped ? { position: stopped } : low(f) }),
            function* () {
              yield* walkTo(h, { to: new Vector3(0.2, 0, gate.z - 2.5), face: -0.6, speed: 0.95 })();
              stopped = rope.current.position.clone();
              yield* parallel<Frame<World>>('race',
                withGaze(h, reported(report, 'gaze', new Vector3(-3, 1.75, -0.65)),
                  () => when(timePassed(1.5, 'seconds')), { lead: 0 }),
                action<Frame<World>>({ update: (_, __, time) => { if (time < 0.3) h.asks.twist = 0; } }),
              );
              stopped = null;
              lookedBack = true;
              leading = true;
              yield* withGaze(h, reported(report, 'gaze', (f) => f.prev.position(0).clone().add(new Vector3(0, 0.5, 4))),
                walkTo(h, { to: new Vector3(0.2, 0, 30), speed: 0.95 }), { first: false })();
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
        focus: () => {
          if (!handler) throw new Error('stable framing needs its handler');
          const at = handler.pose.position(0).clone().setY(0.54 * handler.proportions.height);
          return saddle.wornBy === horse ? at.lerp(horse.pose.position(0).clone().setY(1), 0.5) : at;
        },
        done: () => saddle.wornBy === horse && lookedBack && horse.pose.position(0).clone().sub(gate).dot(forwardOf(0)) > 0,
        props: () => {
          const root = horse.pose.position(0);
          const muzzle = horse.pose.point(HEAD, new Vector3(0, -0.42, 0.33), new Vector3());
          const poll = horse.pose.position(HEAD);
          const props: Prop[] = [...yard(), ...skeletonProps(horse.pose),
            line(horse.pose.position(NECK), poll, 0.1, 0x9b744c),
            line(poll, muzzle, 0.1, 0x9b744c),
            box(root.clone().add(new Vector3(0, -0.13, -0.04)), 0.48, 0.48, 1.45, horse.pose.rotation(0).clone()),
            box(saddle.current.position.clone(), 0.48, 0.16, 0.44, saddle.current.quaternion.clone()),
          ];
          // Two skirts make the simple saddle read above the horse's barrel.
          for (const side of [-1, 1]) props.push(box(new Vector3(side * 0.25, -0.13, 0).applyQuaternion(saddle.current.quaternion).add(saddle.current.position), 0.05, 0.29, 0.42, saddle.current.quaternion.clone()));
          const end = rope.current.position;
          const at = (u: number) => muzzle.clone().lerp(end, u).add(new Vector3(0, -0.32 * 4 * u * (1 - u), 0));
          for (let i = 0; i < 12; i++) {
            props.push(line(at(i / 12), at((i + 1) / 12), 0.012, 0xc4a273));
          }
          if (rope.supported) props.push(line(end, KNOT, 0.012, 0xc4a273));
          return props;
        },
        script: (h) => {
          handler = h;
          return function* () {
            yield* parallel<Frame<World>>('all',
              eyesOnBefore(h, saddle, 0.4), eyesOnBefore(h, rope, 0.4),
              idle(h), tasks(h),
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
function line(a: Vector3, b: Vector3, radius: number, color: number): Prop {
  const delta = b.clone().sub(a);
  return { kind: 'cylinder', position: a.clone().lerp(b, 0.5), radius, length: delta.length(), quaternion: new Quaternion().setFromUnitVectors(UP, delta.normalize()), color };
}
function yard(): Prop[] {
  return [
    // Door opening, lintel and stable wings, low rack, tie rail, and open gate.
    box(new Vector3(-3, 1.15, -0.65), 1.5, 2.3, 0.18),
    box(new Vector3(0.2, 1.15, -0.65), 1.5, 2.3, 0.18),
    box(new Vector3(-1.4, 2.35, -0.65), 4.7, 0.15, 0.25),
    box(RACK.clone().setY(0.76), 0.48, 0.08, 0.65),
    ...[-0.2, 0.2].map((x) => box(RACK.clone().add(new Vector3(x, 0, 0)).setY(0.37), 0.06, 0.74, 0.06)),
    box(new Vector3(0.35, 0.6, 4.5), 0.08, 1.2, 0.08),
    box(new Vector3(0.35, 1.12, 3.65), 0.08, 0.08, 1.7),
    box(new Vector3(0.35, 0.6, 2.8), 0.08, 1.2, 0.08),
    ...[-0.9, 2.65].map((x) => box(new Vector3(x, 0.8, 8.2), 0.15, 1.6, 0.15)),
    ...[0.55, 1.15].map((y) => box(new Vector3(-0.9, y, 9.2), 0.06, 0.07, 2)),
    ...[0.55, 1.15].map((y) => box(new Vector3(3.65, y, 8.2), 2, 0.07, 0.06)),
  ];
}
