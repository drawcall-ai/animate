import { Body, carry, grab, humanoid, lookAt, release, wait, type Floor, type Root } from '@drawcall/animate';
import { action, parallel, runTimeline } from '@pmndrs/timeline';
import { BufferGeometry, Euler, Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { anglesOf, wrapAngle } from './angles';
import type { Look } from './playback';
import { SOLDIER } from './skeleton';
import { empty, RIFLE, rifleOn } from './weapon';
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
const RELOADING = new Vector3(-0.05, 0, 0.4);
const EASE = 0.25;
/** Seconds between shots. */
const SHOT_INTERVAL = 0.1;
/** Metres ahead of the eye at which a player's barrel line crosses the view. */
const ZERO = 25;
/** Radians the rifle points at most to either side of the chest, as far as both arms hold it; past that it waits for the body to turn. */
const REACH = 0.35;
/** Radians a second the arms turn the rifle at most, closing on where it should point without passing it. */
const SWING = 12;
const QUICK = { speed: 1.8 };
/** How fast a fresh body's hands take the rifle it stands up with (m/s): at once, to take over from a pose held elsewhere. */
const SNATCH = { speed: 8 };
const REST_AFTER = 1;
/** How far a shot draws the trigger back (m), through the shot's interval: back all along while held fire keeps firing. */
const SQUEEZE = 0.004;
const POUCHES = [new Vector3(0.06, -0.17, 0.2), new Vector3(0.13, -0.17, 0.2)];
const UP = new Vector3(0, 1, 0);

/** The soldier's story: a shouldered rifle, aim, recoil and magazine swaps, with its root supplied by the capsule controller. */
export class Avatar {
  readonly group = new Group();
  private animation;
  /** a fresh body being readied off screen, to show in place of this one */
  private next: ReturnType<typeof animate> | undefined;

  constructor(
    scene: Object3D, private readonly model?: Object3D,
    private readonly floor: Floor = () => 0,
    private readonly onReload?: (phase: 'out' | 'in') => void,
  ) {
    this.animation = animate(model && clone(model), new Vector3(), 0, floor, false, onReload);
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
  fire(): boolean { return this.animation.fire(); }

  /** Starts afresh standing at `position`, the rifle on its shoulder for the hands to take. */
  reset(position: Vector3, yaw = 0) {
    this.show(animate(this.model && clone(this.model), position, yaw, this.floor, false, this.onReload));
  }

  update(dt: number, input: AvatarState) {
    this.animation.update(dt, input);
    this.group.updateMatrixWorld(true);
  }

  /** Starts readying a fresh body off screen, standing at `position` and snatching up the rifle, while this one is still shown. */
  prepare(position: Vector3, yaw: number) {
    this.next?.dispose();
    this.next = animate(this.model && clone(this.model), position, yaw, this.floor, true, this.onReload);
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

function animate(model: Object3D | undefined, position: Vector3, yaw: number, floor: Floor, snatch: boolean, onReload?: (phase: 'out' | 'in') => void) {
  const root: Root & { velocity: Vector3 } = { position: position.clone(), velocity: new Vector3(), yaw, support: position.clone() };
  let aiming = 0;
  const person = new Body(humanoid(SOLDIER), { model, at: position, floor, face: yaw, drive: () => root, life: { steady: () => smooth(aiming) } });
  person.object.traverse((node) => (node.frustumCulled = false));
  const proportions = person.species.person;
  if (!proportions) throw new Error('The shooter requires a humanoid');
  const arms = proportions.arms;
  const eye = onBone(person, person.bones.head, 'right eye', new Vector3(-proportions.head.eye.x, proportions.head.eye.y, proportions.head.eye.z));
  const chest = person.bones.chest;
  const pocket = onBone(person, chest, 'shoulder pocket', new Vector3(-0.145, 0.19, 0.1).multiplyScalar(proportions.scale));
  const mount = empty(pocket, 'aim', new Vector3());
  const { rifle, pistol, blade, well, flash, muzzle, stock, magazineIn, dispose: disposeWeapon } = rifleOn(mount, arms);
  rifle.position.copy(stock.position).negate();
  const motion = new WeaponMotion();
  const pouches = POUCHES.map((at, i) => {
    const pouch = onBone(person, chest, `pouch ${i + 1}`, at.clone().multiply(new Vector3(arms, arms, proportions.scale)));
    empty(pouch, `over pouch ${i + 1}`, new Vector3(0, 0.1 * proportions.scale, 0));
    pouch.userData.approach = [`over pouch ${i + 1}`];
    return pouch;
  });
  const magazines = [magazineIn(well, 'magazine 1'), magazineIn(pouches[0], 'magazine 2')];
  let input: AvatarState = { position, velocity: new Vector3(), yaw, pitch: 0, aim: false, sprint: false, crouch: false, support: position.clone(), firstPerson: false };
  const look: Look = { eye: new Vector3(), yaw, pitch: 0, intent: { yaw, pitch: 0 } };
  let time = 0, acquired = false, swapping = false, reloadWanted = false, reloads = 0;
  let sprinted = 0, reloaded = 0, lastShot = -Infinity, stillSince = 0;
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
  /** How far the rifle's aim leads the chest (rad), kept on the side the view went round when it passes behind the body. */
  let lead = 0;
  /** The rifle's world yaw from the hip (rad), as the arms have turned it. */
  let heading = yaw;
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
    // From the hip the rifle points as far as both arms hold it from the chest; past that, on a flick the body cannot keep up with,
    // it waits for the body to turn rather than being torn from the hands. It turns no faster than the arms swing it, closing on that
    // aim without passing it.
    // Down the sights the camera looks along it, so it follows the view.
    const chestYaw = anglesOf(pocket.getWorldDirection(new Vector3())).yaw;
    const toward = wrapAngle(pointed.yaw - chestYaw);
    lead = Math.abs(toward) <= REACH ? toward : lead + wrapAngle(toward - lead);
    const wanted = chestYaw + MathUtils.clamp(lead, -REACH, REACH), most = SWING * seconds;
    heading += MathUtils.clamp(wrapAngle(wanted - heading), -most, most);
    heading = chestYaw + MathUtils.clamp(wrapAngle(heading - chestYaw), -REACH, REACH);
    const aimed = new Quaternion().setFromEuler(new Euler(-pitch, heading + wrapAngle(pointed.yaw - heading) * smooth(aiming), 0, 'YXZ'));
    const turn = SPRINTING.clone().multiplyScalar(smooth(sprinted)).addScaledVector(RELOADING, smooth(reloaded))
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
    motion.update(seconds, chest.getWorldPosition(new Vector3()).sub(root.position));
    root.position.copy(input.position);
    root.velocity.copy(input.velocity);
    root.support = input.support;
    root.platform = input.platform;
    root.yaw += wrapAngle(input.yaw - root.yaw) * (1 - Math.exp(-seconds / 0.025));
    root.crouch = input.crouch && !sprinting() ? 1 : 0.6 * (input.takeoff ?? 0);
    flash.visible = time - lastShot < 0.06;
    // The trigger finger lies straight outside the guard until the rifle is asked up or fires, then rests on the trigger, squeezing it back
    // for a shot; the thumb folds down along the receiver's side above it.
    pistol.userData.fingers = { index: input.aim || time - lastShot < 0.5 ? 'trigger' : 'frame', thumb: { curl: 1, oppose: 0 } };
    blade.position.z = time - lastShot < SHOT_INTERVAL ? -SQUEEZE : 0;
    hold(seconds);
  };

  const swap = function* (spent: Object3D, full: Object3D, free: Object3D) {
    if (!(yield* grab(person, spent, { left: 'base' }, QUICK))) return false;
    onReload?.('out');
    if (!(yield* carry(person, spent, free, QUICK))) return false;
    release(person, spent, free);
    if (!(yield* grab(person, full, { left: 'base' }, QUICK))) return false;
    if (!(yield* carry(person, full, well, QUICK))) return false;
    release(person, full, well);
    onReload?.('in');
    return true;
  };

  const reload = function* () {
    swapping = true;
    const spent = magazines.find((magazine) => magazine.parent === well);
    const full = magazines.find((magazine) => magazine !== spent);
    if (!spent || !full || !full.parent) throw new Error('Reload requires an inserted magazine and a spare');
    const free = pouches.find((pouch) => pouch !== full.parent);
    if (!free) throw new Error('Reload requires a free magazine pouch');
    if (!(yield* swap(spent, full, free))) throw new Error('The soldier could not swap magazines');
    reloads++;
    swapping = false;
    if (!(yield* grab(person, rifle, { left: 'foregrip' })))
      throw new Error('The support hand could not return to the rifle after reloading');
  };

  eye.getWorldPosition(look.eye);
  hold(0);
  const step = runTimeline(() => parallel('all',
    function* () {
      acquired = yield* grab(person, rifle, { right: 'pistol', left: 'foregrip' }, snatch ? SNATCH : {});
      if (!acquired) throw new Error('The soldier could not acquire both rifle grips');
      for (;;) {
        yield* wait(() => reloadWanted);
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
    requestReload: () => { if (acquired && !swapping) reloadWanted = true; },
    fire: () => {
      // The rifle fires once it has come halfway up from the sprint carry, about 0.13 s after the sprint ends.
      // Held fire keeps its cadence on the shot clock, not the simulation steps the shots land on (1e-9: float steps).
      const next = lastShot + SHOT_INTERVAL;
      if (!acquired || reloading() || sprinted > 0.5 || time < next - 1e-9) return false;
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

const ease = (weight: number, goal: number, seconds: number) => weight + MathUtils.clamp(goal - weight, -seconds / EASE, seconds / EASE);
const smooth = (weight: number) => weight * weight * (3 - 2 * weight);
