import { BoxGeometry, Mesh, Object3D, Vector3 } from 'three';
import { runTimeline } from '@pmndrs/timeline';
import { driven, jump } from '../kit/driving';
import { expect, it } from 'vitest';
import { carry, grab, release, track, wait, type Floor, type Root, poseOf } from '../../src/index';
import { INDEX, dt, readings, person, run, scene, flying } from '../kit/bodies';

/** eight 0.22 m risers up from z = 0, on 0.55 m treads */
const STAIRS: Floor = (_x, z) => Math.max(0, Math.min(8, Math.floor(z / 0.55) + 1)) * 0.22;


it('follows physics height through a ceiling stop, tucks its feet and never invents support during a long flight', () => {
  const { root, body, h } = driven();
  const standing = h.pose.position(0).y;
  const ankle = h.pose.position(INDEX.leftFoot).y;
  root.support = null;
  root.velocity.y = 4;
  for (let frame = 0; frame < 9; frame++) {
    root.position.y += root.velocity.y * dt;
    body.update(dt);
  }
  root.velocity.y = 0;
  let tuck = 0;
  for (let frame = 0; frame < 180; frame++) {
    body.update(dt);
    expect(flying(body)).toBe(true);
    expect(body.feet.every((foot) => !foot.planted)).toBe(true);
    expect(Math.abs(h.pose.position(0).y - root.position.y - standing)).toBeLessThan(0.015);
    tuck = Math.max(tuck, h.pose.position(INDEX.leftFoot).y - root.position.y - ankle);
  }
  expect(tuck).toBeGreaterThan(0.08);
});


it.each([0, 0.15, 0.3])('lands a physical jump on its current narrow platform at x=%s, not beyond its edge', (x) => {
  const floor = (x: number, z: number) => Math.abs(x) < 0.2 && z > 1.325 && z < 2.675 ? 0.45 : 0;
  const d = driven(floor, new Vector3(x, 0, 0.5)), { root, body, h } = d, bones = [INDEX.leftFoot, INDEX.rightFoot];
  let previous = bones.map((bone) => poseOf(body).position(bone).clone()), moved = 0;
  const landed = bones.map(() => false);
  const watch = () => {
    const current = bones.map((bone) => poseOf(body).position(bone).clone());
    if (root.support) {
      moved = Math.max(moved, ...current.map((at, i) => at.distanceTo(previous[i])));
      body.feet.forEach((foot, i) => { landed[i] ||= foot.planted; });
    }
    previous = current;
  };
  jump(d, new Vector3(0, 5, 3.5), 14, 0.19, watch);
  expect(root.position.y).toBe(0.45);
  root.velocity.set(0, 0, 0);
  run(body, 0.5, watch);
  expect(moved).toBeLessThan(0.15);
  expect(landed.every(Boolean)).toBe(true);
  for (const foot of body.feet) {
    expect(foot.position.y - h.proportions.ankleHeight).toBeCloseTo(0.45, 6);
    expect(floor(foot.position.x, foot.position.z)).toBe(0.45);
  }
  // A landing may square the stance once, then both feet remain in contact.
  run(body, 1);
  run(body, 0.5, () => expect(body.feet.every((foot) => foot.planted)).toBe(true));
});

it.each([0.15, 0.3])('keeps walking feet on a narrow elevated support beside the root at x=%s', (x) => {
  const floor = (x: number, z: number) => Math.abs(x) < 0.2 && z > 0.7 && z < 4.7 ? 0.65 : 0;
  const d = driven(floor, new Vector3(x, 0, 0)), { root, body } = d;
  const onSupport = () => {
    if (root.support) for (const foot of body.feet) expect(floor(foot.position.x, foot.position.z)).toBe(0.65);
  };
  jump(d, new Vector3(0, 5, 1.4), 14, 0.19, onSupport);
  for (let frame = 0; frame < 66; frame++) {
    root.position.addScaledVector(root.velocity, dt);
    root.support = root.position.clone().setX(Math.min(root.position.x, 0.19));
    body.update(dt);
    onSupport();
  }
});

