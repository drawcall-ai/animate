import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import {
  Body, HORSE_SKELETON, HORSE_WALK, Item, Legs, Pose,
  approach, arriving, carried, carry, createWorld, eyesOnBefore, grab, hold, horseLegs, idle,
  named, onBone, release, wear, when, walkTo, withGaze,
  type Behaviour, type Frame, type Humanoid, type World,
} from '@drawcall/animate';
import { forwardOf } from '../math';
import { Report, reported, reporting } from '../report';
import type { Prop, Scenario } from '../scenario';
import { skeletonProps } from './legs';

const UP = new Vector3(0, 1, 0);
const HORSE = new Vector3(1.2, 1.32, 3);
const RACK = new Vector3(-1.1, 0.88, 2);
const KNOT = new Vector3(0.35, 1.12, 4.45);
const HEAD = HORSE_SKELETON.index('head');
const NECK = HORSE_SKELETON.index('neck');
const HANDS = ['leftHand', 'rightHand'];
const SADDLED = new Vector3(0, 0.23, 0);
const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a);

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
      }, { name: 'saddle', mass: 8 });
      const rope = new Item(KNOT.clone(), new Quaternion(), {
        knot: { position: new Vector3() },
      }, { name: 'rope' });
      let handler: Humanoid<World> | null = null;
      let lookedBack = false;
      const pose = new Pose(HORSE_SKELETON);
      pose.setRoot(HORSE);
      const legs = new Legs(pose, horseLegs(), HORSE_WALK);
      const velocity = new Vector3();
      const horse = new Body(HORSE_SKELETON, () => action<Frame>({ update: (f) => {
        const position = f.prev.position(0).clone();
        const target = handler?.holding.left?.item === rope && !rope.supported && handler
          ? handler.pose.position(0).clone().add(new Vector3(1, 0, -1)).setY(HORSE.y)
          : HORSE;
        const wanted = target.clone().sub(position).multiplyScalar(1.8).clampLength(0, 0.95);
        velocity.add(wanted.sub(velocity).clampLength(0, 0.65 * f.dt));
        const at = (t: number) => ({ position: position.clone().addScaledVector(velocity, t - f.time + f.dt), quaternion: new Quaternion() });
        const step = { root: at, speed: velocity.length() };
        if (!legs.supports(f, step)) throw new Error('stable-morning: horse follow forecast cannot support its next step');
        f.current.setRoot(at(f.time).position);
        legs.update(f, step);
      } }), { pose, dev });

      const saddlePlace = onBone<World>(horse, 0, { position: SADDLED, quaternion: yaw(Math.PI / 2) });
      const gate = new Vector3(0.2, 0, 8.2);
      const tasks = (h: Humanoid<World>): Behaviour<World> => function* () {
        // A breath and a look across the yard; idle supplies the movement underneath.
        yield* named('cold air at the door', withGaze(h, reported(report, 'gaze', new Vector3(-3, 1.9, 5)), () => when(timePassed(1.3, 'seconds'))))();
        yield* named('notice the horse', withGaze(h, reported(report, 'gaze', HORSE.clone().add(new Vector3(0, 0.3, 1))), function* () {
          yield* parallel<Frame<World>>('all',
            approach(h, horse.pose.position(0), { face: Math.PI / 2 }),
            function* () {
              yield* when(arriving(h, 1));
              yield* withGaze(h, reported(report, 'gaze', () => horse.pose.position(HEAD).clone()), () => when(timePassed(1.1, 'seconds')))();
            },
          );
        }))();
        yield* named('fetch the saddle', reporting(report, HANDS,
          grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }, {
            face: Math.PI / 2, look: reported(report, 'gaze', () => saddle.current.position),
          })))();
        yield* named('take the weight', reporting(report, HANDS,
          withGaze(h, reported(report, 'gaze', () => saddle.current.position),
            carry(h, saddle, [[1.5, carried(h)()]]))))();
        yield* named('carry and raise the saddle', reporting(report, HANDS,
          withGaze(h, reported(report, 'gaze', () => saddlePlace().position), function* () {
            yield* parallel<Frame<World>>('all',
              approach(h, saddlePlace().position, { face: Math.PI / 2 }),
              function* () {
                yield* hold(h, saddle, { to: carried(h), until: arriving(h, 0.25) })();
                yield* carry(h, saddle, [
                  [1.1, { position: SADDLED.clone().add(new Vector3(-0.24, 0.21, 0)), quaternion: yaw(Math.PI / 2) }],
                  [0.75, { position: SADDLED, quaternion: yaw(Math.PI / 2) }],
                ], { on: [horse, 0] })();
              },
            );
          })))();
        yield* named('hands off, check the fit', function* () {
          yield* wear(horse, saddle, 0, { to: { position: SADDLED, quaternion: yaw(Math.PI / 2) } })();
          yield* reporting(report, HANDS, release(h, ['left', 'right']))();
          yield* withGaze(h, reported(report, 'gaze', () => saddle.current.position), function* () {
            yield* walkTo(h, { to: h.pose.position(0).clone().addScaledVector(forwardOf(h.gait.facing), -0.4), face: Math.PI / 2 })();
            yield* when(timePassed(0.65, 'seconds'));
          })();
        })();
        yield* named('untie the rail knot', reporting(report, ['leftHand'], function* () {
          yield* grab(h, { left: [rope, 'knot'] }, { face: 0, look: reported(report, 'gaze', KNOT) })();
          yield* withGaze(h, reported(report, 'gaze', KNOT), function* () {
            yield* carry(h, rope, [
              [0.65, { position: KNOT.clone().add(new Vector3(0.06, 0.08, -0.05)) }],
              [0.85, { position: KNOT.clone().add(new Vector3(-0.05, -0.1, -0.24)) }],
            ])();
          })();
        }))();
        yield* named('lead out through the gate', reporting(report, ['leftHand'], function* () {
          yield* parallel<Frame<World>>('all',
            walkTo(h, { to: new Vector3(0.2, 0, 20), speed: 0.75 }),
            hold(h, rope, { to: carried(h, 'left') }),
            function* () {
              yield* when((f: Frame<World>) => f.prev.position(0).clone().setY(0).distanceTo(gate) < 0.6);
              yield* withGaze(h, reported(report, 'gaze', () => horse.pose.position(HEAD).clone()), () => when(timePassed(1.1, 'seconds')))();
              lookedBack = true;
            },
          );
        }))();
      };
      return {
        world: createWorld(), report, bodies: [horse],
        done: () => horse.worn.has(saddle) && lookedBack && horse.pose.position(0).clone().sub(gate).dot(forwardOf(0)) > 0,
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
