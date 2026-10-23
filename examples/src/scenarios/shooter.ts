import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { INDEX, Item, aimAt, swing, grab, handTo, hold, named, onBone, onItem, release, takeOff, watch, wear, when, withGaze, type DrivenRoot, type Placement, type Frame, type Humanoid, type Jumper, type Rhythm } from '@drawcall/animate';
import { Life, ask, follow, followRotation, idle } from '@drawcall/animate/rig';
import { reached } from '../../../packages/animate/src/core/tip';
import { spinOf } from '../../../packages/animate/src/core/rotation';
import { irregular } from '../../../packages/animate/src/core/random';
import { scalar } from '../keys';
import { forwardOf, leftOf, wrapAngle } from '../math';
import { Report, reporting } from '../report';
import type { Look, Player, Prop, Scenario } from '../scenario';

const DEG = Math.PI / 180;
// Recalled: Epic Games, Unreal Engine “Skeletal Mesh Sockets”, “Aim Offset”, and “Two Bone IK”.
// One weapon owner (right wrist); the support hand follows its foregrip.
// Derived rig frame: this wrist’s palm points inward at the pistol grip, fingers curling around it.
const HAND = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0));
// Tuned proxy rifle dimensions (m), measured from its pistol-grip wrist origin; the foregrip and the stock's length of pull for the
// default body's arms.
const FOREGRIP = new Vector3(0, 0.035, 0.20);
const SIGHT = new Vector3(0, 0.12, 0);
// Tuned dropped/offset butt pad reaches the shoulder pocket below the eye-line; a proxy, not a measured firearm.
const STOCK = new Vector3(-0.07, -0.075, -0.24);
// Tuned proxy magazine (m): a box below the receiver ahead of the pistol grip, held at its base.
const MAGAZINE = new Vector3(0.03, 0.15, 0.07);
const WELL = { position: new Vector3(0, -0.055, 0.09), quaternion: new Quaternion().setFromEuler(new Euler(-0.15, 0, 0)) };
// (drawn out of the well, below it)
const OUT = { position: new Vector3(0, -0.2, 0.08), quaternion: WELL.quaternion };
// Tuned support-hand reach for a reload: its least time (s), a magazine brought within `near` (m) or for at most `bring` (s), its pace
// and a magazine's seating (m/s², m/s, rad/s², rad/s).
const TAKE = { seconds: 0.15, near: 0.006, bring: 0.3, motion: { accel: 80, speed: 5, turnAccel: 300, turnSpeed: 25 }, seat: { accel: 20, speed: 1, turnAccel: 100, turnSpeed: 10 } };
// Tuned: how fast the rifle's place in the aim frame changes, carry to aim and back in ~250 ms (m/s², rad/s²).
const SWAY = { accel: 24, turnAccel: 120 };
// Tuned: the most the rifle's turn speeds up or slows (rad/s²): a 6 rad/s mouse sweep reversed within 0.1 s (~230 rad/s² at most)
// is followed exactly; the hands turning with it stay within the development check's 100,000°/s² for a joint.
const FLICK = 600;
// Tuned: how far the rifle rolls for a reload (rad, + toward the left hand), its well turned to the hand bringing the magazine
const RELOAD_CANT = 0.4;
// Tuned magazine pouches on the front of the vest, left of the middle, in the chest's frame (+x left, +z ahead; m, the default body's):
// below the chest, clear of the trunk — where a plate carrier's are, within any arms' easy reach, so the support hand takes and stows a
// magazine without the body bowing to it.
const POUCHES = [new Vector3(0.06, -0.17, 0.16), new Vector3(0.13, -0.17, 0.14)];
/**
 * Standing at ease — not aiming, moving or turning — the rifle and the eyes keep a little life, gone as the sights come up (the body's own breathing and sway fade
 * by `steady`, the rifle held still in the aim). Recalled (game convention: first-person weapon idle sway, e.g. Call of Duty, Battlefield,
 * Unreal's Lyra — a slow Lissajous of a few mm and a fraction of a degree, near none aiming down sights; Winter 1995: quiet stance sways
 * below 0.5 Hz): tuned, the rifle drifts `drift` (m) and `turn` (rad), breathing at 0.25 Hz (12–20 breaths/min); every 6–12 s standing
 * at ease it is shouldered anew — lifted `lift` (m) and rolled `roll` (rad) for 0.6–1.2 s, eased at 4/s (recalled: idle fidgets of game
 * animation sets); the eyes wander `wander` (rad) about the aim and every 4–9 s glance up to `glance` (rad) aside for 0.8–1.6 s (recalled,
 * Land & Tatler 2009: the gaze rests on a point a fraction of a second to seconds, the head joining the larger shifts; tuned intervals).
 */
