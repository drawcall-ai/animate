import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { INDEX, Carrier, Item, aimAt, closeHand, createWorld, handTo, hold, idle, named, reachFor, watch, when,
  type DrivenRoot, type Frame, type Humanoid, type World } from '@drawcall/animate';
import { scalar } from '../keys';
import { forwardOf, leftOf, wrapAngle } from '../math';
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
// Tuned mouse turns (minimum jerk): a turn while walking, then a quick turn standing.
const TURNS = scalar([[0, 0], [24, 0], [28, 1.2], [29.5, 1.2], [30.7, -0.6]]);

/** Deterministic input, shared by headless runs and unattended playback. */
export function shooterTrack(t: number, input: Player['input']) {
  // Demo: walk forward, strafe left and right, back-pedal, ADS standing and walking, sprint,
  // walk while turning, stop and turn in place, ADS and fire.
  const between = (from: number, to: number) => t >= from && t < to;
  input.move.z = between(3, 6) || between(15.5, 17) || between(18, 28) ? 1 : between(10, 12) ? -1 : 0;
  input.move.x = between(6, 8) ? 1 : between(8, 10) ? -1 : 0;
  input.ads = between(13, 17) || t >= 32;
  input.sprint = between(18.5, 23.5);
  input.aimYaw = TURNS(t);
  input.aimPitch = 0;
  input.fire = between(14.5, 15.2) || between(34, 34.7);
  input.view = Math.floor(t / 7) % 2 ? 'first' : 'third';
}

/**
 * The player's root: always facing the look yaw (≤ 50 ms smoothing), moving as the keys ask
 * relative to it at the speed the keys allow, accelerating and braking at `ACCEL`.
 */
// Recalled game-feel norms (e.g. Unreal's Character Movement defaults, CS/COD movement): ~1.4 m/s
// walk, slower back and sideways, ~3.5 m/s sprint forward only, ADS slows; tuned 10 m/s² response.
const SPEED = { forward: 1.4, back: 1.1, side: 1.1, sprint: 3.5, ads: 0.65 };
const ACCEL = 10;
const FACING = 0.025;
export class Controller {
  readonly root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };

  step(input: Player['input'], dt: number) {
    const r = this.root;
    r.yaw += wrapAngle(input.aimYaw - r.yaw) * (1 - Math.exp(-dt / FACING));
    const { x, z } = input.move, length = Math.hypot(x, z);
    const sprinting = this.sprinting(input);
    const wanted = new Vector3();
    if (length > 0) {
      const speed = 1 / Math.hypot(x / length / SPEED.side, z / length / (z > 0 ? (sprinting ? SPEED.sprint : SPEED.forward) : SPEED.back));
      wanted.copy(forwardOf(input.aimYaw)).multiplyScalar(z).addScaledVector(leftOf(input.aimYaw), x).setLength(speed * (input.ads ? SPEED.ads : 1));
    }
    const change = wanted.sub(r.velocity);
    r.velocity.add(change.clampLength(0, ACCEL * dt));
    r.position.addScaledVector(r.velocity, dt);
  }

  start(at: Vector3, yaw: number) {
    this.root.position.copy(at).setY(0);
    this.root.yaw = yaw;
  }

  sprinting(input: Player['input']) { return input.sprint && !input.ads && input.move.z > 0; }
}

export function shooter(): Scenario {
  return {
    id: 'shooter', title: 'Full-body shooter',
    description: 'Click to play · WASD move (relative to where you look) · Shift sprint · right mouse ADS · mouse look · left click fire · V first/third person · Esc release mouse. The body always faces where you look; the legs step to keep up.',
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
      const controller = new Controller();
      const player: Player = {
        input: { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, fire: false, ads: false, sprint: false, view: 'third' },
        live: false,
        root: controller.root,
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
          if (!actor) throw new Error('the player drives its actor');
          // (the root starts where the body stands)
          if (now === 0) controller.start(actor.pose.position(0), actor.yaw);
          const dt = t - now;
          now = t;
          if (!player.live) shooterTrack(t, player.input);
          controller.step(player.input, dt);
          // Tuned 250 ms pose transitions, independent of camera/view.
          const approach = (value: number, target: number) => value + Math.max(-dt / 0.25, Math.min(dt / 0.25, target - value));
          ads = approach(ads, Number(player.input.ads));
          sprint = approach(sprint, player.input.ads ? 0 : Math.max(actor?.gait.run ?? 0, Number(controller.sprinting(player.input))));
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
            const at = new Vector3(-0.13 * (1 - blend) + 0.1 * run, -SIGHT.y - 0.14 * (1 - blend), 0.22 - 0.1 * run - 0.012 * recoil()).applyQuaternion(view);
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
              idle(h, { legs: { root: controller.root } }),
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