it('keeps a standing leg while walking out of a physical landing', () => {
  const d = driven(), { root, body } = d;
  root.velocity.z = 1.4;
  for (let frame = 0; frame < 60; frame++) {
    root.position.z += root.velocity.z * dt;
    body.update(dt);
  }
  jump(d, root.velocity.clone().setY(6.5), 24);
  let planted = false;
  for (let frame = 0; frame < 60; frame++) {
    root.position.z += root.velocity.z * dt;
    body.update(dt);
    const standing = body.feet.some((foot) => foot.planted);
    if (planted || frame >= 6) expect(standing, `walking after touchdown, frame ${frame}`).toBe(true);
    planted ||= standing;
  }
});

it('carries a physics-driven body down from a raised landing without collapsing its hips', () => {
  const root: Root & { velocity: Vector3 } = { position: new Vector3(0, 1.76, 5.2), velocity: new Vector3(), yaw: Math.PI, support: new Vector3(0, 1.76, 5.2) };
  const body = person({ at: root.position.clone(), face: root.yaw, floor: STAIRS, drive: () => root });
  const h = readings(body);
  run(body, 3);
  root.velocity.z = -1.4;
  for (let frame = 0; frame < 30; frame++) {
    root.position.z += root.velocity.z * dt;
    root.position.y = STAIRS(root.position.x, root.position.z);
    root.support = root.position.clone();
    body.update(dt);
    expect(h.pose.position(0).y - root.position.y).toBeGreaterThan(0.65);
  }
});

it('lowers its hips smoothly as it walks off a ledge onto the floor below', () => {
  const floor = (_x: number, z: number) => z < 0.3 ? 0.44 : 0;
  const { root, body, h } = driven(floor);
  root.velocity.z = 1;
  let previous = h.pose.position(0).y, most = 0;
  for (let frame = 0; frame < 90; frame++) {
    root.position.z += root.velocity.z * dt;
    root.position.y = floor(root.position.x, root.position.z);
    root.support = root.position.clone();
    body.update(dt);
    const height = h.pose.position(0).y;
    most = Math.max(most, Math.abs(height - previous));
    previous = height;
  }
  expect(body.feet.every((foot) => foot.position.y - h.proportions.ankleHeight < 0.01)).toBe(true);
  expect(most).toBeLessThan(0.06);
});

it('stops on a stair without predicting backwards footfalls or dropping onto old lower treads', () => {
  const { root, body, h } = driven(STAIRS);
  root.velocity.z = 1.4;
  for (let frame = 0; frame < 128; frame++) {
    root.position.z += root.velocity.z * dt;
    root.position.y = STAIRS(root.position.x, root.position.z);
    root.support = root.position.clone();
    body.update(dt);
  }
  root.velocity.z = 0;
  let previous = h.pose.position(0).y;
  for (let frame = 0; frame < 60; frame++) {
    body.update(dt);
    const height = h.pose.position(0).y;
    expect(previous - height).toBeLessThan(0.06);
    expect(body.feet.every((foot) => foot.position.z > root.position.z - 0.9)).toBe(true);
    previous = height;
  }
});

it('does not treat one frame of controller acceleration as a sustained movement command', () => {
  const { root, body } = driven();
  root.velocity.z = 3.5;
  root.position.addScaledVector(root.velocity, dt);
  body.update(dt);
  expect(Math.max(...body.feet.map((foot) => Math.abs(foot.position.z - root.position.z)))).toBeLessThan(2);
});

// (a player flicks round: the body turns on the spot to face where its root faces however far round that is — taken the short way round
// once the root stops; while it still turned, the way it turned, the body turning back against a root more than half a turn ahead)
it.each([[2.5, 1.2], [4, 2], [-4, 2], [6, 1]])('turns on the spot to face a root flicked %s rad round within %s s', (turn, seconds) => {
  const { root, body, h } = driven();
  const frames = Math.round(Math.abs(turn) / (10 * dt)), facing = () => Math.abs(Math.atan2(Math.sin(root.yaw - body.facing), Math.cos(root.yaw - body.facing)));
  let previous = h.pose.position(0).clone(), moved = 0;
  for (let frame = 0; frame < frames + seconds / dt; frame++) {
    if (frame < frames) root.yaw += Math.sign(turn) * 10 * dt;
    body.update(dt);
    moved = Math.max(moved, h.pose.position(0).distanceTo(previous));
    previous.copy(h.pose.position(0));
  }
  expect(facing()).toBeLessThan(0.05);
  // (its feet squared up under it a step or two after)
  run(body, 1.5);
  expect(facing()).toBeLessThan(0.05);
  expect(body.feet.every((foot) => foot.planted)).toBe(true);
  expect(moved).toBeLessThan(0.03);
  expect(body.log).toEqual([]);
});