const EASE = { drift: 0.004, turn: 0.012, lift: 0.025, roll: 0.12, wander: 0.025, glance: 0.15 };
const SHOULDER: Rhythm = { first: [4, 8], every: [6, 12], hold: [0.6, 1.2], rate: 4, quiet: 2, pick: swing };
const GLANCE: Rhythm = { first: [3, 6], every: [4, 9], hold: [0.8, 1.6], rate: 5, quiet: 1.5, pick: swing };
export const SHOOTER_DURATION = 62;
// Tuned mouse turns (minimum jerk): a turn while walking, then a quick turn standing, then quick turns aiming.
const TURNS = scalar([[0, 0], [24, 0], [28, 1.2], [29.5, 1.2], [30.7, -0.6], [56.8, -0.6], [57.4, 0.4], [58.2, 0.4], [58.8, -0.6]]);

/** Deterministic input, shared by headless runs and unattended playback. */
export function shooterTrack(t: number, input: Player['input']) {
  // Demo: walk forward, strafe left and right, back-pedal, ADS standing and walking, sprint,
  // walk while turning, stop and turn in place, ADS and fire; crouch-walk; jump from a walk and
  // from a sprint; reload while walking; stand at ease; quick turns aiming.
  const between = (from: number, to: number) => t >= from && t < to;
  input.move.z = between(3, 6) || between(15.5, 17) || between(18, 28) || between(36.5, 39.5) || between(41, 47.5) || between(48.5, 51.8) ? 1 : between(10, 12) ? -1 : 0;
  input.move.x = between(6, 8) ? 1 : between(8, 10) ? -1 : 0;
  input.ads = between(13, 17) || between(32, 35) || between(56, 60);
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
 * legs' to make (`body.stepper.jump`).
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

  step(input: Player['input'], dt: number, legs: Jumper | null) {
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
    r.velocity.add(change.clampLength(0, (legs?.airborne ? AIR : ACCEL) * dt));
    r.position.addScaledVector(r.velocity, dt);
    // (a press, not a held key, asks for a jump)
    if (input.jump && !this.jumped && !legs?.airborne) legs?.jump(LEAP);
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
    description: 'Click to play · mouse look · WASD move (relative to where you look) · Shift sprint · right mouse aim down sights · left click fire · Space jump · C or Ctrl crouch · R reload · V first/third person · Esc release mouse. The body always faces where you look; the legs step to keep up.',
    duration: SHOOTER_DURATION, actors: [{}], cameraDistance: 4,
    stage: () => {
      const report = new Report();
      const rifle = new Item(new Vector3(), new Quaternion(), {
        pistol: { position: new Vector3(), quaternion: HAND }, foregrip: { position: FOREGRIP.clone() },
      }, { name: 'rifle', mass: 3, bounds: new Box3(new Vector3(-0.1075, -0.155, -0.29), new Vector3(0.035, 0.1325, 0.64)) });
      // two magazines: one in the rifle, one in a pouch; a reload swaps them, the spent one into the free pouch
      const magazine = (name: string) => new Item(new Vector3(), new Quaternion(), { grip: { position: new Vector3(0, -0.065, 0) } },
        { name, mass: 0.5, bounds: new Box3(MAGAZINE.clone().multiplyScalar(-0.5), MAGAZINE.clone().multiplyScalar(0.5)) });
      const magazines = [magazine('magazine 1'), magazine('magazine 2')];
      let loaded = magazines[0], spare = magazines[1], stowed = 0, free = 1;
      let reloading = false, pulled = false, wanted = false, reload = 0, canted = false;
      const steps: string[] = [];
      let actor: Humanoid | null = null;
      let acquired = false;
      let lastShot = -Infinity;
      let steadySince = 0;
      let previousYaw = 0, previousPitch = 0, previousAds = false;
      let now = 0;
      let ads = 0, sprint = 0;
      // (the body's arms over the default's: `Proportions.arms`, known once it is dressed)
      let arms = 1;
      const controller = new Controller();
      const player: Player = {
        input: { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, fire: false, ads: false, sprint: false, crouch: false, jump: false, reload: false, view: 'third' },
        live: false,
        root: controller.root,
        status: () => ({ reloading, steps, magazines }),
        // (the aim's frame, taken once a step as it sets out: the eye as the body stood then — a sub-step behind the body, as a
        // game's camera — and the look the input had then; the rifle is placed in it and the camera shows it, so the two never part)
        look: () => {
          if (!actor) throw new Error('player camera needs its actor');
          const eye = actor.rig.points.rightEye;
          if (now === 0) return { eye: actor.pose.point(eye.bone, eye.at, new Vector3()), yaw: player.input.aimYaw, pitch: player.input.aimPitch };
          return { ...look, eye: look.eye.clone() };
        },
      };
      const look: Look = { eye: new Vector3(), yaw: 0, pitch: 0 };
      const direction = () => new Vector3(0, 0, 1).applyQuaternion(rotation());
      const rotation = () => new Quaternion().setFromEuler(new Euler(-look.pitch - 0.012 * recoil(), look.yaw, 0, 'YXZ'));
      // (at ease: how far from aiming, eased; how calm — standing at ease, eased in and out over ~0.3 s; its shouldering and glances, seeded)
      const atEase = () => 1 - ads * ads * (3 - 2 * ads);
      const ease = new Life(SHOOTER_DURATION, [['shoulder', SHOULDER], ['glance', GLANCE]]);
      let calm = 0;
      // (the eyes on the aim, at ease wandering about it and glancing aside now and then)
      const ahead = () => {
        const k = atEase() * calm, phase = ease.phase;
        const yaw = k * (EASE.wander * irregular(now, phase, 0.61, 1.13, 1.97) + EASE.glance * ease.value('glance'));
        const pitch = k * 0.6 * EASE.wander * irregular(now, phase + 1, 0.71, 1.29, 2.33);
        return look.eye.clone().addScaledVector(direction().applyEuler(new Euler(-pitch, yaw, 0, 'YXZ')), 20);
      };
      const recoil = () => {
        const u = (now - lastShot) / 0.2; // Tuned: requested 200 ms recovery, zero velocity at each end.
        return u >= 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 : 0;
      };
      // The rifle in the aim frame — the eye, turned as the player looks — as games lock a weapon to the camera: the scene moves it,
      // before the body poses, and the hands hold it where it is. Turning, at any rate, never leaves it behind (within `FLICK`); only
      // its place in that frame — carry, aim, sprint, reload — is followed, so changes of pose sway in at `SWAY`'s pace.
      // Tuned carry offsets (m) and muzzle rotations (rad), +X screen-left along +Z: the hip muzzle converges inward; sprint
      // lowers it diagonally across the chest; reloading brings it in to the middle under the chin, the muzzle a little up and the rifle
      // rolled `RELOAD_CANT` so the well faces the left hand (recalled: a magazine change "in the workspace", the rifle held close
      // under the eyes, as FPS reloads show it — in view, not below it). Derived: aiming puts the sight below the dominant eye.
      // Where it is held from the eye off the aim — out to the side, down at the hip and ahead — and where the support hand takes
      // the handguard are the default body's arms' (as a soldier sets an adjustable stock's length of pull and grips the handguard
      // within reach, recalled): × the body's `arms`; the hands reach it as the default's do, and the view shows it alike.
      const looked = new Quaternion();
      let aimed = false;
      // (its place in the frame now, the sub-step before, the one before that)
      const local = [0, 1, 2].map(() => ({ position: new Vector3(), quaternion: new Quaternion() }));
      const aimRifle = (t: number, dt: number) => {
        const view = rotation(), eye = look.eye;
        if (!aimed) {
          aimed = true;
          looked.copy(view);
          for (const at of local) {
            at.position.copy(rifle.current.position).sub(eye).applyQuaternion(view.clone().invert());
            at.quaternion.copy(view).invert().multiply(rifle.current.quaternion);
          }
        }
        [local[0], local[1], local[2]] = [local[2], local[0], local[1]];
        const [now, was, before] = local;
        const blend = 1 - atEase(), run = sprint * sprint * (3 - 2 * sprint), turn = reload * reload * (3 - 2 * reload);
        // (at ease it breathes and drifts, and is shouldered anew now and then: lifted and rolled a little)
        const k = atEase() * calm, breath = Math.sin(2 * Math.PI * 0.25 * t + ease.phase), shoulder = ease.value('shoulder');
        const drift = (a: number, b: number, c: number) => k * irregular(t, ease.phase, a, b, c);
        const to = new Vector3((-0.13 * (1 - blend) + 0.1 * run + 0.12 * turn) * arms + EASE.drift * drift(0.79, 1.37, 2.11),
          -SIGHT.y + (-0.14 * (1 - blend) + 0.02 * turn) * arms + k * (EASE.drift * breath + EASE.lift * Math.abs(shoulder)), (0.22 - 0.1 * run - 0.06 * turn) * arms - 0.012 * recoil());
        const tilt = new Quaternion().setFromEuler(new Euler(0.18 * (1 - blend) + 0.22 * run - 0.05 * turn + 0.5 * EASE.turn * k * breath,
          0.12 * (1 - blend) + 0.2 * run + EASE.turn * drift(0.93, 1.61, 2.47), k * EASE.roll * shoulder + RELOAD_CANT * turn));
        follow(before.position, was.position, to, SWAY, dt, now.position);
        followRotation(before.quaternion, was.quaternion, tilt, { accel: SWAY.turnAccel }, dt, now.quaternion);
        const spin = spinOf(looked, view, dt, new Vector3());
        looked.copy(view);
        const turned = followRotation(rifle.prev.quaternion, rifle.current.quaternion, view.multiply(now.quaternion), { accel: FLICK, velocity: spin }, dt);
        const frame = turned.clone().multiply(now.quaternion.clone().invert());
        rifle.move(t, now.position.clone().applyQuaternion(frame).add(eye), turned);
      };
      const part = (at: Vector3, size: Vector3): Prop => ({ kind: 'box',
        position: at.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position),
        size, quaternion: rifle.current.quaternion.clone() });
      return {
        report, player,
        wearing: (_, p) => {
          arms = p.arms;
          rifle.grips.foregrip.position.z = FOREGRIP.z * arms;
          return [{ item: rifle, on: INDEX.rightHand, at: { position: new Vector3(), quaternion: HAND.clone().invert() } },
            { item: spare, on: INDEX.chest, at: { position: POUCHES[0].clone().multiplyScalar(p.scale) } }];
        },
        move: (t) => {
          if (!actor) throw new Error('the player drives its actor');
          // (the root starts where the body stands)
          if (now === 0) controller.start(actor.pose.position(0), actor.yaw);
          const dt = t - now;
          now = t;
          if (!player.live) shooterTrack(t, player.input);
          const point = actor.rig.points.rightEye;
          actor.pose.point(point.bone, point.at, look.eye);
          [look.yaw, look.pitch] = [player.input.aimYaw, player.input.aimPitch];
          // (aiming waits for a reload; sprinting cancels one before the magazine is out, then waits)
          const input = { ...player.input, ads: player.input.ads && !reloading };
          controller.hold = reloading && pulled;
          if (player.input.reload && acquired && !reloading && !controller.sprinting(input)) wanted = true;
          controller.step(input, dt, actor.stepper);
          // Tuned 250 ms pose transitions, independent of camera/view.
          const approach = (value: number, target: number) => value + Math.max(-dt / 0.25, Math.min(dt / 0.25, target - value));
          ads = approach(ads, Number(input.ads));
          reload = approach(reload, Number(canted));
          sprint = approach(sprint, input.ads ? 0 : Math.max(actor?.locomotion.run ?? 0, Number(controller.sprinting(input))));
          // (standing at ease: not aiming, still, the look turning slower than 0.5 rad/s, no reload, no shot for a second)
          const turning = Math.hypot(wrapAngle(input.aimYaw - previousYaw), input.aimPitch - previousPitch) / dt;
          const quiet = !input.ads && ads === 0 && controller.root.velocity.length() < 0.05 && turning < 0.5 && !reloading && now - lastShot > 1;
          ease.update(t, dt, quiet);
          calm += (Number(quiet) - calm) * (1 - Math.exp(-dt / 0.3));
          // (the rifle where the aim has it, once off the hand it starts in)
          if (!rifle.wornBy) aimRifle(t, dt);
          if (player.input.aimYaw !== previousYaw || player.input.aimPitch !== previousPitch || player.input.ads !== previousAds) steadySince = t;
          previousYaw = player.input.aimYaw;
          previousPitch = player.input.aimPitch;
          previousAds = player.input.ads;
        },
        done: () => acquired && now >= SHOOTER_DURATION - 1 / 60,
        props: () => [
          part(new Vector3(0, 0.06, 0.12), new Vector3(0.065, 0.09, 0.42)),
          part(STOCK.clone().setZ(STOCK.z * arms), new Vector3(0.075, 0.16, 0.10)),
          part(new Vector3(-0.035, -0.005, -0.15), new Vector3(0.12, 0.07, 0.20)),
          part(new Vector3(0, 0.06, 0.48), new Vector3(0.025, 0.025, 0.32)),
          part(new Vector3(0, -0.055, 0), new Vector3(0.055, 0.14, 0.06)),
          part(SIGHT, new Vector3(0.02, 0.025, 0.12)),
          ...magazines.map((m): Prop => ({ kind: 'box', position: m.current.position.clone(), size: MAGAZINE.clone(), quaternion: m.current.quaternion.clone() })),
          ...[-3, 3].map((x): Prop => ({ kind: 'box', position: new Vector3(x, 0.4, 4), size: new Vector3(1.4, 0.8, 1) })),
          ...[-4, 0, 4].map((x): Prop => ({ kind: 'box', position: new Vector3(x, 1.3, 13), size: new Vector3(0.6, 1, 0.1) })),
          // (the muzzle flash last: it comes and goes, the others keep their places — the playback blends each with the one at its place)
          ...(now - lastShot < 0.06 ? [{ kind: 'ball' as const, position: new Vector3(0, 0.06, 0.68).applyQuaternion(rifle.current.quaternion).add(rifle.current.position), radius: 0.045 }] : []),
        ],
        script: (h) => {
          actor = h;
          // (the loaded magazine starts in the well, worn on the rifle from the first sub-step)
          loaded.move(0, WELL.position.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position), rifle.current.quaternion.clone().multiply(WELL.quaternion));
          const well = (f: Frame) => onItem(rifle, WELL)(f).position;
          // The support hand off what it holds and onto `grip` of `item` in a quick reach, closing on it there (it follows
          // the grip in the item's frame: the body moves what it wears and holds, so its walk or the aim's turn never leaves
          // the hand behind). A held magazine brought to `to` (world, moving), at the support hand's pace, till it is there
          // or `TAKE.bring` s are up (kept clear of the trunk, it may stop short: the pouch or the well then seats it).
          const bring = (item: Item, to: (f: Frame) => Placement) => function* () {
            const began = now;
            yield* hold(h, item, { to, motion: TAKE.motion, until: (f) => item.current.position.distanceTo(to(f).position) < TAKE.near || now - began > TAKE.bring })();
          };
          const take = (item: Item, grip: string) => function* () {
            yield* release(h, ['left'], { away: null })();
            const began = now;
            // (the hand kept on it through the sub-step it closes — the free arm's swing, which runs first, let it go
            // only after — and held there the next, before it moves on with what it took)
            yield* parallel<Frame>('race', handTo(h, 'left', item.grips[grip], { on: item, lead: false, ...TAKE.motion }), function* () {
              yield* when((f) => now - began >= TAKE.seconds && reached(f, INDEX.leftHand, item.grips[grip], item));
              yield* grab(h, { left: [item, grip] }, { walk: false, look: false })();
            });
            const closed = now;
            yield* when(() => now > closed);
          };
          // Recalled reload staging (e.g. common FPS reloads, ~2–2.5 s): the support hand off the
          // handguard to the magazine, drawn out and stowed in the free pouch, the full one taken
          // from its pouch, into the well (the eyes on it first), back to the handguard.
          const reloading_ = function* () {
            const [spent, full, slot, emptied] = [loaded, spare, free, stowed];
            let cancelled = false;
            steps.push('to magazine');
            yield* parallel<Frame>('race', take(spent, 'grip'),
              when(() => (cancelled = controller.sprinting(player.input))));
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
            // (a placement on a bone scales with the body: the default body's metres)
            const pouch = { position: POUCHES[slot].clone() };
            yield* bring(spent, onBone(h, INDEX.chest, pouch))();
            yield* wear(h, spent, INDEX.chest, { to: pouch, motion: TAKE.seat })();
            yield* withGaze(h, well, function* () {
              steps.push('to pouch');
              yield* take(full, 'grip')();
              yield* takeOff(h, full)();
              steps.push('insert');
              yield* bring(full, onItem(rifle, OUT))();
              yield* bring(full, onItem(rifle, WELL))();
              yield* wear(h, full, rifle, { to: WELL, motion: TAKE.seat })();
            })();
            // (the rifle turned back as the hand returns to the handguard)
            steps.push('handguard');
            canted = false;
            yield* take(rifle, 'foregrip')();
            [loaded, spare, stowed, free] = [full, spent, slot, emptied];
          };
          return function* () {
            // (held from the first sub-step, off the hand it starts in: from the next the scene moves it into the aim)
            yield* wear(h, loaded, rifle)();
            yield* takeOff(h, rifle)();
            yield* grab(h, { right: [rifle, 'pistol'] }, { walk: false, look: false })();
            yield* parallel<Frame>('all',
              watch('weapon pose', () => {
                if (!acquired || now - steadySince < 0.5 || now - lastShot < 0.5) return null;
                if (ads < 1) return null;
                const angle = new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(direction());
                if (angle > 2 * DEG) return { check: 'sight angle (rad)', value: angle, limit: 2 * DEG, where: 'rifle' };
                const sight = SIGHT.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(look.eye);
                const value = sight.addScaledVector(direction(), -sight.dot(direction())).length();
                return value > 0.01 ? { check: 'sight line offset (m)', value, limit: 0.01, where: 'rifle' } : null;
              }),
              idle(h, { root: controller.root }),
              // (aiming, the body holds still: its breathing and sway fade)
              ask(h, () => ({ steady: 1 - atEase() })),
              aimAt(h, ahead),
              reporting(report, ['leftHand', 'rightHand', 'gaze'], function* () {
                yield* parallel<Frame>('all',
                  function* () {
                    yield* when((f) => f.time >= 0.9);
                    yield* named('take foregrip', grab(h, { left: [rifle, 'foregrip'] }, { walk: false, look: false }))();
                    acquired = true;
                    for (;;) {
                      yield* hold(h, rifle, { until: () => wanted })();
                      [wanted, reloading, pulled, canted] = [false, true, false, true];
                      yield* named('reload', reloading_)();
                      reloading = false;
                    }
                  },
                  () => action<Frame>({ update: (f) => {
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
