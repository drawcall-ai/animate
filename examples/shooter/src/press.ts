import { grab, release, wait, type Body } from '@drawcall/animate';
import type { Object3D } from 'three';

/** How long a pressing pad stays on its button before it lets go (s): as long as the cap takes to go in under it. */
const HELD = 0.08;
/** A hand goes to a button from where the soldier stands. */
const POKE = { step: false };
const QUICK = { speed: 1.8 };

/**
 * A button press: the left hand lets go of the rifle's front, the right holding it on, and presses the button's face with its index's
 * pad, `pressed` as it meets it; it holds a moment, draws back off it and goes back to the rifle's front.
 */
export class Press {
  /** a button the left hand is asked to press, and what to tell as it does: until the hand is back on the rifle */
  wanted: { button: Object3D; pressed: () => void } | null = null;
  /** the left hand off the rifle for a press, the rifle lowered meanwhile (it comes up again as the hand draws back off the button) */
  lowering = false;

  constructor(private readonly person: Body, private readonly rifle: Object3D) {}

  *run() {
    const wanted = this.wanted;
    if (!wanted) throw new Error('No press is asked for');
    const { button, pressed } = wanted, person = this.person;
    this.lowering = true;
    if (!(yield* grab(person, button, { left: 'press' }, POKE))) throw new Error(`The soldier could not press "${button.name}"`);
    pressed();
    yield* wait(HELD);
    this.lowering = false;
    release(person, { left: button });
    if (!(yield* grab(person, this.rifle, { left: 'foregrip' }, QUICK))) throw new Error('The support hand could not return to the rifle after pressing');
    this.wanted = null;
  }
}
