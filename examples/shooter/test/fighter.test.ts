import { expect, it } from 'vitest';
import { Quaternion, Scene, Vector3 } from 'three';
import { Avatar, type AvatarState } from '../src/avatar';
import { fighter } from '../src/fighter';
import { node, offGrip } from './course';
import { Dev } from '../../../packages/animate/src/kernel/dev';
import { checkLimits } from '../../../packages/animate/src/kernel/limits';
import { checkArms } from '../../../packages/animate/src/hands/person/trunk';

/** how far (rad) arm `side`'s elbow is swung round the line from its shoulder to its wrist off straight down */
function swivel(avatar: Avatar, side: 'left' | 'right') {
  const at = (bone: string) => avatar.body.bones[bone].getWorldPosition(new Vector3());
  const shoulder = at(`${side}UpperArm`), line = at(`${side}Hand`).sub(shoulder).normalize();
  const elbow = at(`${side}LowerArm`).sub(shoulder), down = new Vector3(0, -1, 0);
  elbow.addScaledVector(line, -elbow.dot(line));
  down.addScaledVector(line, -down.dot(line));
  return elbow.angleTo(down);
}

// (the broad-shouldered fighter aiming at a point ahead, standing still: with the butt in a pocket placed for the soldier's narrower
// shoulders, its support elbow swung 26° out from straight down round the grip; now 1°, the trigger elbow 20°)
it('holds its rifle aimed with both hands on their grips, the arms within their ranges, clear of the trunk, the elbows down', () => {
  const avatar = new Avatar(new Scene(), undefined, () => 0, undefined, fighter);
  avatar.reset(new Vector3());
  const input: AvatarState = { position: new Vector3(), velocity: new Vector3(), yaw: 0, pitch: 0, aim: true, aimPoint: new Vector3(0, 1.6, 15), sprint: false, crouch: false, support: new Vector3(), firstPerson: false };
  for (let frame = 0; frame < 240; frame++) avatar.update(1 / 60, input);
  avatar.group.updateMatrixWorld(true);
  expect(avatar.acquired).toBe(true);
  const body = avatar.body;
  for (const [side, grip] of [['left', 'foregrip'], ['right', 'pistol']] as const) {
    const placed = body.gripOn(side, body.placement(side, node(avatar.group, grip)));
    expect(offGrip(body, side, node(avatar.group, grip)), `${side} wrist`).toBeLessThan(0.002);
    expect(body.bones[`${side}Hand`].getWorldQuaternion(new Quaternion()).angleTo(placed.rotation), `${side} hand's turn`).toBeLessThan(0.02);
    expect(swivel(avatar, side), `${side} elbow`).toBeLessThan(0.4);
  }
  const proportions = body.species.person;
  if (!proportions) throw new Error('the fighter is a humanoid');
  const dev = new Dev();
  checkLimits(body.pose, dev, 0);
  checkArms(body.pose, proportions, 0, dev);
  expect(dev.log).toEqual([]);
});
