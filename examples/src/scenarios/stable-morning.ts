import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import {
  Body, HORSE_SKELETON, HORSE_WALK, INDEX, Item, Legs, Pose,
  arriving, carry, createWorld, eyesOnBefore, grab, hold, horseLegs, idle,
  named, onBone, release, watch, when, walkTo, withGaze,
  type Behaviour, type Frame, type Humanoid, type Placement, type World,
} from '@drawcall/animate';
import { forwardOf } from '../math';
import { Report, reported, reporting } from '../report';
import type { Prop, Scenario } from '../scenario';
import { skeletonProps } from './legs';

const UP = new Vector3(0, 1, 0);
const WORLD = { position: new Vector3(), quaternion: new Quaternion() };
const HORSE = new Vector3(1.2, 1.32, 3);
const RACK = new Vector3(-1.1, 0.88, 2);
const KNOT = new Vector3(0.35, 1.12, 4.45);
const HEAD = HORSE_SKELETON.index('head');
const NECK = HORSE_SKELETON.index('neck');
const GRIPS = { left: 'left', right: 'right' };
const HANDS = ['leftHand', 'rightHand'];
const SADDLED = new Vector3(0, 0.23, 0);
const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a);
const wait = (seconds: number): Behaviour<World> => function* () {
  yield* action<Frame<World>>({ until: timePassed(seconds, 'seconds') });
};

