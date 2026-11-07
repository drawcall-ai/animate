import { carry, grab, release, wait, type Body } from '@drawcall/animate';
import { action } from '@pmndrs/timeline';
import { Object3D, Vector3 } from 'three';
import { onBone } from './bones';
import { empty, RIFLE, type Rifle } from './weapon';
import type { Litter } from './weapon/litter';

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
/** How long a magazine takes to be pushed up the well's line to its seat (s), slowing as it seats: its last 4 cm over 0.16 s, not
 * snapped in (pushed evenly over 0.18 s, they took 0.10 s). */
const PUSH = 0.25;
/** How long a spent magazine takes to be pulled down the well's line until it is out of it (s), gathering speed into its fling. */
const PULL = 0.12;
/** How fast the left hand goes to the pouch and brings the magazine from it to the well (m/s). */
const BRISK = { speed: 2.6 };
const QUICK = { speed: 1.8 };

/**
 * The magazine swap: the left hand pinches the spent magazine's body under the well, pulls it down out of it and flings it away down and
 * out, letting go on the way (the litter takes it and lets it fly on as the hand moved it), then pinches the full one in its pouch,
 * brings it up under the well and pushes it home, and goes back to the rifle's front.
 */
export class Reload {
  /** asked for, not yet begun */
  wanted = false;
  /** from the swap's start until the support hand is back on the rifle */
  swapping = false;
  /** the left hand off the rifle, which rides the chest meanwhile */
  riding = false;
  /** how many swaps have ended */
  count = 0;
  /** the magazines on it, each named by when it was issued: the one in the well and one in each pouch at first */
  readonly magazines: Object3D[] = [];
  private readonly pouches: Object3D[];
  private issued = 0;

  constructor(private readonly person: Body, private readonly rifle: Rifle, private readonly litter: Litter, private readonly onReload?: (phase: 'out' | 'in') => void) {
    const proportions = person.species.person;
    if (!proportions) throw new Error('A reload requires a humanoid');
    const arms = proportions.arms;
    this.pouches = POUCHES.map((at, i) => {
      const pouch = onBone(person, person.bones.chest, `pouch ${i + 1}`, at.clone().multiply(new Vector3(arms, arms, proportions.scale)));
      empty(pouch, `over pouch ${i + 1}`, new Vector3(0, 0.1 * proportions.scale, 0));
      pouch.userData.approach = [`over pouch ${i + 1}`];
      return pouch;
    });
    for (const place of [rifle.well, ...this.pouches]) this.issue(place);
  }

  get reloading(): boolean { return this.swapping || this.wanted; }

  /** the swap, once `raised` (the rifle turned up to the chest far enough for the hand to leave it) */
  *run(raised: () => boolean) {
    this.wanted = false;
    this.swapping = true;
    const [pouch] = this.pouches, spent = this.magazines.find((magazine) => magazine.parent === this.rifle.well);
    const full = this.magazines.find((magazine) => magazine.parent === pouch);
    if (!spent || !full) throw new Error('Reload requires an inserted magazine and a spare in the first pouch');
    // (the rifle turning up to the chest with the hand still on its front, the hand leaving it half way)
    yield* wait(raised);
    this.riding = true;
    if (!(yield* this.swap(spent, full))) throw new Error('The soldier could not swap magazines');
    this.riding = false;
    this.count++;
    // (the support hand back on the receiver while the rifle still rides the chest, as it took it before the reload, then raised with it)
    if (!(yield* grab(this.person, this.rifle.rifle, { left: 'foregrip' }, QUICK)))
      throw new Error('The support hand could not return to the rifle after reloading');
    this.issue(pouch);
    this.swapping = false;
  }

  private issue(place: Object3D) {
    this.magazines.push(this.rifle.magazineIn(place, `magazine ${++this.issued}`));
  }

  private *swap(spent: Object3D, full: Object3D) {
    const { person, rifle: { well, below }, magazines } = this;
    if (!(yield* grab(person, spent, { left: 'base' }, QUICK))) return false;
    this.onReload?.('out');
    // (pulled straight down out of the well along its line, gathering speed — carried out, it would leave the line still in the well —
    // then flung on out and down, let go of on the way)
    yield* slide(spent, -RIFLE.wellLine, PULL, (share) => share * share);
    const from = spent.getWorldPosition(new Vector3()), to = person.object.localToWorld(FLING.to.clone());
    yield* carry(person, spent, to, { speed: FLING.speed, until: () => spent.getWorldPosition(new Vector3()).distanceTo(from) > FLING.after });
    const { velocity, spin } = release(person, spent);
    magazines.splice(magazines.indexOf(spent), 1);
    this.litter.drop(spent, velocity, spin);
    if (!(yield* grab(person, full, { left: 'base' }, BRISK))) return false;
    // (brought up under the well and turned as it is, then pushed home up its line in the pinch it came out of the pouch in: put onto
    // its place under the well, the hand keeping hold, then pushed up the line, the hand going with it)
    if (!(yield* carry(person, full, below, BRISK))) return false;
    release(person, full, below, { left: true });
    if (full.parent !== below) throw new Error(`"${full.name}" was not put onto "${below.name}"`);
    yield* slide(full, RIFLE.wellLine, PUSH, (share) => 1 - (1 - share) ** 2);
    release(person, full, well);
    this.onReload?.('in');
    return true;
  }
}

/** `magazine`, held, slid `by` (m) along the well's line (its parent turned as the well) in `seconds`, along `way` (the share of the way
 * gone at each share of the time), the hand going with it */
function slide(magazine: Object3D, by: number, seconds: number, way: (share: number) => number) {
  const from = magazine.position.y;
  let slid = 0;
  return action({
    update: (_, clock) => {
      slid = Math.min(1, slid + clock.delta / seconds);
      magazine.position.y = from + by * way(slid);
    },
    until: () => slid === 1,
  });
}
