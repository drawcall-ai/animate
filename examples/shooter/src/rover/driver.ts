import { MathUtils, Matrix4, type Object3D } from 'three';
import type { PhysicsWorld } from '@drawcall/physics';
import type { Standing } from '../choreography';
import { LOOK, Mount } from '../mount';
import type { Puppet } from '../puppet';
import type { Soldier } from '../soldier';
import type { Handling } from './handling';
import type { Rover } from './model';
import { BEATS, CUES, seat } from './seating';

/** Seconds to get from standing at the doorway to seated with both hands on the wheel, and back out. */
const SEATING = 1.6;
/** The fastest the rover may still be rolling (m/s) for the driver to get out. */
const STOPPED = 0.6;
/** How far the driver's head leads into a turn per radian of lock. */
const LEAD = 1.2;

/**
 * A soldier driving the rover. It walks to the doorway; stepping up to the sill it puts its rifle in the rack by the windscreen pillar,
 * leans on the dash and takes the pillar's handle, steps in with its inboard (left) foot, swings its hips round onto the seat and brings
 * its right foot onto the accelerator and its hands onto the wheel; it drives turning the wheel with both hands, its head looking where
 * the rover goes. Getting out is the same reversed, taking the rifle from the rack on the way. It starts the engine getting in and stops
 * it getting out.
 */
export class Driver extends Mount {
  constructor(soldier: Soldier, private readonly rover: Rover, private readonly handling: Handling, world: PhysicsWorld, model?: Object3D) {
    super(soldier, world, model, { seconds: SEATING, take: BEATS.take });
  }

  /** Whether the driver may get out: stopped, with the doorway clear to stand in. */
  get canExit() { return this.stopped && this.fits(this.rover.marks.door); }
  /** Whether the driver has stopped but something stands in the doorway. */
  get blocked() { return this.stopped && !this.fits(this.rover.marks.door); }
  private get stopped() { return this.state === 'on' && Math.abs(this.handling.speed) <= STOPPED; }

  /** Turns the key on the way to the wheel. */
  override update(dt: number) {
    if (this.state === 'mounting' && this.progress >= BEATS.key) this.handling.engine.start();
    return super.update(dt);
  }

  /** Off the seat (got out, or killed at the wheel), the engine is stopped. */
  override reset() {
    super.reset();
    this.handling.engine.stop();
  }

  /** Seated, gets out. */
  override use() {
    if (this.state === 'on') this.exit();
    else super.use();
  }

  /** Turns the key off and gets out, if it may. */
  exit() {
    if (!this.canExit) return;
    this.handling.engine.stop();
    this.dismount(this.rover.marks.door);
  }

  protected spots() { return [this.rover.marks.door]; }
  protected frame() { return this.rover.body; }
  protected facing() { return this.handling.yaw; }

  protected pose(puppet: Puppet, standing: Standing, dt: number) {
    const yaw = MathUtils.clamp(this.view.yaw + this.handling.lock * LEAD, -LOOK, LOOK);
    const { body, rifle } = this.soldier.avatar, onto = seat(puppet, standing, this.rover, rifle, this.progress, { yaw, pitch: this.view.pitch });
    for (const side of ['left', 'right'] as const) body.shapeHand(side, onto[side], dt);
  }

  protected cues() { return CUES; }

  protected stowage() { return { parent: this.rover.marks.rack, matrix: new Matrix4() }; }
}
