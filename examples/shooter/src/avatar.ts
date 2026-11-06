import { Body, carry, grab, humanoid, lookAt, release, wait, type Floor, type Root } from '@drawcall/animate';
import { action, parallel, runTimeline } from '@pmndrs/timeline';
import { BufferGeometry, Euler, Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { anglesOf, wrapAngle } from './angles';
import type { Look } from './playback';
import { SOLDIER } from './skeleton';
import { empty, RIFLE, rifleOn } from './weapon';
import { Litter } from './weapon/litter';
import { WeaponMotion } from './weapon/motion';

export interface AvatarState {
  position: Vector3;
  velocity: Vector3;
  yaw: number;
  pitch: number;
  aim: boolean;
  sprint: boolean;
  crouch: boolean;
  support: Vector3 | null;
  platform?: Object3D;
  takeoff?: number;
  firstPerson: boolean;
  /** what a soldier seen from outside aims at, its barrel converging on it; without it the barrel is zeroed at `ZERO` */
  aimPoint?: Vector3;
}

const SPRINTING = new Vector3(0.22, 0.2, 0);
/** How the rifle turns through a reload (rad, as `SPRINTING`): up before the chest, canted 9° toward the support hand — canted 23°, an
 * upright magazine from the pouch had 24° to turn under the well, which the arm took 0.15 s over; at 9°, 13°. */
const RELOADING = new Vector3(-0.05, 0, 0.15);
/** The rifle held low at a lift's panel, its muzzle down and a little to the right, clear of the panel (which stands to its left), both
 * hands on it and through a press in the right hand alone: the same turn, so it stays still as the left hand leaves it and takes it again.
 * Turned 0.6 rad right, the support hand's grip was past its arm's reach and the rifle swung toward it as it let go and came back; held
 * there by the support arm, it lay against a panel straight before it. Turned to it over `LOWERING` (s). */
const LOWERED = new Vector3(0.6, -0.1, 0);
const LOWERING = 0.5;
const EASE = 0.25;
/** Seconds between shots. */
const SHOT_INTERVAL = 0.1;
/** Metres ahead of the eye at which a player's barrel line crosses the view. */
const ZERO = 25;
const QUICK = { speed: 1.8 };
/** How fast the left hand goes to the pouch and brings the magazine from it to the well (m/s). */
const BRISK = { speed: 2.6 };
/** How long a pressing pad stays on its button before it lets go (s): as long as the cap takes to go in under it. */
const HELD = 0.08;
/** A hand goes to a button from where the soldier stands. */
const POKE = { step: false };
/** How fast a fresh body's hands take the rifle it stands up with (m/s): at once, to take over from a pose held elsewhere. */
const SNATCH = { speed: 8 };
const REST_AFTER = 1;
/** How far a shot draws the trigger back (m), through the shot's interval: back all along while held fire keeps firing. */
const SQUEEZE = 0.005;
/** The pouches' magazines on the left of the body: the left hand takes the chest one round its body as it will seat it in the well, and
 * a fresh one is in that pouch again once the hand is back on the rifle; the one on the belt, out, down and back from it, is a spare's
 * spare — beside it on the chest, it hid the thumb on the taken one's outer face from the left (5 cm lower, it hung at mid-thigh). The
 * chest one 5 cm off the middle: nearer, the left hand reached it with its wrist bent back across the sternum, its fingers off the body;
 * as high as puts the grip low on the magazine where the hand took it before (2.5 cm lower, the hand turned 0.3 s longer onto it). Each
 * stands upright in the vest's upright pouch, its faces to the sides, the hand taking its front edge: canted as the well stands through
 * a reload, it sat diagonally across the pouch; turned out 30°, the arm took 0.27 s under the well turning it the 42° on (it turns a
 * carried magazine only once it is there). */
const POUCHES = [new Vector3(0.07, -0.129, 0.2), new Vector3(0.21, -0.25, 0.15)];
/** Where a spent magazine is flung toward from the bottom of its pull (m, the body's frame: +X its left), how fast (m/s), and how far on
 * its way it is let go (m): out to the left and down, clear of the leg. */
const FLING = { to: new Vector3(1.0, 1.0, 0.3), speed: 5, after: 0.2 };
const UP = new Vector3(0, 1, 0);
/** How near its place under the well, on the well's line, and how near turned as the well (rad), the arm brings a magazine before the
 * fingers square it onto it (`square`), in how long (s): held to 3° by the arm, it wobbled 2 cm off and 23° round for 0.3 s. */
const LINED = 0.015, ALIGNED = 0.1, SQUARING = 0.08;
/** How long a magazine takes to be pushed up the well's line to its seat (s), slowing as it seats: its last 4 cm over 0.16 s, not
 * snapped in (pushed evenly over 0.18 s, they took 0.10 s). */
const PUSH = 0.25;
/** How long a spent magazine takes to be pulled down the well's line until it is out of it (s), gathering speed into its fling. */
const PULL = 0.12;

/** The soldier's story: a shouldered rifle, aim, recoil and magazine swaps, with its root supplied by the capsule controller. */
export class Avatar {
  readonly group = new Group();
  private animation;
  /** a fresh body being readied off screen, to show in place of this one */
  private next: ReturnType<typeof animate> | undefined;
  /** the spent magazines its bodies have thrown away, lying where they fell */
  private readonly litter: Litter;

  constructor(
    scene: Object3D, private readonly model?: Object3D,
    private readonly floor: Floor = () => 0,
    private readonly onReload?: (phase: 'out' | 'in') => void,
  ) {
    this.litter = new Litter(scene);
    this.animation = animate(model && clone(model), new Vector3(), 0, floor, false, this.litter, onReload);
    this.group.add(this.animation.person.object);
    scene.add(this.group);
  }

  get muzzle(): Object3D { return this.animation.muzzle; }
  get rifle(): Object3D { return this.animation.rifle; }
  /** the aiming (right) eye, on the head */
  get eye(): Object3D { return this.animation.eye; }
  get body() { return this.animation.person; }
  get acquired(): boolean { return this.animation.acquired(); }
  get reloading(): boolean { return this.animation.reloading(); }
  get reloads(): number { return this.animation.reloads(); }
  /** How far the rifle has come up to the eye, eased from 0 to 1. */
  get aimWeight(): number { return this.animation.aimWeight(); }

  look(): Look {
    const { eye, yaw, pitch, intent } = this.animation.look;
    return { eye: eye.clone(), yaw, pitch, intent: { ...intent } };
  }

  /**
   * Turns the displayed body about the eye from the blended `look` to the player's current `yaw` and `pitch`, so the camera
   * follows the mouse every rendered frame and the rifle in the hands follows the camera rigidly between simulation steps.
   */
  face(look: Look, yaw: number, pitch: number): Look {
    const shown = { yaw: yaw + look.yaw - look.intent.yaw, pitch: pitch + look.pitch - look.intent.pitch };
    const from = new Quaternion().setFromEuler(new Euler(-look.pitch, look.yaw, 0, 'YXZ'));
    const turn = new Quaternion().setFromEuler(new Euler(-shown.pitch, shown.yaw, 0, 'YXZ')).multiply(from.invert());
    this.group.position.sub(look.eye).applyQuaternion(turn).add(look.eye);
    this.group.quaternion.premultiply(turn);
    this.group.updateMatrixWorld(true);
    return { eye: look.eye.clone(), ...shown, intent: { yaw, pitch } };
  }

  requestReload() { this.animation.requestReload(); }
  /** Asks the left hand to press `button` (a thing whose grip `press` is the index's pad on its face) with its fingertip, calling `pressed` as the pad comes onto it, then to take the rifle again; ignored while it reloads or presses. */
  press(button: Object3D, pressed: () => void) { this.animation.press(button, pressed); }
  /** Holds the rifle low, as for a press, while `low` (the soldier at a lift's panel) and it does not aim. */
  lower(low: boolean) { this.animation.lower(low); }
  /** Whether a press is asked for or under way. */
  get pressing(): boolean { return this.animation.pressing(); }
  fire(): boolean { return this.animation.fire(); }

  /** Starts afresh standing at `position`, the rifle on its shoulder for the hands to take, the magazines it threw away cleared. */
  reset(position: Vector3, yaw = 0) {
    this.litter.clear();
    this.show(animate(this.model && clone(this.model), position, yaw, this.floor, false, this.litter, this.onReload));
  }

  update(dt: number, input: AvatarState) {
    this.animation.update(dt, input);
    this.group.updateMatrixWorld(true);
  }

  /** Starts readying a fresh body off screen, standing at `position` and snatching up the rifle, while this one is still shown. */
  prepare(position: Vector3, yaw: number) {
    this.next?.dispose();
    this.next = animate(this.model && clone(this.model), position, yaw, this.floor, true, this.litter, this.onReload);
  }

  /** Steps the fresh body; once its hands have the rifle it is shown in place of this one, and true is returned. */
  ready(dt: number, input: AvatarState): boolean {
    const next = this.next;
    if (!next) throw new Error('No fresh body is being readied');
    next.update(dt, input);
    if (!next.acquired()) return false;
    this.next = undefined;
    this.show(next);
    return true;
  }

  /** Hides the head from the first-person camera until `afterRender`. */
  beforeRender() { this.animation.person.bones.head.scale.setScalar(1e-3); }

  afterRender() { this.animation.person.bones.head.scale.setScalar(1); }

  dispose() {
    this.next?.dispose();
    this.animation.dispose();
    this.litter.clear();
    this.group.removeFromParent();
  }

  private show(animation: ReturnType<typeof animate>) {
    this.next?.dispose();
    this.next = undefined;
    this.animation.dispose();
    this.group.clear();
    this.animation = animation;
    this.group.add(animation.person.object);
    this.group.updateMatrixWorld(true);
  }
}

function animate(model: Object3D | undefined, position: Vector3, yaw: number, floor: Floor, snatch: boolean, litter: Litter, onReload?: (phase: 'out' | 'in') => void) {
  const root: Root & { velocity: Vector3 } = { position: position.clone(), velocity: new Vector3(), yaw, support: position.clone() };
  let aiming = 0;
  const person = new Body(humanoid(SOLDIER), { model, at: position, floor, face: yaw, drive: () => root, life: { steady: () => smooth(aiming) } });
  person.object.traverse((node) => (node.frustumCulled = false));
  const proportions = person.species.person;
  if (!proportions) throw new Error('The shooter requires a humanoid');
  const arms = proportions.arms;
  const eye = onBone(person, person.bones.head, 'right eye', new Vector3(-proportions.head.eye.x, proportions.head.eye.y, proportions.head.eye.z));
  const chest = person.bones.chest;
  // (the butt in the pocket inside the shoulder joint, 9 cm right of the chest's middle: the receiver's front, where the left hand holds
  // it palm up, 5.5 cm nearer it than with the butt out at the joint, where the short arm fell 2 cm short)
  const pocket = onBone(person, chest, 'shoulder pocket', new Vector3(-0.09, 0.19, 0.1).multiplyScalar(proportions.scale));
  const mount = empty(pocket, 'aim', new Vector3());
  const { rifle, pistol, blade, well, below, flash, muzzle, stock, magazineIn, dispose: disposeWeapon } = rifleOn(mount, arms);
  rifle.position.copy(stock.position).negate();
  const motion = new WeaponMotion();
  const pouches = POUCHES.map((at, i) => {
    const pouch = onBone(person, chest, `pouch ${i + 1}`, at.clone().multiply(new Vector3(arms, arms, proportions.scale)));
    empty(pouch, `over pouch ${i + 1}`, new Vector3(0, 0.1 * proportions.scale, 0));
    pouch.userData.approach = [`over pouch ${i + 1}`];
    return pouch;
  });
  /** the magazines on it, each named by when it was issued: the one in the well and one in each pouch at first */
  const magazines: Object3D[] = [];
  let issued = 0;
  const issue = (place: Object3D) => magazines.push(magazineIn(place, `magazine ${++issued}`));
  for (const place of [well, ...pouches]) issue(place);
  let input: AvatarState = { position, velocity: new Vector3(), yaw, pitch: 0, aim: false, sprint: false, crouch: false, support: position.clone(), firstPerson: false };
  const look: Look = { eye: new Vector3(), yaw, pitch: 0, intent: { yaw, pitch: 0 } };
  let time = 0, acquired = false, swapping = false, reloadWanted = false, reloads = 0;
  /** a button the left hand is asked to press, and what to tell as it does: until the hand is back on the rifle */
  let pressWanted: { button: Object3D; pressed: () => void } | null = null;
  /** the left hand off the rifle for a press, the rifle lowered meanwhile (it comes up again as the hand draws back off the button) */
  let lowering = false;
  /** standing at a lift's panel: the rifle held low unless it aims */
  let low = false;
  let sprinted = 0, reloaded = 0, lowered = 0, lastShot = -Infinity, stillSince = 0;
  const sprinting = () => input.sprint && !input.aim;
  const atEase = () => time - stillSince > REST_AFTER;
  const reloading = () => swapping || reloadWanted;
  /** The intended pitch raised by the rifle's recoil. */
  const kicked = () => input.pitch - motion.recoil.position.x * 0.25;
  const view = () => {
    let pitch = kicked(), yaw = input.yaw;
    if (input.aimPoint) ({ yaw, pitch } = anglesOf(input.aimPoint.clone().sub(look.eye)));
    // Reload in front of the chest even while the camera looks at the ground or sky, or turns ahead of the body.
    pitch *= 1 - smooth(reloaded);
    yaw += wrapAngle(person.facing - yaw) * smooth(reloaded);
    return new Quaternion().setFromEuler(new Euler(-pitch, yaw, 0, 'YXZ'));
  };
  const ahead = () => new Vector3(0, 0, ZERO).applyQuaternion(view()).add(look.eye);

  /** How the rifle rode the chest through a reload (its turn on the shoulder pocket), to ease back to the aim from. */
  let rode: Quaternion | undefined;
  const hold = (seconds: number) => {
    // Through the swap the rifle rides the chest as it sways and twists under a running body, its well where the hand last found it.
    if (swapping && reloaded === 1) {
      person.orient(mount, null);
      rode = mount.quaternion.clone();
      return;
    }
    const facing = view();
    const drift = motion.drift.position.clone().applyQuaternion(facing.clone().invert()).multiplyScalar(1 - smooth(aiming));
    const position = pocket.getWorldPosition(new Vector3());
    // A player's barrel crosses the view at a fixed distance, so the rifle holds still in view as the crosshair sweeps near and far
    // things (the shot itself goes to the crosshair); a soldier seen from outside converges on what it aims at.
    const target = input.aimPoint ?? ahead();
    const pointed = anglesOf(target.clone().sub(position));
    // Aim the barrel line above the shoulder contact, not the grip-to-target line.
    const pitch = pointed.pitch - Math.asin(Math.min(1, (RIFLE.muzzle.y - stock.position.y) / target.distanceTo(position)));
    // The rifle points where the view does, from the hip and down the sights: the trunk turns after it, and the body only brings it back
    // within the arms' reach where the trunk has not yet come round (`Body.orient`).
    const aimed = new Quaternion().setFromEuler(new Euler(-pitch, pointed.yaw, 0, 'YXZ'));
    const turn = SPRINTING.clone().multiplyScalar(smooth(sprinted)).addScaledVector(RELOADING, smooth(reloaded)).addScaledVector(LOWERED, smooth(lowered))
      .add(new Vector3(motion.recoil.position.x - 2 * drift.y, 2 * drift.x, -3 * drift.x));
    aimed.slerp(facing, smooth(reloaded));
    const turned = aimed.multiply(new Quaternion().setFromEuler(new Euler(turn.x, turn.y, turn.z)));
    if (rode) turned.slerp(pocket.getWorldQuaternion(new Quaternion()).multiply(rode), smooth(reloaded));
    if (reloaded === 0) rode = undefined;
    person.orient(mount, turned);
  };

  const see = () => {
    eye.getWorldPosition(look.eye);
    look.intent.yaw = look.yaw = input.yaw;
    look.intent.pitch = input.pitch;
    look.pitch = kicked();
    if (!input.firstPerson || aiming === 0) return;
    const direction = muzzle.getWorldDirection(new Vector3());
    // The eye rests above the cheek piece, ahead of the butt pad.
    const sight = rifle.localToWorld(RIFLE.sight.clone()).addScaledVector(direction, -0.16);
    const weight = smooth(aiming);
    look.eye.lerp(sight, weight);
    const sighted = anglesOf(direction);
    look.yaw += wrapAngle(sighted.yaw - look.yaw) * weight;
    look.pitch += (sighted.pitch - look.pitch) * weight;
  };

  const frame = (seconds: number) => {
    time += seconds;
    const turning = Math.hypot(wrapAngle(input.yaw - look.yaw), input.pitch - look.pitch) / seconds;
    if (!acquired || input.aim || swapping || root.velocity.length() > 0.05 || turning > 0.5 || time - lastShot < 1) stillSince = time;
    aiming = ease(aiming, Number(input.aim), seconds);
    sprinted = ease(sprinted, Number(sprinting()), seconds);
    reloaded = ease(reloaded, Number(swapping), seconds);
    lowered = ease(lowered, Number(lowering || (low && acquired && !input.aim)), seconds, LOWERING);
    motion.update(seconds, chest.getWorldPosition(new Vector3()).sub(root.position));
    root.position.copy(input.position);
    root.velocity.copy(input.velocity);
    root.support = input.support;
    root.platform = input.platform;
    root.yaw += wrapAngle(input.yaw - root.yaw) * (1 - Math.exp(-seconds / 0.025));
    root.crouch = input.crouch && !sprinting() ? 1 : 0.6 * (input.takeoff ?? 0);
    flash.visible = time - lastShot < 0.06;
    // The trigger finger lies along the receiver above the guard until the rifle is asked up or fires, then rests on the trigger, squeezing
    // it back for a shot; the other fingers and the thumb close round the grip themselves.
    pistol.userData.fingers = { index: input.aim || time - lastShot < 0.5 ? 'trigger' : 'frame' };
    blade.position.z = time - lastShot < SHOT_INTERVAL ? -SQUEEZE : 0;
    hold(seconds);
  };

  // The left hand pinches the spent magazine's body under the well, pulls it down out of it and flings it away down and out, letting go
  // on the way (the litter takes it and lets it fly on as the hand moved it), then pinches the full one in its pouch, brings it up under
  // the well and pushes it home.
  /** `magazine`, held, slid `by` (m) along the well's line (its parent turned as the well) in `seconds`, along `way` (the share of the
   * way gone at each share of the time), the hand going with it */
  const slide = (magazine: Object3D, by: number, seconds: number, way: (share: number) => number) => {
    const from = magazine.position.y;
    let slid = 0;
    return action({
      update: (_, clock) => {
        slid = Math.min(1, slid + clock.delta / seconds);
        magazine.position.y = from + by * way(slid);
      },
      until: () => slid === 1,
    });
  };

  /** `magazine`, in the hand, squared onto `place` in its fingers over `SQUARING` s: the last few degrees and millimetres the arm leaves */
  const square = (magazine: Object3D, place: Object3D) => {
    const parent = magazine.parent;
    if (!parent) throw new Error(`"${magazine.name}" hangs from nothing`);
    const from = magazine.position.clone(), turned = magazine.quaternion.clone(), at = new Vector3(), turn = new Quaternion();
    let squared = 0;
    return action({
      update: (_, clock) => {
        squared = Math.min(1, squared + clock.delta / SQUARING);
        parent.updateWorldMatrix(true, false);
        place.updateWorldMatrix(true, false);
        parent.worldToLocal(place.getWorldPosition(at));
        turn.copy(parent.getWorldQuaternion(new Quaternion()).invert().multiply(place.getWorldQuaternion(new Quaternion())));
        magazine.position.lerpVectors(from, at, smooth(squared));
        magazine.quaternion.slerpQuaternions(turned, turn, smooth(squared));
      },
      until: () => squared === 1,
    });
  };

  const swap = function* (spent: Object3D, full: Object3D) {
    if (!(yield* grab(person, spent, { left: 'base' }, QUICK))) return false;
    onReload?.('out');
    // (pulled straight down out of the well along its line, gathering speed — carried out, it would leave the line still in the well —
    // then flung on out and down, let go of on the way)
    yield* slide(spent, -RIFLE.wellLine, PULL, (share) => share * share);
    const from = spent.getWorldPosition(new Vector3()), to = person.object.localToWorld(FLING.to.clone());
    yield* carry(person, spent, to, { speed: FLING.speed, until: () => spent.getWorldPosition(new Vector3()).distanceTo(from) > FLING.after });
    const { velocity, spin } = release(person, spent);
    magazines.splice(magazines.indexOf(spent), 1);
    litter.drop(spent, velocity, spin);
    if (!(yield* grab(person, full, { left: 'base' }, BRISK))) return false;
    // (brought up under the well and turned as it is, then pushed home up its line in the pinch it came out of the pouch in, and let go
    // there: shifted under its floor plate to drive it home with the palm, the fingers came off its faces and opened; carried in, it
    // came in turned as the hand turned it, slanting against the well, its top corner out through the well's wall, and snapped home in
    // 70 ms)
    if (!(yield* carry(person, full, below, { ...BRISK, until: () => near(full, below, LINED)() && turnedAs(full, below) < ALIGNED }))) return false;
    // (squared onto the line in the fingers, let go there and taken again at once where the hand is, then pushed up the line, the hand
    // going with it)
    yield* square(full, below);
    release(person, full, below);
    if (full.parent !== below) throw new Error(`"${full.name}" was not let go onto "${below.name}"`);
    // (pushed as the hand takes it again: waiting for the grasp to settle held it under the well 0.2 s)
    let taken = true;
    yield* parallel('all', function* () { taken = yield* grab(person, full, { left: 'base' }, QUICK); }, slide(full, RIFLE.wellLine, PUSH, (share) => 1 - (1 - share) ** 2));
    if (!taken) return false;
    release(person, full, well);
    onReload?.('in');
    return true;
  };

  const reload = function* () {
    swapping = true;
    const [pouch] = pouches, spent = magazines.find((magazine) => magazine.parent === well);
    const full = magazines.find((magazine) => magazine.parent === pouch);
    if (!spent || !full) throw new Error('Reload requires an inserted magazine and a spare in the first pouch');
    // (the rifle turning up to the chest with the hand still on its front, the hand leaving it half way)
    yield* wait(() => reloaded > 0.5);
    if (!(yield* swap(spent, full))) throw new Error('The soldier could not swap magazines');
    reloads++;
    // (the support hand back on the receiver while the rifle still rides the chest, as it took it before the reload, then raised with it)
    if (!(yield* grab(person, rifle, { left: 'foregrip' }, QUICK)))
      throw new Error('The support hand could not return to the rifle after reloading');
    issue(pouch);
    swapping = false;
  };

  // The left hand lets go of the rifle's front, the right holding it on, and presses the button's face with its index's pad, `pressed` as
  // it meets it; it holds a moment, draws back off it and goes back to the rifle's front.
  const press = function* (button: Object3D, pressed: () => void) {
    lowering = true;
    if (!(yield* grab(person, button, { left: 'press' }, POKE))) throw new Error(`The soldier could not press "${button.name}"`);
    pressed();
    yield* wait(HELD);
    lowering = false;
    release(person, { left: button });
    if (!(yield* grab(person, rifle, { left: 'foregrip' }, QUICK))) throw new Error('The support hand could not return to the rifle after pressing');
  };

  eye.getWorldPosition(look.eye);
  hold(0);
  const step = runTimeline(() => parallel('all',
    function* () {
      acquired = yield* grab(person, rifle, { right: 'pistol', left: 'foregrip' }, snatch ? SNATCH : {});
      if (!acquired) throw new Error('The soldier could not acquire both rifle grips');
      for (;;) {
        yield* wait(() => reloadWanted || pressWanted !== null);
        if (pressWanted) {
          yield* press(pressWanted.button, pressWanted.pressed);
          pressWanted = null;
          continue;
        }
        reloadWanted = false;
        yield* reload();
      }
    },
    function* () {
      for (;;) {
        yield* lookAt(person, ahead, { trunk: 0.65, until: () => atEase() || swapping });
        yield* wait(() => !atEase() && !swapping);
      }
    },
    action({ update: (_, clock) => frame(clock.delta) }),
  ));

  return {
    person, look, muzzle, eye, rifle,
    acquired: () => acquired,
    reloading,
    aimWeight: () => smooth(aiming),
    reloads: () => reloads,
    requestReload: () => { if (acquired && !swapping && !pressWanted) reloadWanted = true; },
    press: (button: Object3D, pressed: () => void) => { if (acquired && !reloading() && !pressWanted) pressWanted = { button, pressed }; },
    pressing: () => pressWanted !== null,
    lower: (at: boolean) => { low = at; },
    fire: () => {
      // The rifle fires once it has come halfway up from the sprint carry, about 0.13 s after the sprint ends.
      // Held fire keeps its cadence on the shot clock, not the simulation steps the shots land on (1e-9: float steps).
      const next = lastShot + SHOT_INTERVAL;
      if (!acquired || reloading() || pressWanted || sprinted > 0.5 || time < next - 1e-9) return false;
      lastShot = time - next < SHOT_INTERVAL ? next : time;
      motion.fire();
      // 12 N·s keeps sustained 600 rpm fire to a torso sway of about 0.08 rad.
      person.applyImpulse(muzzle.getWorldDirection(new Vector3()).multiplyScalar(-12), person.bones.rightUpperArm.getWorldPosition(new Vector3()));
      return true;
    },
    update: (seconds: number, state: AvatarState) => {
      input = state;
      step(undefined, seconds);
      person.update(seconds);
      see();
    },
    dispose: () => {
      const geometries = new Set<BufferGeometry>();
      for (const object of [rifle, ...magazines]) object.traverse((node) => { if (node instanceof Mesh) geometries.add(node.geometry); });
      for (const geometry of geometries) geometry.dispose();
      disposeWeapon();
      // (a racked rifle hangs from the rack, not the body)
      rifle.removeFromParent();
    },
  };
}

function onBone(person: Body, bone: Object3D, name: string, offset: Vector3): Object3D {
  const placed = new Object3D();
  placed.name = name;
  placed.quaternion.setFromAxisAngle(UP, person.facing);
  placed.position.copy(offset).applyQuaternion(placed.quaternion).add(bone.getWorldPosition(new Vector3()));
  bone.attach(placed);
  return placed;
}

/** whether `thing` has come within `within` (m) of `place` */
const near = (thing: Object3D, place: Object3D, within: number) => () => thing.getWorldPosition(new Vector3()).distanceTo(place.getWorldPosition(new Vector3())) < within;
/** the angle between how `thing` and `place` are turned (rad) */
const turnedAs = (thing: Object3D, place: Object3D) => thing.getWorldQuaternion(new Quaternion()).angleTo(place.getWorldQuaternion(new Quaternion()));
const ease = (weight: number, goal: number, seconds: number, over = EASE) => weight + MathUtils.clamp(goal - weight, -seconds / over, seconds / over);
const smooth = (weight: number) => weight * weight * (3 - 2 * weight);
