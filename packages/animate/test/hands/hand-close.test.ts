// A hand stopped within REACHED.close (1.5 cm) of its goal is there, with or without `until`; a pad must be on its grip all the same.
import { CylinderGeometry, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { attempt, Body, grab, humanoid, Missed, play, reach } from '../../src/index';
import { insides, person } from '../kit/bodies';
import { FINGERED } from '../kit/skeletons/fingered';
import { empty, roomOf } from '../kit/things';
import { gripOn } from '../../src/puppet';
import { POINT } from '../../src/fingers/shape';

const driven = () => person({ dev: true, life: { steady: 1, seed: 1 }, drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) });
const handOff = (body: Body, at: Vector3) => insides(body).pose.position(insides(body).hands.right).distanceTo(at);
const out = (z: number) => new Vector3(-0.3, 1.3, z);

describe('a reach to the end of the arm (driven: it cannot step)', () => {
  it('stopped 1.25 cm off it is there, true, within its turn', () => {
    const body = driven(), at = out(1.012);
    const { result } = play(body, reach(body, { right: at }, { step: false }));
    expect(result).toBe(true);
    expect(handOff(body, at)).toBeGreaterThan(0.01);
    expect(handOff(body, at)).toBeLessThan(0.016); // (read a frame after its hold ended: the arm eases)
  });
  it('stopped 1.6 cm off it misses', () => {
    const body = driven();
    expect(play(body, () => attempt(reach(body, { right: out(1.016) }, { step: false }))).result).toBeInstanceOf(Missed);
  });
  it('says the same given until as without', () => {
    const body = driven();
    expect(play(body, reach(body, { right: out(1.012) }, { step: false, until: 4 })).result).toBe(true);
  });
  it('once there, a target gone out of the arm misses all the same (until)', () => {
    const body = driven(), at = out(1.012);
    let t = 0;
    const miss = play(body, () => attempt(reach(body, { right: () => { t += 1 / 60; if (t > 3) at.z = 1.16; return at; } }, { step: false, until: () => t > 12 })), { limit: 20 }).result;
    expect(miss).toBeInstanceOf(Missed);
  });
  it('once exactly there, a target gone out of the arm misses all the same (until)', () => {
    const body = driven(), at = out(0.7);
    let t = 0;
    const miss = play(body, () => attempt(reach(body, { right: () => { t += 1 / 60; if (t > 3) at.z = 1.16; return at; } }, { step: false, until: () => t > 12 })), { limit: 20 }).result;
    expect(miss).toBeInstanceOf(Missed);
  });
});

function rodAt(z: number, point: 'thumb' | 'palm') {
  const body = new Body(humanoid(FINGERED), { dev: true, life: { seed: 3, steady: 1 }, drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) }), room = roomOf(body);
  const rod = new Mesh(new CylinderGeometry(0.01, 0.01, 0.1, 16));
  rod.position.set(0.3, 1.3, z);
  room.add(rod);
  const g = empty(rod, 'grip', new Vector3(-0.01, 0, 0));
  if (point !== 'palm') g.userData.point = point;
  room.updateMatrixWorld(true);
  const { wrist, rotation } = gripOn(body, 'left', { on: new Object3D(), point, position: new Vector3(), quaternion: new Quaternion(), fingers: POINT });
  const onHand = wrist.negate().applyQuaternion(rotation.invert());
  const gap = () => body.bones.leftHand.localToWorld(onHand.clone()).distanceTo(g.getWorldPosition(new Vector3()));
  const fingers = () => { let sum = 0; body.object.traverse((o) => { if (/left.*(index|middle|ring|little|pinky)/i.test(o.name)) sum += o.quaternion.angleTo(new Quaternion()); }); return sum; };
  return { body, rod, gap, fingers };
}

describe('a grab at the end of the arm', () => {
  it.each([1.0885, 1.09, 1.0915])('a pad stopped over a centimetre off its grip (z %f) holds no grip: it misses, as one nearer does', (z) => {
    const { body, rod } = rodAt(z, 'thumb');
    const miss = play(body, () => attempt(grab(body, rod, { left: 'grip' }, { step: false }))).result;
    expect(miss).toBeInstanceOf(Missed);
  });
  it('a palm that stopped within 1.5 cm holds, as one nearer does', () => {
    let seen = 0;
    for (let k = 0; k < 40 && !seen; k++) {
      const { body, rod, gap } = rodAt(1.09 + k * 0.002, 'palm');
      const { miss, end } = play(body, function* () { const miss = yield* attempt(grab(body, rod, { left: 'grip' }, { step: false })); return { miss, end: gap() }; }, { limit: 15 }).result;
      if (end > 0.01 && end <= 0.015 && !miss) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
