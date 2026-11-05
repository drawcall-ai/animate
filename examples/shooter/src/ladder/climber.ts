import type { Object3D } from 'three';
import type { PhysicsWorld } from '@drawcall/physics';
import { yawOf } from '../angles';
import type { Standing } from '../choreography';
import { Mount } from '../mount';
import type { Puppet } from '../puppet';
import type { Soldier } from '../soldier';
import { BEATS, cues, gripping, hang, heights, ONTO, slung, type End } from './climbing';
import type { Ladder } from './model';

/** Seconds to get on the ladder (and off it), and how fast it is climbed (m/s). */
const MOUNTING = 1.2;
const CLIMBING = 0.65;

/**
 * A soldier on a ladder. It walks to the ladder's foot, or to its top on the landing with its back to it; slinging its rifle it takes the
 * rungs (or the stiles above the landing) and steps on, one foot then the other, and climbs a rung at a time with its hands and feet on
 * the diagonal. Climbing past either end it steps off there, taking its rifle back.
 */
export class Climber extends Mount {
  /** How far up the ladder its hips are (m), and which way it is asked to climb (1 up … −1 down). */
  private height = 0;
  private ahead = 0;
  /** whether each limb gripped its rung when last climbed */
  private gripped: boolean[] = [];

  constructor(soldier: Soldier, private readonly ladder: Ladder, world: PhysicsWorld, model?: Object3D) {
    super(soldier, world, model, { seconds: MOUNTING, take: BEATS.take });
  }

  /** Asks to climb: 1 up … −1 down. Past either end it gets off there, if there is room to stand. */
  climb(ahead: number) { this.ahead = ahead; }

  override update(dt: number) {
    // (getting on or off, the hips are at that end)
    if (this.state === 'on') this.ascend(dt);
    else if (this.posed) this.height = heights(this.ladder)[this.end()];
    return super.update(dt);
  }

  override reset() {
    super.reset();
    this.ahead = 0;
    this.gripped = [];
  }

  protected spots() { return [this.ladder.marks.foot, this.ladder.marks.top]; }
  protected frame() { return this.ladder.body; }
  protected facing() { return yawOf(this.ladder.body); }

  protected pose(puppet: Puppet, standing: Standing, dt: number) {
    const { body, rifle } = this.soldier.avatar, onto = hang(puppet, standing, this.ladder, rifle, this.end(), this.progress, this.height, this.view);
    for (const side of ['left', 'right'] as const) body.fingers(side, onto[side], dt);
  }

  protected cues() { return cues(this.end()); }

  protected stowage(puppet: Puppet) {
    const chest = this.soldier.avatar.body.bones.chest;
    chest.updateWorldMatrix(true, false);
    return { parent: chest, matrix: chest.matrixWorld.clone().invert().multiply(slung(puppet)) };
  }

  private ascend(dt: number) {
    const ends = heights(this.ladder), { foot, top } = this.ladder.marks;
    this.height = Math.min(ends.top, Math.max(ends.foot, this.height + this.ahead * CLIMBING * dt));
    // (each hand and foot heard as it comes onto its next rung)
    const limbs = gripping(this.ladder, this.height);
    limbs.forEach(({ kind, grips }, i) => { if (grips && this.gripped[i] === false) this.soldier.sound(...ONTO[kind]); });
    this.gripped = limbs.map(({ grips }) => grips);
    const off = this.ahead < 0 && this.height === ends.foot ? foot : this.ahead > 0 && this.height === ends.top ? top : undefined;
    if (off && this.fits(off)) this.dismount(off);
  }

  private end(): End { return this.spot === this.ladder.marks.top ? 'top' : 'foot'; }
}
