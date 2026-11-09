import { Group, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, poseOf } from '../../src/index';
import { placedFor } from '../../src/things/placed';
import { INDEX, dt, person, run } from '../kit/bodies';
import { rng } from '../kit/random';
import { claim, insides } from './insides';

describe('a body', () => {
  it('steps in fixed sub-steps whatever its frames: jittered frames give what fixed ones do', () => {
    const fixed = person({ life: { seed: 2 } }), jittered = person({ life: { seed: 2 } }), rand = rng(5);
    const spin = (body: Body) => claim(body, 'hand.left', (f) => f.current.setLocal(INDEX.leftLowerArm, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.sin(3 * f.time))));
    spin(fixed);
    spin(jittered);
    let time = 0;
    while (time < 2 - 1e-9) {
      const frame = Math.min(2 - time, (0.2 + 1.6 * rand()) * dt);
      jittered.update(frame);
      time += frame;
    }
    run(fixed, 2);
    for (let bone = 0; bone < poseOf(fixed).skeleton.bones.length; bone++) expect(poseOf(jittered).local(bone).angleTo(poseOf(fixed).local(bone))).toBeLessThan(1e-6);
  });

  it('reads an app-owned world matrix under a moving bone, interpolating it across sub-steps', () => {
    const body = person(), mount = new Group(), target = new Group(), samples: number[][] = [];
    body.bones.chest.add(mount);
    mount.add(target);
    mount.matrixWorldAutoUpdate = target.matrixAutoUpdate = false;
    target.matrix.makeTranslation(0.1, 0, 0);
    claim(body, 'trunk', (f) => f.current.setLocal(INDEX.chest, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.time)));
    claim(body, 'hand.right', () => { samples.push(placedFor(insides(body), target, { position: new Vector3(), quaternion: new Quaternion() }).position.toArray()); });
    body.update(dt);
    mount.matrixWorld.makeTranslation(2, 1, 3);
    body.update(2 * dt);
    expect(samples).toEqual([[0.1, 0, 0], [1.1, 0.5, 1.5], [2.1, 1, 3]]);
  });

  it.each([dt / 2, dt, 2 * dt, 6 * dt])('reads another body before its update, in either order at %s s per frame', (seconds) => {
    const first = person({ drive: (time) => ({ position: new Vector3(0.5 * time, 0, 0), velocity: new Vector3(0.5, 0, 0), yaw: 0 }) });
    const seen: number[] = [];
    const watcher = person({ at: new Vector3(0, 0, 2) });
    claim(watcher, 'look', () => { seen.push(first.position.x); });
    for (let k = 0; k < 30; k++) {
      first.update(seconds);
      watcher.update(seconds);
    }
    const reversed: number[] = [];
    const other = person({ drive: (time) => ({ position: new Vector3(0.5 * time, 0, 0), velocity: new Vector3(0.5, 0, 0), yaw: 0 }) });
    const second = person({ at: new Vector3(0, 0, 2) });
    claim(second, 'look', () => { reversed.push(other.position.x); });
    for (let k = 0; k < 30; k++) {
      second.update(seconds);
      other.update(seconds);
    }
    expect(reversed).toEqual(seen);
  });

});

