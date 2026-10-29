import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { carry, grab, lookAt, release, wait, type Root } from '@drawcall/animate';
import { scalar } from '../keys';
import type { Look, Person, Player, Scenario } from '../scenario';
import { ball, box, empty } from '../things';

/**
 * The rifle (m, from its pistol grip, the barrel along +Z, for the default body's arms) and its weight (kg): the support hand's place on
 * the handguard, the sight, the magazine well and below it (where a magazine comes out to and goes in from), the muzzle.
 */
const RIFLE = {
  mass: 3, foregrip: new Vector3(0, 0.035, 0.2), sight: new Vector3(0, 0.12, 0), stock: new Vector3(-0.07, -0.075, -0.24),
  well: new Vector3(0, -0.055, 0.09), belowWell: new Vector3(0, -0.2, 0.08), muzzle: new Vector3(0, 0.06, 0.68),
};
/** the right hand on the pistol grip: its palm in at the grip, the fingers round it (the hand bone's frame in the rifle's) */
const PISTOL_GRIP = new Euler(0, Math.PI, 0);
/** a magazine (m): a box below the receiver, held at its base, and its weight (kg) */
const MAGAZINE = { size: new Vector3(0.03, 0.15, 0.07), base: new Vector3(0, -0.065, 0), mass: 0.5 };
/**
 * the magazine pouches on the vest, left of the middle (from the chest bone, the body's frame: +X left, +Z ahead; m, the default body's):
 * below the chest, aside and down as far as the arms are long, and out as far as the hands keep a load clear of the trunk; and how far
 * above its pouch a magazine comes out to (m)
 */
const POUCHES = [new Vector3(0.06, -0.17, 0.2), new Vector3(0.13, -0.17, 0.2)];

/**
 * Where the rifle is held in the look's frame (from the right eye: +X left, +Y up, +Z ahead; m for the default body's arms, rad): at the
 * hip, the muzzle converging in; aiming, the sight under the eye; sprinting, low across the chest, and reloading, in to the middle and
 * rolled so its well faces the support hand (both added to the hip's). Each eases in over `EASE` s.
 */
const HIP = { at: new Vector3(-0.14, -0.1, 0.18), turn: new Vector3(0.18, 0.12, 0) };
const AIMED = { at: new Vector3(0, 0, 0.22), turn: new Vector3() };
const SPRINTING = { at: new Vector3(0.1, -0.03, -0.04), turn: new Vector3(0.22, 0.2, 0) };
const RELOADING = { at: new Vector3(0.12, 0.02, -0.06), turn: new Vector3(-0.05, 0, 0.4) };
const EASE = 0.25;
/** a shot's kick (m back, rad up) over its recovery (s), and the least time between shots (s) */
const RECOIL = { back: 0.012, up: 0.012, seconds: 0.2, between: 0.24 };
/** a reload's hands: quick, as a drilled one is (m/s) */
const QUICK = { speed: 1.8 };
/** at ease, the rifle breathes with the body: how far (m, rad) at what rate (Hz); at ease once still this long (s) */
const BREATH = { drift: 0.004, roll: 0.03, rate: 0.25, after: 1 };

/**
 * The player's moves, recalled from game feel (Unreal's character movement, CS/COD): walking 1.4 m/s, slower back and aside, a 3.5 m/s
 * sprint forward only, aiming slows to 0.65 of it and a crouch-walk is 0.8 m/s; a 10 m/s² response, 2 m/s² steering in the air; the
 * facing eased over 25 ms toward the look; a jump's take-off at 2.5 m/s (~0.32 m up for ~0.5 s).
 */
const SPEED = { forward: 1.4, back: 1.1, side: 1.1, sprint: 3.5, aiming: 0.65, crouching: 0.8 / 1.4 };
const ACCEL = { ground: 10, air: 2 };

/** mouse turns (minimum jerk): a turn while walking, a quick turn standing, quick turns aiming */
const TURNS = scalar([[0, 0], [24, 0], [28, 1.2], [29.5, 1.2], [30.7, -0.6], [56.8, -0.6], [57.4, 0.4], [58.2, 0.4], [58.8, -0.6]]);

/**
 * The demo's input at `time` (s): walking, strafing, back-pedalling, aiming standing and walking, a sprint, a walk while turning, a stop
 * and a turn, aiming and firing, a crouch-walk, jumps from a walk and a sprint, a reload while walking, standing at ease, quick turns aiming.
 */
