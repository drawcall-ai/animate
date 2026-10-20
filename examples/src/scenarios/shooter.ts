import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { INDEX, Carrier, Item, aimAt, closeHand, createWorld, handTo, hold, idle, named, onBone, onItem, reachFor, release, takeOff, watch, wear, when, withGaze,
  type DrivenRoot, type Placement, type Frame, type Humanoid, type World } from '@drawcall/animate';
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
// Tuned proxy magazine (m): a box below the receiver ahead of the pistol grip, held at its base.
const MAGAZINE = new Vector3(0.03, 0.15, 0.07);
const WELL = { position: new Vector3(0, -0.055, 0.09), quaternion: new Quaternion().setFromEuler(new Euler(-0.15, 0, 0)) };
// (drawn out of the well, below it)
const OUT = { position: new Vector3(0, -0.2, 0.08), quaternion: WELL.quaternion };
// Tuned support-hand reach for a reload: its least time (s), the rifle as long done turning (s; its wrist catching up), closing within `near` (m) of the grip moving with it to `speed` (m/s) —
// the grips are on worn items, whose hold is checked to 1 cm from the first sub-step — its pace (m/s², m/s, rad/s², rad/s).
const TAKE = { seconds: 0.15, still: 0.15, steady: 3, near: 0.006, speed: 0.2, bring: 0.3, motion: { accel: 80, speed: 5, turnAccel: 300, turnSpeed: 25 }, seat: { accel: 20, speed: 1, turnAccel: 100, turnSpeed: 10 } };
// Tuned pouches on the left hip, in the hips' frame (+x left, +z ahead): beside the trunk, clear of it.
const POUCHES = [new Vector3(0.17, -0.04, 0.05), new Vector3(0.17, -0.04, -0.03)];
export const SHOOTER_DURATION = 53;
// Tuned mouse turns (minimum jerk): a turn while walking, then a quick turn standing.
const TURNS = scalar([[0, 0], [24, 0], [28, 1.2], [29.5, 1.2], [30.7, -0.6]]);

/** Deterministic input, shared by headless runs and unattended playback. */
export function shooterTrack(t: number, input: Player['input']) {
  // Demo: walk forward, strafe left and right, back-pedal, ADS standing and walking, sprint,
  // walk while turning, stop and turn in place, ADS and fire; crouch-walk; jump from a walk and
  // from a sprint; reload while walking.
  const between = (from: number, to: number) => t >= from && t < to;
  input.move.z = between(3, 6) || between(15.5, 17) || between(18, 28) || between(36.5, 39.5) || between(41, 47.5) || between(48.5, 51.8) ? 1 : between(10, 12) ? -1 : 0;
  input.move.x = between(6, 8) ? 1 : between(8, 10) ? -1 : 0;
  input.ads = between(13, 17) || between(32, 35);
  input.sprint = between(18.5, 23.5) || between(44, 47);
  input.crouch = between(35.5, 40.3);
  input.jump = between(42.5, 42.6) || between(45.7, 45.8);
  input.reload = between(49, 49.1);
  input.aimYaw = TURNS(t);
  input.aimPitch = 0;
  input.fire = between(14.5, 15.2) || between(33.5, 34.2);
  input.view = Math.floor(t / 7) % 2 ? 'first' : 'third';
}

/**
 * The player's root: always facing the look yaw (≤ 50 ms smoothing), moving as the keys ask
 * relative to it at the speed the keys allow, accelerating and braking at `ACCEL` (in the air:
 * keeping its momentum, steered a little). Crouching eases in over `CROUCHING` s; a jump is the
 * legs' to make (`DrivenRoot.jump`).
 */