// (a flick round and straight back before the body has caught up: the body never turns away from its root, the long way round)
it('turns back with a root flicked past a quarter turn and back', () => {
  const { root, body } = driven();
  const lead = () => Math.atan2(Math.sin(root.yaw - body.facing), Math.cos(root.yaw - body.facing));
  let worst = 0;
  for (let frame = 0; frame < 150; frame++) {
    if (frame < 20) root.yaw += 10 * dt;
    else if (frame < 40) root.yaw -= 10 * dt;
    const was = Math.abs(lead());
    body.update(dt);
    // (once the root has gone back, the pelvis turns no further from it than it was)
    if (frame >= 40) worst = Math.max(worst, Math.abs(lead()) - was);
  }
  expect(worst).toBeLessThan(1e-6);
  expect(Math.abs(lead())).toBeLessThan(0.05);
});

it('keeps a supported body steady while turning near a static platform edge', () => {
  const floor = (x: number, z: number) => Math.abs(x) <= 0.6 && Math.abs(z) <= 0.6 ? 0.6 : 0;
  const { root, body, h } = driven(floor, new Vector3(0, 0.6, 0.55));
  run(body, 1);
  let previous = h.pose.position(0).y, jump = 0, lowest = previous;
  for (let frame = 0; frame < 240; frame++) {
    root.yaw = (frame + 1) * Math.PI / 120;
    body.update(dt);
    const height = h.pose.position(0).y;
    jump = Math.max(jump, Math.abs(height - previous));
    lowest = Math.min(lowest, height);
    previous = height;
  }
  expect(jump).toBeLessThan(0.02);
  expect(lowest - root.position.y).toBeGreaterThan(0.65);
});

it.each([0, 1.4, 3.5])('keeps the whole gait relative to a moving platform at %s m/s', (speed) => {
  let level = 0;
  const platform = new Object3D();
  const flat = driven(), riding = driven(() => level, undefined, platform);
  const [standing, carried] = [flat.body, riding.body];
  let positions = 0, rotations = 0, targets = 0;
  for (let frame = 0; frame < 600; frame++) {
    level = 1.1 * (1 - Math.cos((frame + 1) * dt * 0.7));
    platform.position.y = level;
    flat.root.velocity.set(0, 0, speed);
    riding.root.velocity.set(0, 0, speed);
    flat.root.position.z += speed * dt;
    riding.root.position.set(0, level, flat.root.position.z);
    flat.root.support = flat.root.position.clone();
    riding.root.support = riding.root.position.clone();
    standing.update(dt);
    carried.update(dt);
    const a = poseOf(standing), b = poseOf(carried);
    a.skeleton.bones.forEach((_, bone) => {
      // Gaze tracks a world target; the gait, trunk and free hands are carried with the floor.
      if (bone === INDEX.neck || bone === INDEX.head) return;
      positions = Math.max(positions, b.position(bone).clone().sub(platform.position).distanceTo(a.position(bone)));
      rotations = Math.max(rotations, b.rotation(bone).angleTo(a.rotation(bone)));
    });
    standing.feet.forEach((foot, i) => {
      const moving = carried.feet[i];
      expect(moving.planted).toBe(foot.planted);
      targets = Math.max(targets, moving.position.sub(platform.position).distanceTo(foot.position));
    });
  }
  expect(positions).toBeLessThan(1e-8);
  expect(rotations).toBeLessThan(1e-6);
  expect(targets).toBeLessThan(1e-8);
});

