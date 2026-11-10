import { describe, expect, it } from 'vitest';
import { humanoid } from '../../src/index';
import { proportionsFor } from '../../src/person/anatomy/proportions';
import { massFor } from '../../src/person/anatomy/skeleton';
import { PERSON } from '../../skills/animate/references/person';

describe('a humanoid', () => {
  it('measures its proportions off its skeleton, its height off the crown, with Dempster’s masses for that height', () => {
    const measured = humanoid(PERSON).person, standard = proportionsFor(1.75);
    if (!measured) throw new Error('no person');
    expect(measured.height).toBeCloseTo(1.75, 9);
    for (const key of ['hipHeight', 'legLength', 'armLength', 'shoulderHeight', 'eyeHeight', 'ankleHeight', 'toeFront'] as const) {
      expect(measured[key], key).toBeCloseTo(standard[key], 6);
    }
    expect(humanoid(PERSON).skeleton.bones.reduce((sum, bone) => sum + bone.mass, 0)).toBeCloseTo(massFor(1.75), 9);
  });

});