/** A morning's small job: notice, fetch, saddle, untie, and go out together. */
export function stableMorning(): Scenario {
  return {
    id: 'stable-morning', title: 'Cold morning in the stable yard',
    description: 'A stable hand fetches a heavy saddle, saddles the waiting horse, unties its lead and walks it out through the gate.',
    duration: 44, actors: [{ position: { x: -1.5, z: 0 }, yaw: 0.1 }],
    cameraDistance: 6.5,
    stage: (dev = false) => {
      const report = new Report();
      const saddle = new Item(RACK.clone(), yaw(Math.PI / 2), {
        left: { position: new Vector3(0.22, 0, 0) },
        right: { position: new Vector3(-0.22, 0, 0) },
      }, { mass: 8 });
      const rope = new Item(KNOT.clone(), new Quaternion(), {
        knot: { position: new Vector3() },
      });
      let handler: Humanoid<World> | null = null;
      let saddled = false;
      let leading = false;
      let lookedBack = false;
      const pose = new Pose(HORSE_SKELETON);
      pose.setRoot(HORSE);
      const legs = new Legs(pose, horseLegs(), HORSE_WALK);
      const velocity = new Vector3();
      const horse = new Body(HORSE_SKELETON, () => action<Frame>({ update: (f) => {
        const position = f.prev.position(0).clone();
        const target = leading && handler
          ? handler.pose.position(0).clone().add(new Vector3(1, 0, -1)).setY(HORSE.y)
          : HORSE;
        const wanted = target.clone().sub(position).multiplyScalar(1.8).clampLength(0, 0.95);
        velocity.add(wanted.sub(velocity).clampLength(0, 0.65 * f.dt));
        const at = (t: number) => ({ position: position.clone().addScaledVector(velocity, t - f.time + f.dt), quaternion: new Quaternion() });
        const step = { root: at, speed: velocity.length() };
        if (!legs.supports(f, step)) throw new Error('stable-morning: horse follow forecast cannot support its next step');
        f.current.setRoot(at(f.time).position);
        legs.update(f, step);
        if (saddled) saddle.move(f.time, f.current.position(0).clone().add(SADDLED), yaw(Math.PI / 2));
      } }), { pose, dev });

      const tasks = (h: Humanoid<World>): Behaviour<World> => function* () {
        // A breath and a look across the yard; idle supplies the movement underneath.
        yield* named('cold air at the door', withGaze(h, reported(report, 'gaze', new Vector3(-3, 1.9, 5)), wait(1.3)))();
        yield* named('notice the horse', withGaze(h, reported(report, 'gaze', HORSE.clone().add(new Vector3(0, 0.3, 1))), function* () {
          yield* parallel<Frame<World>>('all',
            walkTo(h, { to: new Vector3(0.35, 0, 3.1), face: Math.PI / 2 }),
            function* () {
              yield* when(arriving(h, 1));
              yield* withGaze(h, reported(report, 'gaze', () => horse.pose.position(HEAD).clone()), wait(1.1))();
            },
          );
        }))();
        yield* named('fetch the saddle', reporting(report, HANDS,
          grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }, {
            face: Math.PI / 2, stand: { ahead: 0.85 }, look: reported(report, 'gaze', () => saddle.current.position),
          })))();
        const carried = (f: Frame<World>): Placement => ({
          position: f.prev.position(0).clone().addScaledVector(forwardOf(h.gait.facing), 0.34).setY(1.08),
          quaternion: yaw(h.gait.facing),
        });
        yield* named('take the weight', reporting(report, HANDS, withGaze(h, reported(report, 'gaze', () => saddle.current.position), function* () {
          yield* carry(h, WORLD, [[saddle, GRIPS, [
            [0.7, (start) => ({ position: start.position.clone().addScaledVector(UP, 0.16) })],
            [1.1, { position: h.pose.position(0).clone().addScaledVector(forwardOf(h.gait.facing), 0.34).setY(1.08), quaternion: yaw(h.gait.facing) }],
          ]]], { scale: 1 })();
        }, { first: false })))();
        yield* named('carry and raise the saddle', reporting(report, HANDS,
          withGaze(h, reported(report, 'gaze', HORSE.clone().add(SADDLED)), function* () {
            yield* parallel<Frame<World>>('all',
              walkTo(h, { to: new Vector3(0.83, 0, 3), face: Math.PI / 2 }),
              function* () {
                yield* hold(h, saddle, GRIPS, { to: carried, until: arriving(h, 0.25) })();
                yield* carry(h, WORLD, [[saddle, GRIPS, [
                  [1.1, { position: new Vector3(0.96, 1.76, 3), quaternion: yaw(Math.PI / 2) }],
                  [0.75, { position: HORSE.clone().add(SADDLED) }],
                ]]], { scale: 1 })();
              },
            );
          }, { first: false })))();
        // Release is the last hand mover; the horse takes the supported saddle next.
        yield* named('hands off, check the fit', function* () {
          yield* parallel<Frame<World>>('all',
            reporting(report, HANDS, release(h, ['left', 'right'], { limit: 1.5, away: { left: new Vector3(0.08, -0.5, -0.25), right: new Vector3(-0.08, -0.5, -0.25) } })),
            function* () {
              yield* withGaze(h, reported(report, 'gaze', () => saddle.current.position), function* () {
                yield* when((f: Frame<World>) => Math.max(f.prev.position(INDEX.leftHand).y, f.prev.position(INDEX.rightHand).y) < 1.25);
                yield* walkTo(h, { to: new Vector3(0.35, 0, 3.02), face: Math.PI / 2, speed: 0.4 })();
                yield* wait(0.65)();
              }, { first: false })();
            },
          );
          saddled = true;
        })();
        yield* named('untie the rail knot', reporting(report, ['leftHand'], function* () {
          yield* grab(h, { left: [rope, 'knot'] }, { face: 0, stand: { ahead: 0.78, aside: 0.18 }, look: reported(report, 'gaze', KNOT) })();
          yield* withGaze(h, reported(report, 'gaze', KNOT), function* () {
            yield* carry(h, WORLD, [[rope, { left: 'knot' }, [
              [0.65, { position: KNOT.clone().add(new Vector3(0.06, 0.08, -0.05)) }],
              [0.85, { position: KNOT.clone().add(new Vector3(-0.05, -0.1, -0.24)) }],
            ]]], { scale: 1 })();
          }, { first: false })();
        }))();
        leading = true;
        yield* named('lead out through the gate', reporting(report, ['leftHand'], function* () {
          yield* parallel<Frame<World>>('all',
            walkTo(h, { to: new Vector3(0.2, 0, 20), speed: 0.75 }),
            hold(h, rope, { left: 'knot' }, { to: onBone(h, INDEX.hips, { position: new Vector3(0.24, 0.12, 0.22) }, { facing: true }) }),
            function* () {
              yield* when((f: Frame<World>) => f.prev.position(0).z > 8.2);
              yield* withGaze(h, reported(report, 'gaze', () => horse.pose.position(HEAD).clone()), wait(1.1))();
              lookedBack = true;
            },
          );
        }))();
      };
      return {
        world: createWorld(), report, bodies: [horse],
        done: () => saddled && leading && lookedBack && horse.pose.position(0).z > 8.2,
        props: () => {
          const root = horse.pose.position(0);
          const muzzle = horse.pose.position(HEAD).clone().add(new Vector3(0, -0.42, 0.33));
          const poll = horse.pose.position(HEAD);
          const props: Prop[] = [...yard(), ...skeletonProps(horse.pose),
            line(horse.pose.position(NECK), poll, 0.1, 0x9b744c),
            line(poll, muzzle, 0.1, 0x9b744c),
            box(root.clone().add(new Vector3(0, -0.13, -0.04)), 0.48, 0.48, 1.45),
            box(saddle.current.position.clone(), 0.48, 0.16, 0.44, saddle.current.quaternion.clone()),
          ];
          // Two skirts make the simple saddle read above the horse's barrel.
          for (const side of [-1, 1]) props.push(box(new Vector3(side * 0.25, -0.13, 0).applyQuaternion(saddle.current.quaternion).add(saddle.current.position), 0.05, 0.29, 0.42, saddle.current.quaternion.clone()));
          const end = rope.current.position;
          const middle = muzzle.clone().lerp(end, 0.5).add(new Vector3(0, -0.14, 0));
          props.push(line(muzzle, middle, 0.012, 0xc4a273), line(middle, end, 0.012, 0xc4a273));
          if (!leading) props.push(line(end, KNOT, 0.012, 0xc4a273));
          return props;
        },
        script: (h) => {
          handler = h;
          return function* () {
            yield* parallel<Frame<World>>('all',
              eyesOnBefore(h, saddle, 0.4), eyesOnBefore(h, rope, 0.4),
              watch<World>('saddle stays aboard', () => {
                if (!saddled) return null;
                const off = saddle.current.position.distanceTo(horse.pose.position(0).clone().add(SADDLED));
                return off > 0.03 ? { check: 'back offset (m)', value: off, limit: 0.03, where: 'saddle' } : null;
              }),
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
