import { aim, ease, hinge, send } from './drivers'
import { stepFeet } from './feet'
import { type Figure, type Landing, type Pose, leaning, planted, speed } from './figure'
import { ground } from './ground'
import { GRAVITY, advance, pointing, turn, turning } from './physics'
import { SIZE } from './skeleton'
import { type Story, Teller } from './story'
import { clamp, deg, lerp, rad, smooth } from './vec'

/** the step of time a drive is rehearsed at (s): step an actor at this for what it rehearsed to come true */
export const STEP = 1 / 1440

/** Something done every step, after the figure's own rules, until it returns false. */
export type Act = (dt: number) => boolean

/** A drive, written by whoever needs one: given an actor and a power it returns the act that drives the actor's joints. */
export type Recipe<World> = (actor: Actor<World>, power: number) => Act

export type Side = 'right' | 'left'
const index = (side: Side) => (side === 'right' ? 0 : 1)

/**
 * A figure and the things of its world that it acts on, moved by a story. The state is plain data, so a drive can copy it
 * and try itself ahead of time.
 */
export class Actor<World> {
  private teller = new Teller()
  private acts: Act[] = []

  constructor(readonly state: { figure: Figure; world: World }) {}

  get figure() {
    return this.state.figure
  }
  get world() {
    return this.state.world
  }
  get playing() {
    return this.teller.telling
  }

  play(story: Story) {
    this.teller.tell(story)
  }

  act(act: Act) {
    this.acts.push(act)
  }

  // ---- what a story may say

  /** the trunk: how far it leans forward (degrees; back if negative) */
  trunk({ lean }: { lean: number }, { seconds = 0.3 } = {}) {
    send(this.figure.lean, lean, seconds)
  }

  /** an arm, as the directions of its upper arm and forearm */
  arm(side: Side, [upper, fore]: Pose, { seconds = 0.3 } = {}) {
    const arm = this.figure.arms[index(side)]
    send(arm.upper, upper, seconds)
    send(arm.fold, fore - upper, seconds)
  }

  /** the legs keep `by` m/s more than the figure now has */
  hurry(by: number) {
    this.figure.pace = speed(this.figure) + by
  }

  /** A contact the story names: that foot comes down `at` a place, how it `lands`, and how far its knee is to `bend` under the weight (degrees). Over when it has landed. */
  *step(side: Side, { at, lands, bend = 0 }: { at: number; lands: Landing; bend?: number }): Story {
    const foot = this.figure.legs[index(side)].foot
    foot.named = { at, lands, bend }
    // a foot already in the air goes on from where it is
    const through = foot.swing ? smooth(foot.swing.s) : 0
    if (foot.swing && through < 1) foot.swing.from = (foot.p.x - at * through) / (1 - through)
    yield () => foot.named === null
  }

  /**
   * Drives the figure by a recipe so that `measure` comes out at `target`: it tries the recipe on a copy ahead of time,
   * harder or softer within `powers`, and then does it. Over when `measure` has a value, or the recipe has run out.
   */
  *drive(recipe: Recipe<World>, { measure, target, powers }: { measure: (world: World) => number | null; target: number; powers: [number, number] }): Story {
    let [soft, hard] = powers
    for (let k = 0; k < 9; k++) {
      const power = (soft + hard) / 2
      const trial = new Actor(structuredClone(this.state))
      let running = true
      const run = recipe(trial, power)
      trial.act((dt) => (running = run(dt)))
      for (let n = 0; n < 1350 && running && measure(trial.world) === null; n++) trial.update(STEP)
      if ((measure(trial.world) ?? 0) > target) hard = power
      else soft = power
    }
    let running = true
    const run = recipe(this, hard)
    this.act((dt) => (running = run(dt)))
    yield () => !running || measure(this.world) !== null
  }

