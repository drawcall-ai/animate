import { Body, grab, humanoid, lookAt, release, wait, type Floor, type Root, type Species } from '@drawcall/animate';
import { action, parallel, runTimeline } from '@pmndrs/timeline';
import { BufferGeometry, Euler, Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { anglesOf, lookDirection, wrapAngle } from './angles';
import type { Look } from './playback';
import { SOLDIER } from './skeleton';
import { onBone } from './bones';
import { empty, RIFLE, rifleOn } from './weapon/index';
import { Litter } from './weapon/litter';
import { WeaponMotion } from './weapon/motion';
import type { Grenades } from './grenade/index';
import { GrenadeMotion } from './grenade/motion';
import { Press } from './press';
import { Reload } from './reload';

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

/** a hand's finger bones, by name (VRM's) */
const FINGER = /(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/;
const SPRINTING = new Vector3(0.22, 0.2, 0);
/** How the rifle is turned on the shoulder pocket through a reload (the chest's frame): ahead of the chest, up a little and canted 9°
 * toward the support hand — canted 23°, an upright magazine from the pouch had 24° to turn under the well, which the arm took 0.15 s
 * over; at 9°, 13°. */
const RELOADING = new Quaternion().setFromEuler(new Euler(-0.05, 0, 0.15));
/** How far the rifle turns in toward the support side (rad, about its up) as that hand goes back onto its front after a reload, as a
 * soldier brings it in close for the hand. */
const RETURNING = 0.3;
/** The rifle held low at a lift's panel, its muzzle down and a little to the right, clear of the panel (which stands to its left), both
 * hands on it and through a press in the right hand alone: the same turn, so it stays still as the left hand leaves it and takes it again.
 * Turned 0.6 rad right, the support hand's grip was past its arm's reach and the rifle swung toward it as it let go and came back; held
 * there by the support arm, it lay against a panel straight before it. Turned to it over `LOWERING` (s). */
const LOWERED = new Vector3(0.6, -0.1, 0);
const LOWERING = 0.5;
const EASE = 0.25;
/** Where the butt sits off the right shoulder joint (m at the soldier's scale, the chest's frame): 8.5 cm in toward the chest's middle,
 * 2 cm up, 10 cm ahead of it — the receiver's front, where the left hand holds it palm up, near enough for the short-armed soldier's
 * reach (with the butt out at the joint its hand fell 2 cm short) */
const POCKET = new Vector3(0.085, 0.02, 0.1);
/** Seconds between shots. */
const SHOT_INTERVAL = 0.1;
/** Metres ahead of the eye at which a player's barrel line crosses the view. */
const ZERO = 25;
const QUICK = { speed: 1.8 };
/** How fast a fresh body's hands take the rifle it stands up with (m/s): at once, to take over from a pose held elsewhere. */
const SNATCH = { speed: 8 };
const REST_AFTER = 1;
/** How far a shot draws the trigger back (m), through the shot's interval: back all along while held fire keeps firing. */
const SQUEEZE = 0.005;
const UP = new Vector3(0, 1, 0);
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
    private readonly species: Species<string, 'left' | 'right'> = humanoid(SOLDIER),
    private readonly grenades?: Grenades,
  ) {
    this.litter = new Litter(scene);
    this.animation = animate(this.species, model && clone(model), new Vector3(), 0, floor, false, this.litter, onReload, grenades);
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

  get throwing() { return this.animation.throwing(); }
  get grenadePhase() { return this.animation.grenadePhase(); }
  requestGrenade() { return this.animation.requestGrenade(); }
  dropGrenade() { this.animation.dropGrenade(); }

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
    this.show(animate(this.species, this.model && clone(this.model), position, yaw, this.floor, false, this.litter, this.onReload, this.grenades));
  }

  update(dt: number, input: AvatarState) {
    this.animation.update(dt, input);
    this.group.updateMatrixWorld(true);
  }

  /** Starts readying a fresh body off screen, standing at `position` and snatching up the rifle, while this one is still shown. */
  prepare(position: Vector3, yaw: number) {
    this.next?.dispose();
    this.next = animate(this.species, this.model && clone(this.model), position, yaw, this.floor, true, this.litter, this.onReload, this.grenades);
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
    // (its fingers as the body shown had them, the fresh body easing them on from there: shown as its own, they swapped in one frame)
    const fingers = new Map<string, Quaternion>();
    this.animation.person.object.traverse((node) => { if (FINGER.test(node.name)) fingers.set(node.name, node.quaternion); });
    animation.person.object.traverse((node) => { const was = fingers.get(node.name); if (was) node.quaternion.copy(was); });
    this.next?.dispose();
    this.next = undefined;
    this.animation.dispose();
    this.group.clear();
    this.animation = animation;
    this.group.add(animation.person.object);
    this.group.updateMatrixWorld(true);
  }
}