it('keeps each planted foot on the moving platform under it as it steps from one onto another', () => {
  // (two decks side by side along the way it walks, drifting sideways at different speeds)
  const decks = [new Object3D(), new Object3D()], speeds = [0.3, -0.5], deckAt = (z: number) => decks[z < 1 ? 0 : 1];
  const floor: Floor = Object.assign(() => 0, { platform: (_x: number, z: number) => deckAt(z) });
  const { root, body } = driven(floor, new Vector3(), decks[0]);
  root.velocity.z = 1;
  const decked = new Set<Object3D>();
  let before = body.feet, slid = 0;
  for (let frame = 0; frame < 150; frame++) {
    decks.forEach((deck, k) => { deck.position.x += speeds[k] * dt; deck.updateMatrixWorld(); });
    const under = deckAt(root.position.z);
    root.position.x += speeds[decks.indexOf(under)] * dt;
    root.position.z += root.velocity.z * dt;
    root.support = root.position.clone();
    root.platform = under;
    body.update(dt);
    body.feet.forEach((foot, i) => {
      if (!foot.planted || !before[i].planted) return;
      const deck = deckAt(foot.position.z);
      decked.add(deck);
      slid = Math.max(slid, Math.abs(foot.position.x - before[i].position.x - speeds[decks.indexOf(deck)] * dt), Math.abs(foot.position.z - before[i].position.z));
    });
    before = body.feet;
  }
  expect(decked.size).toBe(2);
  expect(slid).toBeLessThan(1e-6);
});

it.each([false, true])('keeps an external hand target in its world frame (moving=%s)', (moving) => {
  const platform = new Object3D(), target = new Object3D();
  const { root, body } = driven(() => platform.position.y, undefined, platform);
  run(body, 1);
  target.position.set(-0.25, 1.1, 0.3);
  target.quaternion.copy(poseOf(body).rotation(INDEX.rightHand));
  const tick = scene([body], () => track(body, { right: target }));
  for (let frame = 0; frame < 120; frame++) tick();
  let error = 0;
  for (let frame = 0; frame < 360; frame++) {
    const level = 0.1 * (1 - Math.cos((frame + 1) * dt));
    platform.position.y = root.position.y = level;
    root.support = root.position.clone();
    target.position.y = 1.1 + (moving ? level : 0);
    tick();
    error = Math.max(error, poseOf(body).position(INDEX.rightHand).distanceTo(target.position));
  }
  expect(error).toBeLessThan(0.02);
});

// (a soldier's magazine kept under the rifle's well as the player jumps: what goes onto a place on the body goes there however the body
// is flung, and a release there sets it without a word)
it.each([[5, 0], [5, 3]])('keeps a thing on a place on its own chest through a jump at %s m/s up, %s m/s ahead, and lets it go onto it', (up, ahead) => {
  const d = driven(), { body } = d;
  const room = new Object3D(), thing = new Mesh(new BoxGeometry(0.03, 0.12, 0.06)), side = new Object3D(), spot = new Object3D();
  thing.name = 'thing';
  thing.userData.mass = 0.4;
  thing.position.set(0.25, 1, 0.35);
  side.name = 'side';
  side.position.set(0, -0.04, 0);
  thing.add(side);
  spot.name = 'spot';
  room.add(body.object, thing);
  body.bones.chest.add(spot);
  room.updateMatrixWorld(true);
  spot.position.copy(body.bones.chest.worldToLocal(new Vector3(0.12, 1.05, 0.38)));
  let there = false, landed = false;
  const story = runTimeline(function* () {
    yield* grab(body, thing, { left: 'side' }, { step: false });
    yield* carry(body, thing, spot, { step: false, speed: 2.6 });
    there = true;
    yield* wait(() => landed);
    release(body, thing, spot);
  });
  const off = () => thing.getWorldPosition(new Vector3()).distanceTo(spot.getWorldPosition(new Vector3()));
  for (let frame = 0; frame < 600 && !there; frame++) { story(undefined, dt); body.update(dt); }
  expect(there).toBe(true);
  let worst = 0;
  // (held 2 to 5 cm off its place as the body took off and landed, the guide braking to the body's new pace as to its own)
  const step = () => { story(undefined, dt); worst = Math.max(worst, off()); };
  jump(d, new Vector3(0, up, ahead), 14, Infinity, step);
  d.root.velocity.set(0, 0, 0);
  run(body, 0.3, step);
  landed = true;
  story(undefined, dt);
  expect(worst).toBeLessThan(0.002);
  expect(thing.parent).toBe(spot);
});
