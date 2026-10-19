import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { INDEX, Carrier, Item, aimAt, closeHand, createWorld, handTo, hold, idle, named, reachFor, watch, when,
  type Frame, type Humanoid, type World } from '@drawcall/animate';
import { forwardOf, wrapAngle } from '../math';
import { Report, reporting } from '../report';
import type { Player, Prop, Scenario } from '../scenario';

const DEG = Math.PI / 180;
// Recalled: Epic Games, Unreal Engine “Skeletal Mesh Sockets”, “Aim Offset”, and “Two Bone IK”.
// One weapon owner (right wrist); the support hand follows its foregrip.
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
  input.move.z = (t >= 3 && t < 8) || (t >= 15 && t < 25) ? 1 : 0;
  // Tuned demo: hip walk, ADS bursts, straight sprint, stop and reacquire ADS.
  input.ads = (t >= 9 && t < 15) || t >= 27;
  input.sprint = t >= 16 && t < 24;
  input.aimYaw = 0;
  input.aimPitch = 0;
  input.fire = (t > 11 && t < 11.7) || (t > 29 && t < 29.7);
  input.view = Math.floor(t / 7) % 2 ? 'first' : 'third';
}

export function shooter(): Scenario {
  return {
    id: 'shooter', title: 'Full-body shooter',
    description: 'Click to play · WASD walk · Shift sprint · right mouse ADS · mouse look · left click fire · V first/third person · Esc release mouse. The body turns to walk in the movement direction.',
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
      let previousYaw = 0, previousPitch = 0, previousAds = false;
      let now = 0;
      let ads = 0, sprint = 0;
      let travel = 0;
      let destination: Vector3 | null = null;
      const player: Player = {
        input: { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, fire: false, ads: false, sprint: false, view: 'third' },
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
          const dt = t - now;
          now = t;
          if (!player.live) shooterTrack(t, player.input);
          // Tuned 250 ms pose transitions, independent of camera/view.
          const approach = (value: number, target: number) => value + Math.max(-dt / 0.25, Math.min(dt / 0.25, target - value));
          ads = approach(ads, Number(player.input.ads));
          sprint = approach(sprint, player.input.ads ? 0 : Math.max(actor?.gait.run ?? 0, Number(player.input.sprint && Math.hypot(player.input.move.x, player.input.move.z) > 0)));
          if (player.input.aimYaw !== previousYaw || player.input.aimPitch !== previousPitch || player.input.ads !== previousAds) steadySince = t;
          previousYaw = player.input.aimYaw;
          previousPitch = player.input.aimPitch;
          previousAds = player.input.ads;
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
          const eyes = new Carrier(new Vector3());
          const hand = (f: Frame<World>) => {
            const view = rotation();
            const blend = ads * ads * (3 - 2 * ads);
            const run = sprint * sprint * (3 - 2 * sprint);
            // Tuned carry offsets (m) and muzzle rotations (rad); +X is screen-left along +Z.
            // Hip muzzle converges inward; sprint lowers it diagonally across the chest.
            const q = view.clone().multiply(new Quaternion().setFromEuler(new Euler(0.18 * (1 - blend) + 0.22 * run, 0.12 * (1 - blend) + 0.2 * run, 0)));
            // Derived: sight height below the dominant eye, pistol grip ahead of the shoulder.
            const point = h.rig.points.rightEye;
            const eye = f.current.point(point.bone, point.at, new Vector3());
            eyes.move(f.time, eye);
            const at = new Vector3(-0.13 * (1 - blend) + 0.1 * run, -SIGHT.y - 0.18 * (1 - blend), 0.22 - 0.1 * run - 0.012 * recoil()).applyQuaternion(view);
            return { position: at, quaternion: q.multiply(HAND) };
          };
          return function* () {
            yield* parallel<Frame<World>>('all',
              watch('weapon pose', () => {
                if (!acquired || now - steadySince < 0.5 || now - lastShot < 0.5) return null;
                if (ads < 1) return null;
                const angle = new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(direction());
                if (angle > 2 * DEG) return { check: 'sight angle (rad)', value: angle, limit: 2 * DEG, where: 'rifle' };
                const sight = SIGHT.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(player.eyes());
                const value = sight.addScaledVector(direction(), -sight.dot(direction())).length();
                return value > 0.01 ? { check: 'sight line offset (m)', value, limit: 0.01, where: 'rifle' } : null;
              }),
              idle(h),
              aimAt(h, aim),
              reporting(report, ['leftHand', 'rightHand', 'gaze'], function* () {
                yield* parallel<Frame<World>>('all',
                  // Tuned responsiveness for the 250 ms carry/ADS transition (m/s², rad/s²).
                  handTo(h, 'right', hand, { on: eyes, lead: false, accel: 24, turnAccel: 120 }),
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
                    if (input.fire && sprint === 0 && now - lastShot >= 0.24) lastShot = now; // Tuned demo burst cadence.
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
                      // Tuned 3.4 m/s within the requested sprint range; inherited 0.9 m/s walk.
                      const speed = input.sprint && !input.ads ? 3.4 : 0.9;
                      const velocity = forwardOf(travel).multiplyScalar(speed);
                      destination ??= f.prev.com(new Vector3()).setY(0).addScaledVector(forwardOf(travel), 1);
                      destination.addScaledVector(velocity, f.dt);
                      h.asks.go = { to: destination, velocity, speed, accel: 1.2 };
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
