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
const RELOADING = new Vector3(-0.05, 0, 0.4);
/** The rifle held low, its muzzle down and off to the right, clear of a lift's panel: in the right hand alone while the left presses its
 * button; standing at one, both hands on it, `LOW` of the way. It comes up as the left hand draws back from a button to take it again
 * (taken held low, it took seconds to settle on its front). */
const LOWERED = new Vector3(0.75, -0.35, 0);
const LOW = 0.5;
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
/** How long a pressing pad stays on its button (s). */
const HELD = 0.5;
/** How fast a hand goes a hand's breadth (m/s): off the rifle's front to the magazine under it, and back. Briskly, a short move still
 * took 0.2 s, most of it in a tenth, and read as a snap; at this it takes 0.3 s. */
const SHORT = { speed: 0.7 };
/** How fast a fresh body's hands take the rifle it stands up with (m/s): at once, to take over from a pose held elsewhere. */
const SNATCH = { speed: 8 };
const REST_AFTER = 1;
/** How far a shot draws the trigger back (m), through the shot's interval: back all along while held fire keeps firing. */
const SQUEEZE = 0.005;
/** The chest pouches' magazines, side by side on the left of the chest with a hand's room between them: the left hand takes the inner one
 * round its body as it will seat it in the well, and a fresh one is in that pouch again once the hand is back on the rifle; the outer one
 * is a spare's spare. The inner one 5 cm off the middle: nearer, the left hand reached it with its wrist bent back across the sternum, its
 * fingers off the body. */
const POUCHES = [new Vector3(0.07, -0.17, 0.2), new Vector3(0.21, -0.17, 0.2)];
/** How each pouch turns its magazine about the vertical (rad): standing out from the chest, its front forward and turned in toward the
 * body's middle, its faces to the sides. Turned flat against the chest (−π/2, its front toward the middle), the arm held the grasp it took
 * there strained in the well, and the hand regripped it in its fingers on the way up, the magazine sliding up through a still hand;
 * turned −1 rad, it still did. */
const POUCHED = -Math.PI / 6;
/** Where the left hand flings a spent magazine, out from the left hip and forward (the chest's frame as `POUCHES`), letting go of it on the
 * way once it is `TOSS` (m) clear of the well: it falls from there at the hand's speed. The fling is a point, the magazine kept turned as
 * it left the well, so the hand keeps its grasp on it: turned on the way, the hand turned it in its fingers onto its palm, held like a
 * tray. */
const FLING = new Vector3(0.36, -0.36, 0.3);
const TOSS = 0.2;
const UP = new Vector3(0, 1, 0);
/** How near a carried magazine comes to its place before it is let go onto it there (m), within the 5 mm a release sets a thing exactly:
 * the release reads it a moment on, and one let go 4 mm short, still moving, was 5–11 mm off then, left askew in the well. */
