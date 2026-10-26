import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { horse, humanoid, species } from '../src/index';
import { powerGait } from '../src/species';
import { Pose } from '../src/kernel/pose';
import { proportionsFor } from '../src/species/humanoid/proportions';
import { massFor } from '../src/species/humanoid/skeleton';
import { Body } from '../src/index';
import { run } from './bodies';
import { PERSON } from './skeletons/person';
import { HORSE } from './skeletons/horse';

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

  it('estimates its height off its head without a crown', () => {
    const headless = PERSON.filter((bone) => bone.name !== 'head_end');
    expect(humanoid(headless).person?.height).toBeCloseTo((0.53 + 0.07 + 0.1 + 0.118 + 0.06) * 1.75 / 0.878, 6);
  });

  it('throws naming the bones a skeleton lacks', () => {
    const handless = PERSON.filter((bone) => !bone.name.startsWith('leftHand'));
    // (written out `as const`, such a skeleton does not compile either: `missingBones: "leftHand"`)
    expect(() => humanoid(handless)).toThrow(/no bone named leftHand/);
  });
});

describe('a horse', () => {
  it('stands with its forelegs bearing about 57% of its weight, its numbers sized to its skeleton', () => {
    const mare = horse(HORSE), pose = new Pose(mare.skeleton);
    const com = pose.com(new Vector3()), [fore, hind] = [mare.skeleton.index('leftForeHoof'), mare.skeleton.index('leftHindHoof')].map((bone) => pose.position(bone).z);
    expect((com.z - hind) / (fore - hind)).toBeGreaterThan(0.52);
    expect((com.z - hind) / (fore - hind)).toBeLessThan(0.62);
    // (a pony two thirds its size: a third of its weight, its stride's cadence √1.5 times as quick)
    const pony = horse(HORSE.map((bone) => ({ ...bone, position: [bone.position[0] * 2 / 3, bone.position[1] * 2 / 3, bone.position[2] * 2 / 3] as const })));
    expect(pony.mass / mare.mass).toBeCloseTo((2 / 3) ** 3, 6);
    expect(pony.scale).toBeCloseTo(2 / 3, 9);
  });
});

describe('a species of your own', () => {
  it('stands and walks on the legs its roles name', () => {
    // (a two-legged bird of 1 kg: a body, and each leg a hip, knee and foot with a toe ahead)
    const BIRD = [
      { name: 'body', position: [0, 0.3, 0] },
      { name: 'leftHip', parent: 'body', position: [0.05, 0.28, 0] }, { name: 'leftKnee', parent: 'leftHip', position: [0.05, 0.15, 0.03] },
      { name: 'leftFoot', parent: 'leftKnee', position: [0.05, 0.02, 0] },
      { name: 'rightHip', parent: 'body', position: [-0.05, 0.28, 0] }, { name: 'rightKnee', parent: 'rightHip', position: [-0.05, 0.15, 0.03] },
      { name: 'rightFoot', parent: 'rightKnee', position: [-0.05, 0.02, 0] },
    ] as const;
    const leg = (side: 'left' | 'right') => ({
      joints: [{ bone: `${side}Hip`, axes: 'yzx' }, { bone: `${side}Knee`, axes: 'x' }, { bone: `${side}Foot`, axes: 'x' }] as const,
      heel: [0, -0.02, -0.02] as const, toe: [0, -0.02, 0.04] as const,
    });
    const bird = species(BIRD, { legs: [leg('left'), leg('right')] }, {
      gait: powerGait({ height: 0.28, slowest: 0.2, offsets: [0, 0.5], stride: 2, stance: 0.9, clearance: [0.02, 0.02] }),
      masses: { body: 0.8, leftHip: 0.05, leftKnee: 0.03, leftFoot: 0.02, rightHip: 0.05, rightKnee: 0.03, rightFoot: 0.02 },
    });
    const body = new Body(bird, { dev: true });
    expect(body.bones.leftKnee.name).toBe('leftKnee');
    run(body, 1);
    expect(bird.mass).toBeCloseTo(1, 9);
    expect(body.settled).toBe(true);
  });
});