  /** stops: the figure sheds its speed in whatever steps that takes. Over when it stands. */
  *settle(): Story {
    const figure = this.figure
    figure.pace = 0
    figure.settling = figure.time
    send(figure.lean, 3, 0.9)
    this.arm('right', [-92, -80], { seconds: 0.9 })
    this.arm('left', [-92, -80], { seconds: 0.9 })
    yield () =>
      figure.time - (figure.settling ?? figure.time) > 0.6 &&
      Math.abs(speed(figure)) < 0.12 &&
      figure.legs.every((leg) => planted(leg.foot)) &&
      Math.abs(turning(figure.hips, figure.chest)) < 0.25
  }

  // ---- one step of time

  update(dt: number) {
    const figure = this.figure
    const { hips, chest, head } = figure
    figure.time += dt
    // intent: the story sets goals, and the goals come on
    this.teller.advance()
    ease(figure.lean, dt)
    for (const arm of figure.arms) {
      ease(arm.upper, dt)
      ease(arm.fold, dt)
    }
    // support and balance: the feet, and what the ground gives through them
    if (stepFeet(figure, Math.max(0, speed(figure)) * dt, dt)) {
      figure.footfalls += 1
      if (figure.settling !== null && figure.caught === null) figure.caught = figure.time
    }
    figure.push = lerp(figure.push, ground(figure, dt), dt / 0.12)
    // drivers: every one acts between two parts of the body.
    // The trunk is held over the hips against the leg that stands nearest under them, stilled against the world: that leg
    // sweeps back as the body passes over it. A figure that is settling leans back against its braking.
    const against = figure.settling === null ? 0 : clamp(deg(Math.atan2(figure.push, GRAVITY)), -28, 10)
    const upright = rad(90 - figure.lean.value - against)
    const stand = figure.legs
      .filter((leg) => planted(leg.foot))
      .sort((a, b) => Math.abs(a.foot.p.x - hips.p.x) - Math.abs(b.foot.p.x - hips.p.x))
      .at(0)
    const brace = figure.brace
    // (a braced leg is a strut: the trunk is held against the whole of it, down to the foot)
    if (stand) aim(stand.foot.braced ? stand.foot : stand.knee, hips, chest, upright, { stiff: 2400 * brace, damp: 280 * brace, most: 300 * brace, steady: true })
    else for (const leg of figure.legs) aim(leg.knee, hips, chest, upright, { stiff: 900, damp: 90, most: 130, steady: true })
    // a trunk folds only so far over the hips
    if (leaning(figure) > 60) turn(hips, chest, 2400 * rad(leaning(figure) - 60) - 120 * turning(hips, chest))
    aim(hips, chest, head, pointing(hips, chest), { stiff: 220, damp: 16, most: 60 })
    for (const arm of figure.arms) {
      // an elbow gives a little past straight, softly
      hinge(chest, arm.elbow, arm.hand, -150, 8, { stiff: 900, damp: 14 })
      if (arm.driven) continue
      aim(hips, chest, arm.elbow, rad(arm.upper.value), { stiff: 320 * figure.tone, damp: 26, most: 90 })
      aim(chest, arm.elbow, arm.hand, pointing(chest, arm.elbow) + rad(arm.fold.value), { stiff: 150 * figure.tone, damp: 10, most: 40 })
    }
    for (const leg of figure.legs) {
      hinge(hips, leg.knee, leg.foot, 0, 150)
      if (leg.driven || planted(leg.foot)) continue
      // a lifted leg folds at the knee to clear the ground
      const fold = leg.foot.swing ? 20 + 55 * Math.sin(Math.PI * leg.foot.swing.s) : 30
      aim(hips, leg.knee, leg.foot, pointing(hips, leg.knee) - rad(fold), { stiff: 120, damp: 8, most: 60 })
    }
    this.acts = this.acts.filter((act) => act(dt))
    // time: every mass keeps its speed but for those forces and the rods
    advance(figure.masses, figure.rods, dt)
    for (const leg of figure.legs) if (!leg.foot.held && leg.foot.p.y < SIZE.ankle) leg.foot.p.y = SIZE.ankle
    // arms let go slack by a drive take hold again once a foot has caught the figure
    if (figure.caught !== null) figure.tone = Math.min(1, figure.tone + dt / 0.45)
  }
}
