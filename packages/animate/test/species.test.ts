import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, grab, horse, humanoid, powerGait, species, walkTo } from '../src/index';
import { Pose } from '../src/kernel/pose';
import { proportionsFor } from '../src/species/humanoid/proportions';
import { massFor } from '../src/species/humanoid/skeleton';
import { play, run } from './bodies';
import { box, roomOf } from './things';
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

// (a two-legged bird of 1 kg: a body, each leg a hip, knee, ankle and toe; a neck to a beak and a tail, each a hand)
const BIRD = [
  { name: 'body', position: [0, 0.3, 0] },
  { name: 'leftHip', parent: 'body', position: [0.05, 0.28, 0] }, { name: 'leftKnee', parent: 'leftHip', position: [0.05, 0.18, 0.05] },
  { name: 'leftAnkle', parent: 'leftKnee', position: [0.05, 0.08, -0.02] }, { name: 'leftToe', parent: 'leftAnkle', position: [0.05, 0.02, 0] },
  { name: 'rightHip', parent: 'body', position: [-0.05, 0.28, 0] }, { name: 'rightKnee', parent: 'rightHip', position: [-0.05, 0.18, 0.05] },
  { name: 'rightAnkle', parent: 'rightKnee', position: [-0.05, 0.08, -0.02] }, { name: 'rightToe', parent: 'rightAnkle', position: [-0.05, 0.02, 0] },
  { name: 'neck', parent: 'body', position: [0, 0.35, 0.06] }, { name: 'beak', parent: 'neck', position: [0, 0.42, 0.1] },
  { name: 'tail', parent: 'body', position: [0, 0.31, -0.08] }, { name: 'tailTip', parent: 'tail', position: [0, 0.3, -0.16] },
] as const;
type BirdBone = (typeof BIRD)[number]['name'];
const leg = (side: 'left' | 'right', joints: readonly ('Hip' | 'Knee' | 'Ankle' | 'Toe')[] = ['Hip', 'Knee', 'Ankle', 'Toe']) => ({
  joints: joints.map((joint, k) => ({ bone: `${side}${joint}` as BirdBone, axes: k === 0 ? 'yzx' : k === joints.length - 1 && k === 3 ? 'zx' : 'x' })),
  heel: [0, -0.02, -0.02] as const, toe: [0, -0.02, 0.04] as const,
});
const gait = powerGait({ height: 0.26, slowest: 0.2, offsets: [0, 0.5], stride: 2, stance: 0.9, clearance: [0.02, 0.02] });
const masses = {
  body: 0.7, neck: 0.04, beak: 0.02, tail: 0.03, tailTip: 0.01,
  leftHip: 0.05, leftKnee: 0.03, leftAnkle: 0.01, leftToe: 0.01, rightHip: 0.05, rightKnee: 0.03, rightAnkle: 0.01, rightToe: 0.01,
};
const bird = species(BIRD, { legs: [leg('left'), leg('right')], hands: { beak: ['neck', 'beak'], tail: ['tail', 'tailTip'] } }, { gait, masses });

describe('a species of your own', () => {
  it('stands and walks on the legs its roles name, checked as it goes', () => {
    const body = new Body(bird, { dev: true });
    expect(body.bones.leftKnee.name).toBe('leftKnee');
    expect(bird.mass).toBeCloseTo(1, 9);
    run(body, 1);
    expect(body.settled).toBe(true);
    let walked: boolean | undefined;
    play(function* () { walked = yield* walkTo(body, new Vector3(0.3, 0, 0.6)); }, [body], 10, () => walked !== undefined);
    expect(walked).toBe(true);
    expect(body.position.distanceTo(new Vector3(0.3, 0, 0.6))).toBeLessThan(0.1);
    expect(body.log).toEqual([]);
  });

  it('throws when its legs reach no step from where they stand', () => {
    // (each leg a hip, knee and foot alone, standing all but straight)
    const STIFF = [
      { name: 'body', position: [0, 0.3, 0] },
      { name: 'leftHip', parent: 'body', position: [0.05, 0.28, 0] }, { name: 'leftKnee', parent: 'leftHip', position: [0.05, 0.15, 0.03] },
      { name: 'leftFoot', parent: 'leftKnee', position: [0.05, 0.02, 0] },
      { name: 'rightHip', parent: 'body', position: [-0.05, 0.28, 0] }, { name: 'rightKnee', parent: 'rightHip', position: [-0.05, 0.15, 0.03] },
      { name: 'rightFoot', parent: 'rightKnee', position: [-0.05, 0.02, 0] },
    ] as const;
    const stiffLeg = (side: 'left' | 'right') => ({
      joints: [{ bone: `${side}Hip`, axes: 'yzx' }, { bone: `${side}Knee`, axes: 'x' }, { bone: `${side}Foot`, axes: 'x' }] as const,
      heel: [0, -0.02, -0.02] as const, toe: [0, -0.02, 0.04] as const,
    });
    const stiff = species(STIFF, { legs: [stiffLeg('left'), stiffLeg('right')] }, { gait, masses: { body: 1 } });
    expect(() => new Body(stiff)).toThrow(/leg leftHip → leftFoot: joint leftHip.*sole flat.*leftKnee/);
  });

  it('takes a thing in one of its hands at a time', () => {
    const body = new Body(bird), room = roomOf(body);
    const twig = box(room, new Vector3(0, 0.05, 0.3), { size: new Vector3(0.1, 0.01, 0.01), mass: 0.01, solid: false });
    expect(() => play(function* () { yield* grab(body, twig, { beak: 'left', tail: 'right' }); }, [body], 0.1)).toThrow('a creature uses one hand at a time');
  });
});
