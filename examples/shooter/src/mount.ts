import { MathUtils, Matrix4, Vector3, type Object3D } from 'three';
import type { PhysicsWorld } from '@drawcall/physics';
import { anglesOf, wrapAngle, yawOf } from './angles';
import { stand, type Cue, type Standing } from './choreography';
import { HEIGHT, RADIUS } from './movement';
import type { Look } from './playback';
import { Puppet } from './puppet';
import type { Soldier } from './soldier';

/** How far from a spot to get on (m) the soldier may be to set off for it, and how long (s) it may walk toward it before giving up. */
const REACH = 2.2;
const APPROACH = 4;
/** Arriving at the spot: slowing within `slow` (m), there within `distance` (m), facing its way within `heading` (rad) and near still
 * (m/s). */
const ARRIVAL = { slow: 0.25, distance: 0.08, heading: 0.05, speed: 0.2 };
/** How fast the soldier turns to face the spot's way as it walks there (1/s). */
const SQUARING = 8;
/** How far above a spot (m) a soldier getting off is stood, to settle onto the ground: a capsule placed touching it cannot grow to its
 * standing height. */
const ALIGHT = 0.04;
/** How many of its own steps the fresh body to get off onto is readied by each world step, off screen: a few steps' delay rather than one
 * long frame. */
const READYING = 12;
/** How far the mounted soldier may look off the way it faces (rad), turning its head and shoulders. */
export const LOOK = 1.7;
const UP = new Vector3(0, 1, 0), FORWARD = new Vector3(0, 0, 1);

/** Where the rifle is put: its parent, and its matrix there. */
interface Place { parent: Object3D; matrix: Matrix4 }

type State = 'off' | 'approaching' | 'mounting' | 'on' | 'dismounting';

/**
 * Something a soldier gets on, is posed on and gets off, such as a rover's seat or a ladder. It walks to a spot beside it (an empty
 * facing the way the soldier stands there) and, there with its rifle in both hands, is held there without stopping: @drawcall/animate's
 * body is no longer updated and a `Puppet` poses its bones, `progress` of the way from standing at the spot (0) to on (1). Getting off at
 * a spot readies a fresh library body there off screen, still posed on until it holds its rifle, and plays that backward onto its pose.
 * The rifle rides the right hand until `take` and is stowed beyond it. Each part's sounds play as its move ends, getting on or off.
 */
export abstract class Mount {
  /** Where the player looks while on: yaw off the way it faces, and pitch (rad). */
  protected readonly view = { yaw: 0, pitch: 0 };
  /** 0 standing at the spot … 1 on. */
  protected progress = 0;
  /** where it gets on or off */
  protected spot: Object3D | undefined;
  private current: State = 'off';
  /** Seconds spent walking to the spot. */
  private walked = 0;
  /** the way it faced when the view last turned with it */
  private faced = 0;
  private puppet: Puppet | undefined;
  private standing: Standing | undefined;
  /** how high its hips stood above its feet (m) */
  private stature = 0;
  /** where the rifle belongs on the standing body, to give it back to once off */
  private home: Place | undefined;
  /** Getting off, whether the fresh body to get off onto is still being readied. */
  private readying = false;

  constructor(
    protected readonly soldier: Soldier, private readonly world: PhysicsWorld, private readonly model: Object3D | undefined,
    /** seconds to get on (and off), and the progress at which the right hand lets go of the rifle (or takes it back) */
    private readonly timing: { seconds: number; take: number },
  ) {}

  get state(): State { return this.current; }
  /** Whether the body is on, getting on or getting off: posed here, not by the library. */
  get posed() { return this.current === 'mounting' || this.current === 'on' || this.current === 'dismounting'; }
  /** Whether the soldier stands near enough a spot to get on. */
  get near() { return this.current === 'off' && this.soldier.alive && this.nearest() !== undefined; }
  /** The ground under the mounted soldier's hips. */
  get position() { return this.mounted().puppet.position('hips').addScaledVector(UP, -this.stature); }

