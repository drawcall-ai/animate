import type { Frame } from '../kernel/frame';
import type { Goal } from '../kernel/goal';
import type { Binding } from '../body/binding';
import type { Handling } from '../body/handling';
import { Self, type Behaviours, type SelfOptions } from '../body/self';
import type { AnySpecies } from '../species/define';
import { bear, checkParents } from '../things/hold';
import { creature } from './balance';
import { creatureHands, keeping } from './hands';

/** Any species but a person: its legs and carriage, and hands that are each the tip of a chain. */
export class Creature extends Self {
  constructor(species: AnySpecies, options: SelfOptions, binding: Binding) {
    if (options.life?.steady !== undefined) throw new Error(`life.steady: a person's; a ${species.name ?? 'custom species'} has no such setting`);
    super(species, options, binding);
    // (made now, so that legs that cannot stand fail before the first update)
    this.behaviours = this.behave();
  }

  /** a creature's, wherever it reaches */
  holds(_f: Frame, _hand: string, _wrist: Goal): boolean {
    return true;
  }

  /** one at a time, each the tip of its chain */
  protected handle(): Handling {
    return creatureHands(this);
  }

  /** its legs and carriage, its jaw keeping hold */
  protected behave(): Behaviours {
    return {
      balance: this.species.legs ? creature(this) : undefined,
      keep: keeping(this),
      things: (f) => {
        checkParents(this);
        bear(this, f, this.worn, this.borne);
      },
    };
  }
}