function animate(species: Species<string, 'left' | 'right'>, model: Object3D | undefined, position: Vector3, yaw: number, floor: Floor, snatch: boolean, litter: Litter, onReload?: (phase: 'out' | 'in') => void, grenades?: Grenades) {
  const root: Root & { velocity: Vector3 } = { position: position.clone(), velocity: new Vector3(), yaw, support: position.clone() };
  let aiming = 0;
  // (it checks its motion and says what went wrong, `Body.log`, in the dev server, not in a build or a test that does not ask for it)
  const dev = import.meta.env.MODE === 'development';
  const person = new Body(species, { model, at: position, floor, face: yaw, drive: () => root, life: { steady: () => smooth(aiming) }, dev });
  person.object.traverse((node) => (node.frustumCulled = false));
  const proportions = person.species.person;
  if (!proportions) throw new Error('The shooter requires a humanoid');
  const arms = proportions.arms;
  const eye = onBone(person, person.bones.head, 'right eye', new Vector3(-proportions.head.eye.x, proportions.head.eye.y, proportions.head.eye.z));
  const chest = person.bones.chest;
  // (the butt in the pocket inside the shoulder joint, `POCKET` in from it and up, wherever the skeleton has the joint: a broad
  // shouldered body holds its rifle further out)
  const joint = proportions.offsets.leftShoulder.clone().add(proportions.offsets.leftUpperArm);
  const pocket = onBone(person, chest, 'shoulder pocket', new Vector3(-joint.x, joint.y, 0).addScaledVector(POCKET, proportions.scale));
  const mount = empty(pocket, 'aim', new Vector3());
  const weapon = rifleOn(mount, arms), { rifle, pistol, blade, flash, muzzle, stock } = weapon;
  rifle.position.copy(stock.position).negate();
  const motion = new WeaponMotion();
  const grenade = grenades && new GrenadeMotion(person, onBone(person, chest, 'grenade harness', new Vector3()), grenades);
  // (throwing: from the key press until the rifle is held again; returning: once the grenade has left the hands, taking the rifle back)
  let throwing = false, returning = false, slung = 0;
  const reload = new Reload(person, weapon, litter, onReload), press = new Press(person, rifle);
  let input: AvatarState = { position, velocity: new Vector3(), yaw, pitch: 0, aim: false, sprint: false, crouch: false, support: position.clone(), firstPerson: false };
  const look: Look = { eye: new Vector3(), yaw, pitch: 0, intent: { yaw, pitch: 0 } };
  let logged = 0;
  let time = 0, acquired = false;
  /** standing at a lift's panel: the rifle held low unless it aims */
  let low = false;
  let sprinted = 0, reloaded = 0, returned = 0, lowered = 0, lastShot = -Infinity, stillSince = 0;
  const sprinting = () => input.sprint && !input.aim;
  const atEase = () => time - stillSince > REST_AFTER;
  /** The intended pitch raised by the rifle's recoil. */
  const kicked = () => input.pitch - motion.recoil.position.x * 0.25;
  const view = () => {
    let pitch = kicked(), yaw = input.yaw;
    if (input.aimPoint) ({ yaw, pitch } = anglesOf(input.aimPoint.clone().sub(look.eye)));
    // Sling the rifle in front of the chest even while the camera looks at the ground or sky, or turns ahead of the body.
    const before = smooth(slung);
    pitch *= 1 - before;
    yaw += wrapAngle(person.facing - yaw) * before;
    return new Quaternion().setFromEuler(new Euler(-pitch, yaw, 0, 'YXZ'));
  };
  const ahead = () => new Vector3(0, 0, ZERO).applyQuaternion(view()).add(look.eye);

  const hold = () => {
    if (slung > 0) {
      // Hanging from its shoulder sling, muzzle down across the left side, clear of the grenade at the right chest.
      const hanging = pocket.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().setFromEuler(new Euler(1.25, 0, 0.4)));
      const aimed = view();
      person.orient(mount, aimed.slerp(hanging, smooth(slung)));
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
    const turn = SPRINTING.clone().multiplyScalar(smooth(sprinted)).addScaledVector(LOWERED, smooth(lowered))
      .add(new Vector3(motion.recoil.position.x - 2 * drift.y, 2 * drift.x, -3 * drift.x));
    const turned = aimed.multiply(new Quaternion().setFromEuler(new Euler(turn.x, turn.y, turn.z)));
    // Through the swap the rifle rides the chest as it sways and twists under a running body, turned `RELOADING` on the shoulder pocket
    // whatever the view and however far the trunk has turned from the hips: the well stays before the support hand's shoulder. As that
    // hand goes back onto its front it is turned in toward that side (`RETURNING`): the body keeps it within that arm's reach as it
    // turns, and it eases out to the aim from there as the reload ends.
    turned.slerp(pocket.getWorldQuaternion(new Quaternion()).multiply(RELOADING), smooth(reloaded));
    if (returned > 0) turned.multiply(new Quaternion().setFromAxisAngle(UP, RETURNING * smooth(returned)));
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
    if (!acquired || input.aim || reload.swapping || throwing || root.velocity.length() > 0.05 || turning > 0.5 || time - lastShot < 1) stillSince = time;
    slung = ease(slung, Number(throwing && !returning), seconds, 0.35);
    aiming = ease(aiming, Number(input.aim && !throwing), seconds);
    sprinted = ease(sprinted, Number(sprinting()), seconds);
    reloaded = ease(reloaded, Number(reload.swapping), seconds);
    returned = ease(returned, Number(reload.swapping && !reload.riding), seconds);
    lowered = ease(lowered, Number(press.lowering || (low && acquired && !input.aim)), seconds, LOWERING);
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
    pistol.userData.digits = { index: input.aim || time - lastShot < 0.5 ? 'trigger' : 'frame' };
    blade.position.z = time - lastShot < SHOT_INTERVAL ? -SQUEEZE : 0;
    hold();
  };

  eye.getWorldPosition(look.eye);
  hold();
  const step = runTimeline(() => parallel('all',
    function* () {
      acquired = yield* grab(person, rifle, { right: 'pistol', left: 'foregrip' }, snatch ? SNATCH : {});
      for (;;) {
        yield* wait(() => reload.wanted || press.wanted !== null || throwing);
        if (throwing && grenade) {
          yield* wait(() => slung === 1);
          release(person, rifle);
          yield* grenade.throw(() => lookDirection(input.yaw, input.pitch), () => look.eye.clone(), () => input.velocity);
          returning = true;
          yield* grab(person, rifle, { right: 'pistol', left: 'foregrip' }, QUICK);
          throwing = returning = false;
          continue;
        }
        if (press.wanted) {
          yield* press.run();
          continue;
        }
        yield* reload.run(() => reloaded > 0.5);
      }
    },
    function* () {
      for (;;) {
        yield* lookAt(person, ahead, { trunk: 0.65, until: () => atEase() || reload.swapping });
        yield* wait(() => !atEase() && !reload.swapping);
      }
    },
    action({ update: (_, clock) => frame(clock.delta) }),
  ));

  /** whether the hands are free for a new task: on the rifle, neither reloading, pressing a button nor throwing */
  const free = () => acquired && !reload.reloading && !press.wanted && !throwing;
  return {
    person, look, muzzle, eye, rifle,
    acquired: () => acquired,
    reloading: () => reload.reloading,
    throwing: () => throwing,
    grenadePhase: () => !throwing ? '' : returning ? 'Returning to rifle' : grenade?.phase ?? 'Lowering rifle',
    dropGrenade: () => grenade?.interrupt(look.eye),
    requestGrenade: () => {
      if (!grenade || !grenades?.count || !free()) return false;
      throwing = true;
      return true;
    },
    aimWeight: () => smooth(aiming),
    reloads: () => reload.count,
    requestReload: () => { if (free()) reload.wanted = true; },
    press: (button: Object3D, pressed: () => void) => { if (free()) press.wanted = { button, pressed }; },
    pressing: () => press.wanted !== null,
    lower: (at: boolean) => { low = at; },
    fire: () => {
      // The rifle fires once it has come halfway up from the sprint carry, about 0.13 s after the sprint ends.
      // Held fire keeps its cadence on the shot clock, not the simulation steps the shots land on (1e-9: float steps).
      const next = lastShot + SHOT_INTERVAL;
      if (!free() || sprinted > 0.5 || time < next - 1e-9) return false;
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
      // (what development finds wrong with the motion, each once, in the dev server's console)
      for (const entry of person.log.slice(logged)) console.warn('animate:', entry);
      logged = person.log.length;
      see();
    },
    dispose: () => {
      grenade?.dispose();
      const geometries = new Set<BufferGeometry>();
      for (const object of [rifle, ...reload.magazines]) object.traverse((node) => { if (node instanceof Mesh) geometries.add(node.geometry); });
      for (const geometry of geometries) geometry.dispose();
      weapon.dispose();
      // (a racked rifle hangs from the rack, not the body)
      rifle.removeFromParent();
    },
  };
}

const ease = (weight: number, goal: number, seconds: number, over = EASE) => weight + MathUtils.clamp(goal - weight, -seconds / over, seconds / over);
const smooth = (weight: number) => weight * weight * (3 - 2 * weight);