// Recalled game-feel norms (e.g. Unreal's Character Movement defaults, CS/COD movement): ~1.4 m/s
// walk, slower back and sideways, ~3.5 m/s sprint forward only, ADS slows, a crouch-walk ~0.8 m/s;
// tuned 10 m/s² response, 2 m/s² in the air.
const SPEED = { forward: 1.4, back: 1.1, side: 1.1, sprint: 3.5, ads: 0.65, crouch: 0.8 / 1.4 };
const ACCEL = 10;
const AIR = 2;
const FACING = 0.025;
const CROUCHING = 0.25;
/** Recalled: a standing vertical jump's take-off speed, ~2.5 m/s, raises the body ~0.32 m for ~0.5 s in the air. */
const LEAP = 2.5;
export class Controller {
  readonly root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0, crouch: 0 };
  private jumped = false;
  /** sprinting is held off (a reload under way) */
  hold = false;

  step(input: Player['input'], dt: number) {
    const r = this.root;
    r.yaw += wrapAngle(input.aimYaw - r.yaw) * (1 - Math.exp(-dt / FACING));
    const { x, z } = input.move, length = Math.hypot(x, z);
    const sprinting = this.sprinting(input);
    // (sprinting stands up)
    r.crouch = (r.crouch ?? 0) + Math.max(-dt / CROUCHING, Math.min(dt / CROUCHING, Number(input.crouch && !sprinting) - (r.crouch ?? 0)));
    const wanted = new Vector3();
    if (length > 0) {
      const speed = 1 / Math.hypot(x / length / SPEED.side, z / length / (z > 0 ? (sprinting ? SPEED.sprint : SPEED.forward) : SPEED.back));
      wanted.copy(forwardOf(input.aimYaw)).multiplyScalar(z).addScaledVector(leftOf(input.aimYaw), x)
        .setLength(speed * (input.ads ? SPEED.ads : 1) * (1 + (SPEED.crouch - 1) * r.crouch));
    }
    const change = wanted.sub(r.velocity);
    r.velocity.add(change.clampLength(0, (r.airborne ? AIR : ACCEL) * dt));
    r.position.addScaledVector(r.velocity, dt);
    // (a press, not a held key, asks for a jump)
    if (input.jump && !this.jumped && !r.airborne) r.jump = LEAP;
    this.jumped = input.jump;
  }

  start(at: Vector3, yaw: number) {
    this.root.position.copy(at).setY(0);
    this.root.yaw = yaw;
  }

  sprinting(input: Player['input']) { return input.sprint && !input.ads && input.move.z > 0 && !this.hold; }
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
      // two magazines: one in the rifle, one in a pouch; a reload swaps them, the spent one into the free pouch
      const magazine = (name: string) => new Item(new Vector3(), new Quaternion(), { grip: { position: new Vector3(0, -0.065, 0) } },
        { name, mass: 0.5, bounds: new Box3(MAGAZINE.clone().multiplyScalar(-0.5), MAGAZINE.clone().multiplyScalar(0.5)) });
      const magazines = [magazine('magazine 1'), magazine('magazine 2')];
      let loaded = magazines[0], spare = magazines[1], stowed = 0, free = 1;
      let reloading = false, pulled = false, wanted = false, reload = 0, canted = false, turned = 0;
      const steps: string[] = [];
      let actor: Humanoid<World> | null = null;
      let acquired = false;
      let lastShot = -Infinity;
      let steadySince = 0;
      let previousYaw = 0, previousPitch = 0, previousAds = false;
      let now = 0;
      let ads = 0, sprint = 0;
      const controller = new Controller();
      const player: Player = {
        input: { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, fire: false, ads: false, sprint: false, crouch: false, jump: false, reload: false, view: 'third' },
        live: false,
        root: controller.root,
        status: () => ({ reloading, steps, magazines }),
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
        wearing: () => [{ item: rifle, on: INDEX.rightHand, at: { position: new Vector3(), quaternion: HAND.clone().invert() } },
          { item: spare, on: INDEX.hips, at: { position: POUCHES[0].clone() } }],
        move: (t) => {
          if (!actor) throw new Error('the player drives its actor');
          // (the root starts where the body stands)
          if (now === 0) controller.start(actor.pose.position(0), actor.yaw);
          const dt = t - now;
          now = t;
          if (!player.live) shooterTrack(t, player.input);
          // (aiming waits for a reload; sprinting cancels one before the magazine is out, then waits)
          const input = { ...player.input, ads: player.input.ads && !reloading };
          controller.hold = reloading && pulled;
          if (player.input.reload && acquired && !reloading && !controller.sprinting(input)) wanted = true;
          controller.step(input, dt);
          // Tuned 250 ms pose transitions, independent of camera/view.
          const approach = (value: number, target: number) => value + Math.max(-dt / 0.25, Math.min(dt / 0.25, target - value));
          ads = approach(ads, Number(input.ads));
          reload = approach(reload, Number(canted));
          if (reload !== Number(canted)) turned = t;
          sprint = approach(sprint, input.ads ? 0 : Math.max(actor?.gait.run ?? 0, Number(controller.sprinting(input))));
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
          ...magazines.map((m): Prop => ({ kind: 'box', position: m.current.position.clone(), size: MAGAZINE.clone(), quaternion: m.current.quaternion.clone() })),
          ...(now - lastShot < 0.06 ? [{ kind: 'ball' as const, position: new Vector3(0, 0.06, 0.68).applyQuaternion(rifle.current.quaternion).add(rifle.current.position), radius: 0.045 }] : []),
          ...[-3, 3].map((x): Prop => ({ kind: 'box', position: new Vector3(x, 0.4, 4), size: new Vector3(1.4, 0.8, 1) })),
          ...[-4, 0, 4].map((x): Prop => ({ kind: 'box', position: new Vector3(x, 1.3, 13), size: new Vector3(0.6, 1, 0.1) })),
        ],
        script: (h) => {
          actor = h;
          // (the loaded magazine starts in the well, worn on the rifle from the first sub-step)
          loaded.move(0, WELL.position.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position), rifle.current.quaternion.clone().multiply(WELL.quaternion));
          const eyes = new Carrier(new Vector3());
          const hand = (f: Frame<World>) => {
            const view = rotation();
            const blend = ads * ads * (3 - 2 * ads);
            const run = sprint * sprint * (3 - 2 * sprint);
            // Tuned carry offsets (m) and muzzle rotations (rad); +X is screen-left along +Z.
            // Hip muzzle converges inward; sprint lowers it diagonally across the chest.
            const turn = reload * reload * (3 - 2 * reload);
            // Tuned reload cant: the muzzle up a little, the rifle raised and drawn in toward the body and the left hand —
            // the well within the eyes' downward reach, not bowing the trunk to see it (rolling it too swung the
            // foregrip out of the support hand's reach as the cant came off).
            const q = view.clone().multiply(new Quaternion().setFromEuler(new Euler(0.18 * (1 - blend) + 0.22 * run - 0.3 * turn, 0.12 * (1 - blend) + 0.2 * run, 0)));
            // Derived: sight height below the dominant eye, pistol grip ahead of the shoulder.
            const point = h.rig.points.rightEye;
            const eye = f.current.point(point.bone, point.at, new Vector3());
            eyes.move(f.time, eye);
            const at = new Vector3(-0.13 * (1 - blend) + 0.1 * run + 0.05 * turn, -SIGHT.y - 0.14 * (1 - blend) + 0.06 * turn, 0.22 - 0.1 * run - 0.012 * recoil() - 0.04 * turn).applyQuaternion(view);
            return { position: at, quaternion: q.multiply(HAND) };
          };
          const well = (f: Frame<World>) => onItem<World>(rifle, WELL)(f).position;
          // The support hand off what it holds and onto `grip` of `item` in a quick reach, closing on it there: its
          // pace keeps up with a walking body (the library reach's calm hand pace is the world's, a walk's own).
          // A held magazine brought to `to` (world, moving), at the support hand's pace, till it is there or `TAKE.bring` s
          // are up (kept clear of the trunk, it may stop short: the pouch or the well then seats it).
          const bring = (item: Item, to: (f: Frame<World>) => Placement) => function* () {
            const began = now;
            yield* hold(h, item, { to, motion: TAKE.motion, until: (f) => item.current.position.distanceTo(to(f).position) < TAKE.near || now - began > TAKE.bring })();
          };
          const take = (item: Item, grip: string) => function* () {
            yield* release(h, ['left'], { away: null })();
            const began = now;
            let steady = 0;
            // (the grip where it will be once the body has moved what it wears this sub-step: moving on as it moved, its
            // speed changing as it did — a walking body's arms carry what they wear with ~30 m/s² swings)
            const at = (f: Frame<World>) => {
              const [now, was, before] = [item.current, item.prev, item.prev2].map((placed) => item.grips[grip].position.clone().applyQuaternion(placed.quaternion).add(placed.position));
              const change = now.clone().sub(was).multiplyScalar(2).sub(was).add(before);
              return { position: now.clone().add(change), velocity: change.divideScalar(f.dt) };
            };
            // (there once the wrist is on the grip, moving with it, and the rifle no longer turning)
            const there = (f: Frame<World>) => {
              const goal = onItem<World>(item, item.grips[grip])(f), hand = f.prev.position(INDEX.leftHand);
              const moving = hand.clone().sub(f.prev2.position(INDEX.leftHand)).divideScalar(f.dt).sub(goal.velocity ?? new Vector3());
              steady = hand.distanceTo(goal.position) < TAKE.near && moving.length() < TAKE.speed ? steady + 1 : 0;
              return now - began >= TAKE.seconds && now - turned >= TAKE.still && steady >= TAKE.steady;
            };
            // (the hand kept on it through the sub-step it closes — the free arm's swing, which runs first, let it go
            // only after — and held there the next, before it moves on with what it took)
            yield* parallel<Frame<World>>('race', handTo(h, 'left', at, { lead: false, ...TAKE.motion }), function* () {
              yield* when<World>(there);
              yield* closeHand(h, 'left', item, grip)();
            });
            const closed = now;
            yield* when<World>(() => now > closed);
          };
          // Recalled reload staging (e.g. common FPS reloads, ~2–2.5 s): the support hand off the
          // handguard to the magazine, drawn out and stowed in the free pouch, the full one taken
          // from its pouch, into the well (the eyes on it first), back to the handguard.
          const reloading_ = function* () {
            const [spent, full, slot, emptied] = [loaded, spare, free, stowed];
            let cancelled = false;
            steps.push('to magazine');
            yield* parallel<Frame<World>>('race', take(spent, 'grip'),
              when<World>(() => (cancelled = controller.sprinting(player.input))));
            if (cancelled) {
              steps.push('cancelled');
              canted = false;
              yield* take(rifle, 'foregrip')();
              return;
            }
            pulled = true;
            steps.push('out');
            yield* takeOff(h, spent)();
            yield* bring(spent, onItem(rifle, OUT))();
            steps.push('stow');
            const pouch = { position: POUCHES[slot] };
            yield* bring(spent, onBone(h, INDEX.hips, pouch))();
            yield* wear(h, spent, INDEX.hips, { to: pouch, motion: TAKE.seat })();
            yield* withGaze(h, well, function* () {
              steps.push('to pouch');
              yield* take(full, 'grip')();
              yield* takeOff(h, full)();
              steps.push('insert');
              yield* bring(full, onItem(rifle, OUT))();
              yield* bring(full, onItem(rifle, WELL))();
              yield* wear(h, full, rifle, { to: WELL, motion: TAKE.seat })();
            })();
            // (the rifle turned back as the hand returns: still again by the time it closes on the handguard)
            steps.push('handguard');
            canted = false;
            yield* take(rifle, 'foregrip')();
            [loaded, spare, stowed, free] = [full, spent, slot, emptied];
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
                    yield* wear(h, loaded, rifle)();
                    yield* closeHand(h, 'right', rifle, 'pistol')();
                    yield* when<World>((f) => f.time >= 0.9);
                    yield* named('take foregrip', reachFor(h, { left: [rifle, 'foregrip'] }))();
                    acquired = true;
                    for (;;) {
                      yield* hold(h, rifle, { until: () => wanted })();
                      [wanted, reloading, pulled, canted] = [false, true, false, true];
                      yield* named('reload', reloading_)();
                      reloading = false;
                    }
                  },
                  () => action<Frame<World>>({ update: (f) => {
                    if (!acquired) return;
                    const input = player.input;
                    report.asked.set('torsoYaw', { time: f.time, value: h.asks.twist });
                    if (input.fire && sprint === 0 && !reloading && now - lastShot >= 0.24) lastShot = now; // Tuned demo burst cadence.
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