function scriptedInput(time: number, input: Player['input']) {
  const between = (from: number, to: number) => time >= from && time < to;
  input.move.z = between(3, 6) || between(15.5, 17) || between(18, 28) || between(36.5, 39.5) || between(41, 47.5) || between(48.5, 51.8) ? 1 : between(10, 12) ? -1 : 0;
  input.move.x = between(6, 8) ? 1 : between(8, 10) ? -1 : 0;
  input.ads = between(13, 17) || between(32, 35) || between(56, 60);
  input.sprint = between(18.5, 23.5) || between(44, 47);
  input.crouch = between(35.5, 40.3);
  input.jump = between(42.5, 42.6) || between(45.7, 45.8);
  input.reload = between(49, 49.1);
  input.aimYaw = TURNS(time);
  input.aimPitch = 0;
  input.fire = between(14.5, 15.2) || between(33.5, 34.2);
  input.view = Math.floor(time / 7) % 2 ? 'first' : 'third';
}

export function shooter(): Scenario {
  return {
    id: 'shooter', title: 'Full-body shooter',
    description: 'Click to play · mouse look · WASD move (relative to where you look) · Shift sprint · right mouse aim down sights · left click fire · Space jump · C or Ctrl crouch · R reload · V first/third person · Esc release mouse. The body always faces where you look; the legs step to keep up.',
    duration: 62, cameraDistance: 4,
    stage: (cast) => {
      const scene = new Group();
      const root: Root & { velocity: Vector3 } = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
      const person = cast.person({ drive: () => root, life: { steady: () => smooth(aiming) } });
      root.position.copy(person.position);
      root.yaw = person.facing;
      const proportions = person.species.person;
      if (!proportions) throw new Error('the shooter is a person');
      const arms = proportions.arms;

      const eye = onBone(person, person.bones.head, 'right eye', new Vector3(-proportions.head.eye.x, proportions.head.eye.y, proportions.head.eye.z));
      // (the chest bears the rifle, but the aim places it in the world: its world matrix stays where the app puts it as the chest turns)
      const chest = person.bones.chest, mount = empty(chest, 'aim', new Vector3());
      chest.updateWorldMatrix(true, false);
      const chestBefore = chest.matrixWorld.clone(), carried = new Matrix4();
      mount.matrixWorldAutoUpdate = false;
      const rifle = rifleOn(mount, arms);
      const well = rifle.getObjectByName('well')!, flash = rifle.getObjectByName('flash')!;
      const pouches = POUCHES.map((at, i) => {
        const pouch = onBone(person, chest, `pouch ${i + 1}`, at.clone().multiply(new Vector3(arms, arms, proportions.scale)));
        empty(pouch, `over pouch ${i + 1}`, new Vector3(0, 0.1 * proportions.scale, 0));
        pouch.userData.approach = [`over pouch ${i + 1}`];
        return pouch;
      });
      const magazines = [magazineIn(well, 'magazine 1'), magazineIn(pouches[0], 'magazine 2')];
      for (const [x, z] of [[-3, 4], [3, 4]]) box(scene, 'cover', new Vector3(1.4, 0.8, 1), new Vector3(x, 0.4, z));
      for (const x of [-4, 0, 4]) box(scene, 'target', new Vector3(0.6, 1, 0.1), new Vector3(x, 1.3, 13));

      const input: Player['input'] = { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, fire: false, ads: false, sprint: false, crouch: false, jump: false, reload: false, view: 'third' };
      const look: Look = { eye: new Vector3(), yaw: 0, pitch: 0 };
      const steps: string[] = [];
      let time = 0, acquired = false, reloading = false, pulled = false, jumped = false;
      let aiming = 0, sprinted = 0, reloaded = 0, lastShot = -Infinity, stillSince = 0;
      const player: Player = {
        input, live: false,
        status: () => ({ reloading, steps, magazines }),
        look: () => ({ ...look, eye: look.eye.clone() }),
      };

      // (aiming waits for a reload; a reload under way with its magazine out holds off a sprint)
      const ads = () => input.ads && !reloading;
      const sprinting = () => input.sprint && !ads() && input.move.z > 0 && !pulled;
      const atEase = () => time - stillSince > BREATH.after;
      const view = () => new Quaternion().setFromEuler(new Euler(-look.pitch, look.yaw, 0, 'YXZ'));
      const ahead = () => new Vector3(0, 0, 20).applyQuaternion(view()).add(look.eye);

      /** the root as the keys move it over `seconds`: facing the look, moving relative to it, crouching, jumping on a press */
      const steer = (seconds: number) => {
        root.yaw += wrapAngle(input.aimYaw - root.yaw) * (1 - Math.exp(-seconds / 0.025));
        const { x, z } = input.move, length = Math.hypot(x, z), wanted = new Vector3();
        if (length > 0) {
          const forward = z > 0 ? (sprinting() ? SPEED.sprint : SPEED.forward) : SPEED.back;
          const speed = 1 / Math.hypot(x / length / SPEED.side, z / length / forward);
          const crouching = input.crouch && !sprinting();
          wanted.set(x, 0, z).applyAxisAngle(UP, input.aimYaw).setLength(speed * (ads() ? SPEED.aiming : 1) * (crouching ? SPEED.crouching : 1));
        }
        root.velocity.add(wanted.sub(root.velocity).clampLength(0, (person.airborne ? ACCEL.air : ACCEL.ground) * seconds));
        root.position.addScaledVector(root.velocity, seconds);
        root.crouch = input.crouch && !sprinting() ? 1 : 0;
        root.jump = input.jump && !jumped && !person.airborne ? 2.5 : undefined;
        jumped = input.jump;
      };

      /** the rifle where the aim holds it: in the look's frame from the eye, as the poses' weights have it, kicked by a shot; the chest's turn does not alter that world placement */
      const hold = () => {
        const kick = Math.sin(Math.PI * Math.min(1, (time - lastShot) / RECOIL.seconds)) ** 2, breath = atEase() ? Math.sin(2 * Math.PI * BREATH.rate * time) : 0;
        const blend = (pose: 'at' | 'turn') => new Vector3().lerpVectors(HIP[pose], AIMED[pose], smooth(aiming))
          .addScaledVector(SPRINTING[pose], smooth(sprinted)).addScaledVector(RELOADING[pose], smooth(reloaded));
        const at = blend('at').multiplyScalar(arms).add(new Vector3(0, breath * BREATH.drift - RIFLE.sight.y, -kick * RECOIL.back));
        const turn = blend('turn').add(new Vector3(kick * RECOIL.up, 0, breath * BREATH.roll));
        const turned = view().multiply(new Quaternion().setFromEuler(new Euler(turn.x, turn.y, turn.z)));
        mount.matrixWorld.compose(at.applyQuaternion(view()).add(look.eye), turned, ONE);
      };

      /**
       * each frame: the input, the root, how this frame's update will carry the chest (as the last one did), the look from the eye carried
       * so, the rifle in that look, a shot
       */
      const frame = (seconds: number) => {
        time += seconds;
        if (!player.live) scriptedInput(time, input);
        const turning = Math.hypot(wrapAngle(input.aimYaw - look.yaw), input.aimPitch - look.pitch) / seconds;
        // (still: holding the rifle, not aiming, reloading, moving, turning the look or shooting)
        if (!acquired || ads() || reloading || root.velocity.length() > 0.05 || turning > 0.5 || time - lastShot < 1) stillSince = time;
        aiming = ease(aiming, Number(ads()), seconds);
        sprinted = ease(sprinted, Number(sprinting()), seconds);
        reloaded = ease(reloaded, Number(reloading), seconds);
        steer(seconds);
        chest.updateWorldMatrix(true, false);
        carried.multiplyMatrices(chest.matrixWorld, chestBefore.invert());
        chestBefore.copy(chest.matrixWorld);
        Object.assign(look, { eye: eye.getWorldPosition(look.eye).applyMatrix4(carried), yaw: input.aimYaw, pitch: input.aimPitch });
        if (acquired && input.fire && !sprinting() && !reloading && time - lastShot >= RECOIL.between) lastShot = time;
        flash.visible = time - lastShot < 0.06;
        hold();
      };

      // A reload (~2–2.5 s, as games show one): the support hand off the handguard to the magazine, out of the well and into the free
      // pouch, the full one out of its pouch and into the well, and back on the handguard. Sprinting before the magazine is out calls it off.
      const reload = function* () {
        reloading = true;
        const spent = magazines.find((magazine) => magazine.parent === well)!, full = magazines.find((magazine) => magazine !== spent)!;
        const free = pouches.find((pouch) => pouch !== full.parent)!;
        steps.push('to magazine');
        let cancelled = false;
        yield* parallel('race', grab(person, spent, { left: 'base' }, QUICK), function* () {
          yield* wait(sprinting);
          cancelled = true;
        });
        if (cancelled) steps.push('cancelled');
        else {
          pulled = true;
          steps.push('stow');
          yield* carry(person, spent, free, QUICK);
          release(person, spent, free);
          steps.push('to pouch');
          yield* grab(person, full, { left: 'base' }, QUICK);
          steps.push('insert');
          yield* carry(person, full, well, QUICK);
          release(person, full, well);
          steps.push('handguard');
        }
        // (the eyes and the trunk back on the aim as the hand goes back)
        reloading = pulled = false;
        yield* grab(person, rifle, { left: 'foregrip' });
      };

      eye.getWorldPosition(look.eye);
      hold();
      return {
        scene, bodies: [person], player,
        // (the hands and eyes first each frame, on the rifle where the aim put it the frame before: where the body holds it now)
        story: () => parallel('all',
          function* () {
            yield* grab(person, rifle, { right: 'pistol', left: 'foregrip' });
            acquired = true;
            for (;;) {
              yield* wait(() => input.reload && !sprinting());
              yield* reload();
            }
          },
          // (the eyes and the trunk on the aim; at ease or reloading they are free: they look about, or go with the magazine)
          function* () {
            for (;;) {
              yield* lookAt(person, ahead, { trunk: 0.65, until: () => atEase() || reloading });
              yield* wait(() => !atEase() && !reloading);
            }
          },
          action({ update: (_, clock) => frame(clock.delta) }),
        ),
        done: () => acquired && time >= 62 - 1 / 60,
      };
    },
  };
}

