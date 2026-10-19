import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { INDEX, Item, aimAt, closeHand, createWorld, handTo, hold, idle, named, reachFor, watch, when,
  type Frame, type Humanoid, type World } from '@drawcall/animate';
import { forwardOf, wrapAngle } from '../math';
import { Report, reporting } from '../report';
import type { Player, Prop, Scenario } from '../scenario';

const DEG = Math.PI / 180;
// Recalled: Epic Games, Unreal Engine “Skeletal Mesh Sockets”, “Aim Offset”, and “Two Bone IK”.
// One weapon owner (right wrist); the support hand follows its foregrip, never a two-grip carry.
// Derived rig frame: this wrist’s palm points inward at the pistol grip, fingers curling around it.
const HAND = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0));
// Tuned proxy rifle dimensions (m), measured from its pistol-grip wrist origin.
const FOREGRIP = new Vector3(0, 0.035, 0.20);
const SIGHT = new Vector3(0, 0.12, 0);
// Tuned dropped/offset butt pad reaches the shoulder pocket below the eye-line; a proxy, not a measured firearm.
const STOCK = new Vector3(-0.07, -0.075, -0.24);
export const SHOOTER_DURATION = 38;

/** Deterministic input, shared by headless runs and unattended playback. */
export function shooterTrack(t: number, input: Player['input']) {
  input.move.x = 0;
  input.move.z = t >= 16 && t < 28 ? 1 : 0;
  // Tuned demonstration timings: acquisition, ±120° stationary sweep, curved walk, ±60° aim,
  // vertical aim, and bursts. Smooth endpoints keep requested angular accelerations finite.
  const sweep = (a: number, b: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, (t - a) / (b - a))))) / 2;
  input.aimYaw = t < 16 ? 120 * DEG * (sweep(5, 8) - 2 * sweep(9, 13) + sweep(14, 16))
    : 60 * DEG * (sweep(18, 21) - 2 * sweep(23, 26) + sweep(28, 31));
  if (t >= 16 && t < 28) {
    const travel = 20 * DEG * sweep(19, 24);
    input.move.x = Math.sin(travel - input.aimYaw);
    input.move.z = Math.cos(travel - input.aimYaw);
  }
  input.aimPitch = 20 * DEG * sweep(31, 33) - 90 * DEG * sweep(33, 35) + 70 * DEG * sweep(35, 37);
  input.fire = (t > 4 && t < 4.7) || (t > 17 && t < 17.7) || (t > 30 && t < 30.7);
  input.view = Math.floor(t / 7) % 2 ? 'first' : 'third';
}

