import type { CharacterModel } from '@pmndrs/viverse';
import { Body, type BodyOptions } from '../src/core/body';
import type { Behaviour } from '../src/core/goal';
import { human, type Humanoid } from '../src/humanoid/humanoid';

/** a person's body for a test: `story` given it as the person it is (`human(model)`) */
export function person(model: CharacterModel, story: (h: Humanoid) => Behaviour, options: BodyOptions = {}): Humanoid {
  return new Body(human(model), (b) => story(b as Humanoid), options) as Humanoid;
}