/** the rifle on `mount`, its handguard and stock where the body's `arms` (over the default's) hold them: grips, well, muzzle flash */
function rifleOn(mount: Object3D, arms: number): Object3D {
  const rifle = empty(mount, 'rifle', new Vector3());
  rifle.userData.mass = RIFLE.mass;
  const pistol = empty(rifle, 'pistol', new Vector3());
  pistol.quaternion.setFromEuler(PISTOL_GRIP);
  pistol.userData.handTurn = true;
  empty(rifle, 'foregrip', RIFLE.foregrip.clone().setZ(RIFLE.foregrip.z * arms));
  box(rifle, 'receiver', new Vector3(0.065, 0.09, 0.42), new Vector3(0, 0.06, 0.12));
  box(rifle, 'stock', new Vector3(0.075, 0.16, 0.1), RIFLE.stock.clone().setZ(RIFLE.stock.z * arms));
  box(rifle, 'lower', new Vector3(0.12, 0.07, 0.2), new Vector3(-0.035, -0.005, -0.15));
  box(rifle, 'barrel', new Vector3(0.025, 0.025, 0.32), new Vector3(0, 0.06, 0.48));
  box(rifle, 'grip', new Vector3(0.055, 0.14, 0.06), new Vector3(0, -0.055, 0));
  box(rifle, 'sight', new Vector3(0.02, 0.025, 0.12), RIFLE.sight);
  ball(rifle, 'flash', 0.045, RIFLE.muzzle).visible = false;
  const well = empty(rifle, 'well', RIFLE.well);
  well.rotation.x = -0.15;
  empty(rifle, 'below the well', RIFLE.belowWell);
  well.userData.approach = ['below the well'];
  return rifle;
}

