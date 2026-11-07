import { expect, it, vi } from 'vitest';
import { Quaternion, Scene, Vector3 } from 'three';
import { Avatar, type AvatarState } from '../src/avatar';
import { fighter } from '../src/fighter';
import { node, offGrip } from './course';

/** how far (rad) arm `side`'s elbow is swung round the line from its shoulder to its wrist off straight down */
function swivel(avatar: Avatar, side: 'left' | 'right') {
  const at = (bone: string) => avatar.body.bones[bone].getWorldPosition(new Vector3());
  const shoulder = at(`${side}UpperArm`), line = at(`${side}Hand`).sub(shoulder).normalize();
  const elbow = at(`${side}LowerArm`).sub(shoulder), down = new Vector3(0, -1, 0);
  elbow.addScaledVector(line, -elbow.dot(line));
  down.addScaledVector(line, -down.dot(line));
  return elbow.angleTo(down);
}

// (the fighter's shoulders are broader than the soldier's: the butt's pocket is placed for whichever body holds the rifle)
it('holds its rifle aimed with both hands on their grips, the arms within their ranges, clear of the trunk, the elbows down', () => {
  vi.stubEnv('MODE', 'development');
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
  expect(body.log).toEqual([]);
  vi.unstubAllEnvs();
});
