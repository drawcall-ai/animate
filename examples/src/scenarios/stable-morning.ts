import { Box3, Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { forwardOf, Body, horse as horseSpecies, Item, Pose, place, facingAt, eyesOnBefore, grab, handTo, hold, horseLeadPoint, lookAt, named, onBone, release, watch, wear, when, walkTo, withGaze, yawOf, type Behaviour, type Frame, type Humanoid } from '@drawcall/animate';
import { idle, minimumJerk } from '@drawcall/animate/rig';
import { Rope } from '../stage/rope';
import { Report, reported, reporting } from '../report';
import type { Prop, Scenario } from '../scenario';
import { skeletonProps, line } from '../stage/props';

const HORSE_SKELETON = horseSpecies().skeleton;

const UP = new Vector3(0, 1, 0);
// Tuned: 3 cm below square standing, rather than an 8 cm crouch; contacts plan further reserve.
export const HORSE = new Vector3(-1.2, 1.37, 3);
// Tuned (from the old follower): the horse's catch-up walk, capped at its reference walk (m/s, m/s²).
const HORSE_PACE = { speed: 1.6, accel: 0.65 };
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
// A story budget, not the legs' timing: the story settles by ~24.6 s (measured); about 1.15× that natural time, the idle after
// `done` kept for the idle checks (tuned).
const DURATION = 28;
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
// second hand takes the slack on its own side, beside its hip: the near hand passes it across the
// front into it, 90 cm past the knot hand (more than the hands' span, so it hangs between
// them) — a handler never reaches across the body for it (m, and shares of its length). Tuned: how
// long it takes to come across (s).
export const LEAD_ROPE = 2.4;
const KNOT_AT = 1.2 / LEAD_ROPE;
const GATHER_AT = 2.1 / LEAD_ROPE;
const OFFER = 0.75;
// Tuned: where the left hand takes the slack, in front of its hip (the hips' frame, m).
const OFFERED = new Vector3(0.2, 0, 0.3);
const offeredAt = (h: Humanoid) => facingAt(h, 0, { position: OFFERED });
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
    id: 'stable-morning', title: 'Cold morning in the stable yard', skins: ['models/horse.glb'],
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
      let handler: Humanoid | null = null;
      let lookedBack = false;
      let leadStart: number | null = null;
      const pose = new Pose(HORSE_SKELETON);
      pose.setRoot(HORSE);
      // (it walks where its lead puts it, a rope's length behind the handler once led out; tied, it stands)
      const led = () => {
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
      };
      let startle: Vector3 | undefined;
      // (its glance before its legs and its lead: the base run by hand)
      const horse: Body = new Body(horseSpecies(), () => () => parallel<Frame>('all',
        lookAt(horse, () => handler!.pose.position(handler!.pose.skeleton.index('head'))),
        idle(horse, { attention: { tether: () => rope.supported ? { position: KNOT, length: 1.2 } : undefined, startle: () => startle } }),
        walkTo(horse, { to: () => led().position, velocity: () => led().velocity, speed: HORSE_PACE.speed, accel: HORSE_PACE.accel, until: () => false }),
      ), { pose, dev, idle: false });
      const halterAt = () => horse.pose.point(HEAD, HALTER, new Vector3());
      const lead = new Rope(halterAt(), KNOT.clone().lerp(halterAt(), -1 / KNOT_AT + 1), LEAD_ROPE);
      // (the left hand gathering the slack; the slack passed to it)
      let gathering = false, passed = false;

      const saddlePlace = onBone(horse, 0, { position: SADDLED, quaternion: yaw(-Math.PI / 2) });
      const gate = new Vector3(-0.2, 0, 8.2);
      const tasks = (h: Humanoid): Behaviour => function* () {
        yield* named('fetch the saddle', reporting(report, HANDS,
          grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }, {
            look: reported(report, 'gaze', () => saddle.current.position),
          })))();
        yield* named('carry and raise the saddle', reporting(report, HANDS,
          place(h, saddle, saddlePlace)))();
        yield* named('hands off, check the fit', function* () {
          yield* wear(horse, saddle, 0, { to: { position: SADDLED, quaternion: yaw(-Math.PI / 2) } })();
          startle = h.pose.position(0).clone();
          yield* release(h, ['left', 'right'])();
          let start: number | null = null;
          yield* parallel<Frame>('all',
            withGaze(h, reported(report, 'gaze', (f) => {
              start ??= f.time;
              const u = Math.min(1, (f.time - start) / INSPECT);
              return saddle.current.position.clone().add(new Vector3(0, 0.12 - 0.37 * u, 0.65 - 1.3 * u));
            }), () => when(timePassed(INSPECT, 'seconds'))),
            function* () {
              yield* when(timePassed(INSPECT / 2, 'seconds'));
              startle = h.pose.position(0).clone();
              yield* parallel<Frame>('race',
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
          const near = (f: Frame) => {
            const heading = yawOf(horse.pose.rotation(0));
            const halter = horseLeadPoint(horse.pose, new Vector3()), goal = comfortable(f);
            const aside = forwardOf(heading + Math.PI / 2);
            goal.position.addScaledVector(aside, 0.2 - goal.position.clone().sub(halter).dot(aside));
            return goal;
          };
          const slack = facingAt(h, 0, { position: SLACK_HAND });
          yield* parallel<Frame>('race',
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
              // (the near hand passes the slack into the left hand, waiting in front of its hip; the left hand closes on it)
              yield* parallel<Frame>('race', when(() => passed), handTo(h, 'left', offeredAt(h), { lead: false }));
              gathering = true;
              yield* grab(h, { left: [loose, 'end'] }, { walk: false, look: false })();
              yield* hold(h, loose, { to: slack })();
            },
            function* () {
              yield* walkTo(h, { to: new Vector3(HORSE.x + LEAD_ASIDE, 0, gate.z + HANDLER_AHEAD + GATE_CLEAR), face: 0, ...LEADING })();
              yield* named('halt beyond the gate', () => when(timePassed(1, 'seconds')))();
            },
            function* () {
              // Look back at the horse as they set off — over the near shoulder, the lead hand's side: turned the other way the
              // trunk would carry that hand off the halter — then attend to the short walk through the gate.
              yield* when(() => h.feet.some((foot) => foot.phase === 'swing'));
              yield* withGaze(h, reported(report, 'gaze', () => horse.pose.position(HEAD).clone()),
                () => when(timePassed(1.5, 'seconds')), { first: true })();
              lookedBack = true;
              yield* withGaze(h, reported(report, 'gaze', (f) => f.prev.position(0).clone().add(new Vector3(0, 0.5, 4))),
                () => when(() => false))();
            },
          );
        }))();
      };
      return {
        report, bodies: [horse],
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
            { ...line(horse.pose.position(NECK), poll, 0.1, 0x9b744c), bone: true },
            { ...line(poll, muzzle, 0.1, 0x9b744c), bone: true },
            { ...box(horse.pose.point(0, new Vector3(0, -0.13, -0.04), new Vector3()), 0.48, 0.48, BARREL_LENGTH, horse.pose.rotation(0).clone()), bone: true },
            box(saddle.current.position.clone(), SEAT.x, SEAT.y, SEAT.z, saddle.current.quaternion.clone()),
          ];
          for (const { bone, tip, radius } of APPENDAGES) {
            props.push({ ...line(horse.pose.position(bone), horse.pose.point(bone, tip, new Vector3()), radius, 0x9b744c), bone: true });
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
            let gatherAt = GATHER_AT;
            // (passed across into the left hand in front of its hip, from where it hung as they set off)
            let offered: { from: Vector3; time: number } | null = null;
            const slackAt = offeredAt(h);
            const swing = action<Frame>({
              update: (f) => {
                const hand = f.current.position(leftHand);
                if (h.holding.right?.item === rope && h.feet.some((foot) => foot.phase === 'swing')) offered ??= { from: lead.at(gatherAt).clone(), time: f.time };
                const share = offered ? minimumJerk((f.time - offered.time) / OFFER) : 0;
                passed = share >= 1;
                // (where the slack is: passed across, then in the gathering hand)
                const at = gathered() || passed ? hand : offered ? offered.from.clone().lerp(slackAt(f).position, share) : null;
                // The rope slides through the gathering hand as the hands part: it keeps more rope between them than their span.
                if (at) gatherAt = Math.min(1, Math.max(gatherAt, KNOT_AT + SLIDE * at.distanceTo(rope.current.position) / LEAD_ROPE));
                const pinned: [number, Vector3][] = [[0, halterAt()], [KNOT_AT, rope.current.position]];
                if (gathered()) pinned.push([gatherAt, loose.current.position]);
                else if (at) pinned.push([gatherAt, at.clone()]);
                lead.step(f.dt, pinned);
                // (passed, it is in the left hand, going with it till the hand closes on it)
                if (!gathered() && !loose.moved(f.time)) loose.move(f.time, passed ? hand : lead.at(gatherAt));
              },
            });
            yield* parallel<Frame>('all',
              eyesOnBefore(h, saddle, 0.4), eyesOnBefore(h, rope, 0.4),
              watch('gather the loose end', (f) => {
                // (once the left hand takes it: hanging free before, while the slack is passed to it, it swings as it will)
                if (!gathering || h.holding.right?.item !== rope || h.holding.left?.item === loose) return null;
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

function box(position: Vector3, x: number, y: number, z: number, quaternion?: Quaternion): Extract<Prop, { kind: 'box' }> {
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