/** a magazine named `name` in `place` */
function magazineIn(place: Object3D, name: string): Object3D {
  const magazine = box(place, name, MAGAZINE.size, new Vector3());
  magazine.userData.mass = MAGAZINE.mass;
  empty(magazine, 'base', MAGAZINE.base);
  return magazine;
}

/** an empty named `name` on `bone`, `offset` from it as the body stands now (the body's frame: +X left, +Z ahead), turned as the body faces */
function onBone(person: Person, bone: Object3D, name: string, offset: Vector3): Object3D {
  const placed = new Object3D();
  placed.name = name;
  placed.quaternion.setFromAxisAngle(UP, person.facing);
  placed.position.copy(offset).applyQuaternion(placed.quaternion).add(bone.getWorldPosition(new Vector3()));
  bone.attach(placed);
  return placed;
}

/** `weight` eased toward `goal` over `EASE` s */
const ease = (weight: number, goal: number, seconds: number) => weight + Math.max(-seconds / EASE, Math.min(seconds / EASE, goal - weight));
/** a weight's smooth step (0 … 1, at rest at both ends) */
const smooth = (weight: number) => weight * weight * (3 - 2 * weight);
/** `angle` wrapped into (−π, π] */
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const UP = new Vector3(0, 1, 0), ONE = new Vector3(1, 1, 1);