const ONTO = 0.002;

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
  const { rifle, pistol, blade, well, below, partWay, flash, muzzle, stock, magazineIn, dispose: disposeWeapon } = rifleOn(mount, arms);
  rifle.position.copy(stock.position).negate();
  const motion = new WeaponMotion();
  const pouches = POUCHES.map((at, i) => {
    const pouch = onBone(person, chest, `pouch ${i + 1}`, at.clone().multiply(new Vector3(arms, arms, proportions.scale)));
    pouch.rotateY(POUCHED);
    empty(pouch, `over pouch ${i + 1}`, new Vector3(0, 0.1 * proportions.scale, 0));
    pouch.userData.approach = [`over pouch ${i + 1}`];
    return pouch;
  });
  const fling = onBone(person, chest, 'fling', FLING.clone().multiply(new Vector3(arms, arms, proportions.scale)));
  /** the magazines on it, each named by when it was issued: the one in the well and one in each pouch at first */
  const magazines: Object3D[] = [];
  let issued = 0;
  const issue = (place: Object3D) => magazines.push(magazineIn(place, `magazine ${++issued}`));
  for (const place of [well, ...pouches]) issue(place);
  /** the magazine the hand is throwing away, where and how it was turned last update (world), and how fast it went (m/s) and turned (rad/s
   * about the world's axes) */
  const thrown: { object: Object3D | null; at: Vector3; turn: Quaternion; velocity: Vector3; spin: Vector3 } =
    { object: null, at: new Vector3(), turn: new Quaternion(), velocity: new Vector3(), spin: new Vector3() };
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
    lowered = ease(lowered, lowering ? 1 : low && acquired && !pressWanted && !input.aim ? LOW : 0, seconds);
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

  // The left hand takes the spent magazine round its body in the well, pulls it down out of it and flings it away out by the hip, letting
  // go on the way (the release has nowhere to put it: the litter takes it from the well, where it would go, and lets it fly on as the hand
  // last moved and turned it), then takes the full one from its pouch, brings it up under the well and pushes it part way in, shifts under
  // its floor plate and pushes it home with the palm.
  const swap = function* (spent: Object3D, full: Object3D) {
    if (!(yield* grab(person, spent, { left: 'base' }, SHORT))) return false;
    onReload?.('out');
    const clear = () => spent.getWorldPosition(new Vector3()).distanceTo(well.getWorldPosition(new Vector3())) > TOSS;
    thrown.object = spent;
    spent.getWorldPosition(thrown.at);
    spent.getWorldQuaternion(thrown.turn);
    yield* carry(person, spent, [below, () => fling.getWorldPosition(new Vector3())], { ...QUICK, until: clear });
    if (!clear()) return false;
    release(person, spent);
    magazines.splice(magazines.indexOf(spent), 1);
    litter.drop(spent, thrown.velocity, thrown.spin);
    thrown.object = null;
    if (!(yield* grab(person, full, { left: 'base' }, QUICK))) return false;
    // (brought up under the well and in from there along its line; pushed home by the palm under the floor plate, a carry of its own, quick
    // off the mark, rather than the last 0.1 s of the carry up, where it dipped under the mouth and shot up 14 cm)
    if (!(yield* carry(person, full, [below, partWay], { ...QUICK, until: near(full, partWay) }))) return false;
    release(person, full, partWay);
    if (!(yield* grab(person, full, { left: 'floor' }, QUICK))) return false;
    if (!(yield* carry(person, full, well, { ...QUICK, until: near(full, well) }))) return false;
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
    if (!(yield* grab(person, rifle, { left: 'foregrip' }, SHORT)))
      throw new Error('The support hand could not return to the rifle after reloading');
    issue(pouch);
    swapping = false;
  };

  // The left hand lets go of the rifle's front, the right holding it on, and presses the button's face with its index's pad, `pressed` as
  // it meets it; it holds a moment, draws back off it and takes the rifle again.
  const press = function* (button: Object3D, pressed: () => void) {
    lowering = true;
    if (!(yield* grab(person, button, { left: 'press' }, { step: false }))) throw new Error(`The soldier could not press "${button.name}"`);
    pressed();
    yield* wait(HELD);
    lowering = false;
    release(person, { left: button });
    if (!(yield* grab(person, rifle, { left: 'foregrip' }))) throw new Error('The support hand could not return to the rifle after pressing');
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
      if (thrown.object) {
        const at = thrown.object.getWorldPosition(new Vector3()), turn = thrown.object.getWorldQuaternion(new Quaternion());
        thrown.velocity.subVectors(at, thrown.at).divideScalar(seconds);
        spinOf(thrown.turn, turn, seconds, thrown.spin);
        thrown.at.copy(at);
        thrown.turn.copy(turn);
      }
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

/** how fast (rad/s, about the world's axes) a thing turned `from` → `to` in `seconds` (into `out`): its axis scaled by its rate */
function spinOf(from: Quaternion, to: Quaternion, seconds: number, out: Vector3): Vector3 {
  const step = to.clone().multiply(from.clone().invert());
  if (step.w < 0) step.set(-step.x, -step.y, -step.z, -step.w);
  const angle = 2 * Math.acos(Math.min(1, step.w)), sine = Math.sqrt(1 - step.w * step.w);
  return sine < 1e-9 ? out.set(0, 0, 0) : out.set(step.x, step.y, step.z).multiplyScalar(angle / sine / seconds);
}

/** Whether `thing` has come within `ONTO` of `place`: near enough to be let go onto it there, the rest of a carry's slow end left out. */
const near = (thing: Object3D, place: Object3D) => () => thing.getWorldPosition(new Vector3()).distanceTo(place.getWorldPosition(new Vector3())) < ONTO;
const ease = (weight: number, goal: number, seconds: number) => weight + MathUtils.clamp(goal - weight, -seconds / EASE, seconds / EASE);
const smooth = (weight: number) => weight * weight * (3 - 2 * weight);