  /** Gives up walking to the spot, or else sets off for one: what the one key to use it does. */
  use() {
    if (this.current === 'approaching') this.cancel();
    else this.mount();
  }

  /** Sets off for the nearest spot to get on from. */
  mount() {
    const spot = this.nearest();
    if (this.current !== 'off' || !this.soldier.alive || !spot) return;
    this.spot = spot;
    this.current = 'approaching';
    this.walked = 0;
  }

  /** Gives up walking to the spot. */
  cancel() {
    if (this.current !== 'approaching') return;
    this.soldier.movement.input.move.set(0, 0, 0);
    this.current = 'off';
  }

  /** Takes the player's view, turns it with what the soldier is on, keeps it to what the soldier can turn to and returns the yaw it kept. */
  aim(yaw: number, pitch: number): number {
    const facing = this.facing();
    this.view.yaw = MathUtils.clamp(wrapAngle(yaw + wrapAngle(facing - this.faced) - facing), -LOOK, LOOK);
    this.view.pitch = pitch;
    this.faced = facing;
    return facing + this.view.yaw;
  }

  reset() {
    this.current = 'off';
    this.progress = 0;
    this.readying = false;
    this.spot = this.puppet = this.standing = this.home = undefined;
    this.view.yaw = this.view.pitch = 0;
  }

  /** Steps it; true while it poses the body itself, so the soldier's own update stands aside. */
  update(dt: number): boolean {
    const was = this.progress, by = dt / this.timing.seconds;
    if (this.current === 'approaching') this.approach(dt);
    else if (this.current === 'mounting') {
      this.progress = Math.min(1, was + by);
      if (this.progress === 1) this.current = 'on';
    } else if (this.current === 'dismounting' && this.readying) {
      // (posed on until the fresh body holds its rifle)
      if (this.soldier.ready(READYING)) {
        this.readying = false;
        this.hold();
      }
    } else if (this.current === 'dismounting') this.progress = Math.max(0, was - by);
    this.cue(was, this.progress);
    if (this.current === 'dismounting' && this.progress === 0) {
      this.rehome();
      this.reset();
      return false;
    }
    if (!this.posed) return false;
    const { puppet, standing } = this.mounted();
    this.pose(puppet, standing, dt);
    this.stow(puppet);
    return true;
  }

  /** What the mounted soldier sees: from its eye, along its head. */
  look(): Look {
    const { yaw, pitch } = anglesOf(FORWARD.clone().applyQuaternion(this.mounted().puppet.rotation('head')));
    return { eye: this.soldier.avatar.eye.getWorldPosition(new Vector3()), yaw, pitch, intent: { yaw, pitch } };
  }

  /** Gets off at `spot`: readies a fresh body standing there with its rifle in its hands, to end on, the rifle stowed until the hand takes
   * it. */
  protected dismount(spot: Object3D) {
    this.spot = spot;
    this.soldier.prepare(spot.getWorldPosition(new Vector3()).addScaledVector(UP, ALIGHT), yawOf(spot));
    this.readying = true;
    this.current = 'dismounting';
  }

  /** Whether a standing soldier's capsule fits at `spot`. */
  protected fits(spot: Object3D) {
    const center = spot.getWorldPosition(new Vector3()).addScaledVector(UP, ALIGHT + HEIGHT / 2);
    const shape = { radius: RADIUS, height: HEIGHT - 2 * RADIUS };
    return this.world.capsuleContacts(shape, new Matrix4().makeTranslation(center), 0).length === 0;
  }

  /** The spots it may be got on from. */
  protected abstract spots(): readonly Object3D[];
  /** What it is posed in the frame of. */
  protected abstract frame(): Object3D;
  /** Which way the mounted soldier faces (yaw, rad), for the view to turn with. */
  protected abstract facing(): number;
  /** Poses the body at `progress`, `dt` s on, from `standing` at the spot. */
  protected abstract pose(puppet: Puppet, standing: Standing, dt: number): void;
  /** What is heard as each part's move ends. */
  protected abstract cues(): readonly Cue[];
  /** Where the rifle is stowed once the hand has let go of it. */
  protected abstract stowage(puppet: Puppet): Place;