export function shooter(): Scenario {
  return {
    id: 'shooter', title: 'Full-body shooter',
    description: 'Click to play · WASD walk · mouse aim · left click fire · V first/third person · Esc release mouse. The body turns to walk in the movement direction.',
    duration: SHOOTER_DURATION, actors: [{}], cameraDistance: 4,
    stage: () => {
      const report = new Report();
      const rifle = new Item(new Vector3(), new Quaternion(), {
        pistol: { position: new Vector3() }, foregrip: { position: FOREGRIP },
      }, { name: 'rifle', mass: 3, bounds: new Box3(new Vector3(-0.1075, -0.155, -0.29), new Vector3(0.035, 0.1325, 0.64)) });
      let actor: Humanoid<World> | null = null;
      let acquired = false;
      let lastShot = -Infinity;
      let steadySince = 0;
      let previousYaw = 0, previousPitch = 0;
      let now = 0;
      let travel = 0;
      let destination: Vector3 | null = null;
      const player: Player = {
        input: { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, fire: false, view: 'third' },
        live: false,
        eyes: () => {
          if (!actor) throw new Error('player camera needs its actor');
          const eye = actor.rig.points.rightEye;
          return actor.pose.point(eye.bone, eye.at, new Vector3());
        },
      };
      const direction = () => new Vector3(0, 0, 1).applyQuaternion(rotation());
      const rotation = () => new Quaternion().setFromEuler(new Euler(-player.input.aimPitch - 0.012 * recoil(), player.input.aimYaw, 0, 'YXZ'));
      const aim = () => player.eyes().addScaledVector(direction(), 20);
      const recoil = () => {
        const u = (now - lastShot) / 0.2; // Tuned: requested 200 ms recovery, zero velocity at each end.
        return u >= 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 : 0;
      };
      const part = (at: Vector3, size: Vector3): Prop => ({ kind: 'box',
        position: at.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position),
        size, quaternion: rifle.current.quaternion.clone() });
      return {
        world: createWorld(), report, player,
        wearing: () => [{ item: rifle, on: INDEX.rightHand, at: { position: new Vector3(), quaternion: HAND.clone().invert() } }],
        move: (t) => {
          now = t;
          if (!player.live) shooterTrack(t, player.input);
          if (player.input.aimYaw !== previousYaw || player.input.aimPitch !== previousPitch) steadySince = t;
          previousYaw = player.input.aimYaw;
          previousPitch = player.input.aimPitch;
        },
        done: () => acquired && now >= SHOOTER_DURATION - 1 / 60,
        props: () => [
          part(new Vector3(0, 0.06, 0.12), new Vector3(0.065, 0.09, 0.42)),
          part(STOCK, new Vector3(0.075, 0.16, 0.10)),
          part(new Vector3(-0.035, -0.005, -0.15), new Vector3(0.12, 0.07, 0.20)),
          part(new Vector3(0, 0.06, 0.48), new Vector3(0.025, 0.025, 0.32)),
          part(new Vector3(0, -0.055, 0), new Vector3(0.055, 0.14, 0.06)),
          part(SIGHT, new Vector3(0.02, 0.025, 0.12)),
          ...(now - lastShot < 0.06 ? [{ kind: 'ball' as const, position: new Vector3(0, 0.06, 0.68).applyQuaternion(rifle.current.quaternion).add(rifle.current.position), radius: 0.045 }] : []),
          ...[-3, 3].map((x): Prop => ({ kind: 'box', position: new Vector3(x, 0.4, 4), size: new Vector3(1.4, 0.8, 1) })),
          ...[-4, 0, 4].map((x): Prop => ({ kind: 'box', position: new Vector3(x, 1.3, 13), size: new Vector3(0.6, 1, 0.1) })),
        ],
        script: (h) => {
          actor = h;
          const hand = (f: Frame<World>) => {
            const q = rotation();
            // Derived: sight height below the dominant eye, pistol grip ahead of the shoulder.
            // Tuned ready drop while walking; weapon still follows aim, with no clearance push.
            const point = h.rig.points.rightEye;
            const eye = f.current.point(point.bone, point.at, new Vector3());
            const at = new Vector3(0, -SIGHT.y - 0.07 * h.gait.walk, 0.22 - 0.012 * recoil()).applyQuaternion(q).add(eye);
            return { position: at, quaternion: q.multiply(HAND) };
          };
          return function* () {
            yield* parallel<Frame<World>>('all',
              watch('steady sights', () => {
                if (!acquired || now - steadySince < 0.5 || now - lastShot < 0.5) return null;
                const value = new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(direction());
                return value > 2 * DEG ? { check: 'sight angle (rad)', value, limit: 2 * DEG, where: 'rifle' } : null;
              }),
              idle(h),
              aimAt(h, aim),
              reporting(report, ['leftHand', 'rightHand', 'gaze'], function* () {
                yield* parallel<Frame<World>>('all',
                  handTo(h, 'right', hand, { lead: false }),
                  function* () {
                    yield* closeHand(h, 'right', rifle, 'pistol')();
                    yield* when<World>((f) => f.time >= 0.9);
                    yield* named('take foregrip', reachFor(h, { left: [rifle, 'foregrip'] }))();
                    acquired = true;
                    yield* hold(h, rifle)();
                  },
                  () => action<Frame<World>>({ update: (f) => {
                    if (!acquired) return;
                    const input = player.input;
                    report.asked.set('torsoYaw', { time: f.time, value: h.asks.twist });
                    if (input.fire && now - lastShot >= 0.24) lastShot = now; // Tuned demo burst cadence.
                    const moving = Math.hypot(input.move.x, input.move.z) > 0;
                    const offset = wrapAngle(input.aimYaw - h.gait.facing);
                    if (moving) {
                      // Recalled: camera-relative input; forward locomotion turns toward travel.
                      let wanted = input.aimYaw + Math.atan2(input.move.x, input.move.z);
                      const relative = wrapAngle(input.aimYaw - wanted);
                      wanted += relative - Math.max(-Math.PI / 3, Math.min(Math.PI / 3, relative));
                      // Tuned walking turn rate: radius >= 3 m at 0.9 m/s; avoids tight curved steps.
                      travel += Math.max(-0.3 * f.dt, Math.min(0.3 * f.dt, wrapAngle(wanted - travel)));
                      // Scene-level adapter: a world-space moving goal avoids feeding pelvic sway back into travel.
                      const velocity = forwardOf(travel).multiplyScalar(0.9);
                      destination ??= f.prev.com(new Vector3()).setY(0).addScaledVector(forwardOf(travel), 1);
                      destination.addScaledVector(velocity, f.dt);
                      h.asks.go = { to: destination, velocity, speed: 0.9, accel: 1.2 };
                      h.asks.face = { yaw: travel };
                    } else {
                      destination = null;
                      travel = h.gait.facing;
                      if (Math.abs(offset) > 65 * DEG) h.asks.face = { yaw: input.aimYaw - Math.sign(offset) * 40 * DEG };
                    }
                  } }),
                );
              }),
            );
          };
        },
      };
    },
  };
}