  private nearest() {
    const at = this.soldier.movement.position;
    const distance = (spot: Object3D) => spot.getWorldPosition(new Vector3()).distanceTo(at);
    const near = this.spots().filter((spot) => distance(spot) < REACH);
    return near.sort((a, b) => distance(a) - distance(b))[0];
  }

  /** Walks to the spot turning to face its way, giving up if it does not get there in time; there, gets on once both hands have the rifle
   * (a reload finishes first), a foot still stepping coming down onto its squared stance as it steps in. */
  private approach(dt: number) {
    const { movement, avatar } = this.soldier, input = movement.input, spot = this.spot;
    if (!spot) throw new Error('Approaching no spot');
    const to = spot.getWorldPosition(new Vector3()).sub(movement.position).setY(0), yaw = yawOf(spot);
    input.move.copy(to).clampLength(0, 1).multiplyScalar(Math.min(1, to.length() / ARRIVAL.slow));
    input.yaw += wrapAngle(yaw - input.yaw) * (1 - Math.exp(-SQUARING * dt));
    input.sprint = input.aim = input.crouch = input.jump = false;
    if (to.length() > ARRIVAL.distance || Math.abs(wrapAngle(yaw - input.yaw)) > ARRIVAL.heading || movement.speed > ARRIVAL.speed) {
      if ((this.walked += dt) > APPROACH) this.cancel();
      return;
    }
    input.move.set(0, 0, 0);
    // (straight on from the walk, a foot still stepping comes down as it steps in)
    if (!avatar.acquired || avatar.reloading || avatar.throwing || avatar.pressing) return;
    movement.stop();
    this.hold();
    this.current = 'mounting';
  }

  /** Holds the library's body as it stands, to pose it from here, and takes that pose to get on from or off onto. */
  private hold() {
    const puppet = new Puppet(this.soldier.avatar.body, this.model), rifle = this.soldier.avatar.rifle;
    if (!rifle.parent) throw new Error('The rifle is not on the soldier');
    this.home = { parent: rifle.parent, matrix: rifle.matrix.clone() };
    this.standing = stand(puppet, this.frame(), rifle);
    this.stature = puppet.position('hips').y - this.soldier.movement.position.y;
    this.puppet = puppet;
    this.faced = this.facing();
  }

  /** Plays the sounds of the parts whose moves ended as progress went from `from` to `to`: getting on, at their beats' ends; getting off,
   * at their starts. */
  private cue(from: number, to: number) {
    for (const { beat, on, off } of this.cues()) {
      const effect = to > from ? beat[1] > from && beat[1] <= to && on : beat[0] < from && beat[0] >= to && off;
      if (effect) this.soldier.sound(...effect);
    }
  }

  /** Before `take` the rifle rides the right hand; after it, it is stowed. */
  private stow(puppet: Puppet) {
    const rifle = this.soldier.avatar.rifle, hand = this.soldier.avatar.body.bones.rightHand;
    if (this.progress < this.timing.take) {
      if (rifle.parent === hand) return;
      hand.updateWorldMatrix(true, false);
      hand.attach(rifle);
      return;
    }
    const { parent, matrix } = this.stowage(puppet);
    if (rifle.parent === parent) return;
    parent.add(rifle);
    matrix.decompose(rifle.position, rifle.quaternion, rifle.scale);
  }

  /** Gives the rifle back to the standing body, where it held it. */
  private rehome() {
    const rifle = this.soldier.avatar.rifle, home = this.home;
    if (!home) throw new Error('Got off without the rifle');
    home.parent.add(rifle);
    home.matrix.decompose(rifle.position, rifle.quaternion, rifle.scale);
  }

  private mounted() {
    if (!this.puppet || !this.standing) throw new Error('Only a mounted soldier is posed');
    return { puppet: this.puppet, standing: this.standing };
  }
}
