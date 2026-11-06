import { expect, it } from 'vitest';
import { Matrix4, MeshStandardMaterial, Vector3, type Scene } from 'three';
import { Lift } from '../src/lift';
import { SPEED } from '../src/movement';
import { box, cleanup, DT, soldierOn, soles } from './course';
import { expectSmooth, Motion } from './motion';

const sides = ['left', 'right'] as const;

it('keeps the posed soles on a vertically moving lift without walking in place', async () => {
  const { world, movement, avatar, advance, built: platform } = await soldierOn(
    (scene) => box(scene, [6, 0.4, 6], [0, 0, 0], 'kinematic'), { spawn: new Vector3(0, 0.22, 0), firstPerson: false },
  );
  advance(3);
  const began = world.time;
  world.onBeforeStep(() => platform.setKinematicTarget(new Matrix4().makeTranslation(0, 0.4 * Math.sin((world.time - began) * 1.2), 0)));
  let penetration = 0, hovering = 0, lifted = 0;
  for (let frame = 0; frame < 240; frame++) {
    world.update(DT);
    expect(movement.grounded).toBe(true);
    const floor = platform.getWorldPosition(new Vector3()).y + 0.2;
    for (const side of sides) {
      const above = Math.min(...soles(avatar.body, side).map((point) => point.y - floor));
      penetration = Math.max(penetration, -above);
      hovering = Math.max(hovering, above);
    }
    if (avatar.body.feet.some((foot) => !foot.planted)) lifted++;
  }
  expect(penetration).toBeLessThan(0.01);
  expect(hovering).toBeLessThan(0.025);
  expect(lifted).toBe(0);
});

/** The course's lift beside its upper deck; the lift starts at `height(0)`. */
function liftAndDeck(height: (time: number) => number) {
  return (scene: Scene) => {
    box(scene, [40, 1, 40], [0, -0.5, 0], 'static', 'Ground');
    box(scene, [5, 0.3, 3], [0, 2.25, 3.4], 'static', 'Deck');
    return box(scene, [3.2, 0.25, 3.2], [0, height(0), 0], 'kinematic', 'Lift');
  };
}

it.each(['walk', 'sprint', 'jump'] as const)('keeps %s animation attached to the course lift through both reversals', async (mode) => {
  const height = (time: number) => 0.125 + (1 - Math.cos(time * 0.7)) * 1.1;
  const { world, movement, avatar, terrain, acquire, built: lift } = await soldierOn(liftAndDeck(height), { spawn: new Vector3(0, 0.27, -0.4) });
  acquire();
  const motion = new Motion(avatar.body);
  const began = world.time;
  world.onBeforeStep((dt) => lift.setKinematicTarget(new Matrix4().makeTranslation(0, height(world.time + dt - began), 0)));
  const hips = new Vector3();
  const hipHeight = () => avatar.body.bones.hips.getWorldPosition(hips).y - movement.position.y;
  let direction = 1, hovering = 0, penetration = 0, hipChange = 0, airborne = 0, speed = 0;
  let previousHip = hipHeight();
  for (let frame = 0; frame < 660; frame++) {
    if (mode === 'jump') movement.input.jump = frame % 180 < 60;
    else {
      if (movement.position.z > 0.55) direction = -1;
      if (movement.position.z < -0.55) direction = 1;
      movement.input.move.z = direction;
      movement.input.sprint = mode === 'sprint';
    }
    world.update(DT);
    motion.sample(frame);
    speed = Math.max(speed, movement.speed);
    if (movement.grounded) expect(movement.position.y - lift.position.y - 0.125).toBeCloseTo(0.004, 2);
    else airborne++;
    const hip = hipHeight();
    hipChange = Math.max(hipChange, Math.abs(hip - previousHip));
    previousHip = hip;
    for (const [index, side] of sides.entries()) {
      if (!avatar.body.feet[index].planted) continue;
      const gap = Math.min(...soles(avatar.body, side).map((point) => point.y - terrain.floor(point.x, point.z)));
      hovering = Math.max(hovering, gap);
      penetration = Math.max(penetration, -gap);
    }
  }
  if (mode === 'jump') expect(airborne).toBeGreaterThan(100);
  else expect(airborne).toBe(0);
  if (mode === 'sprint') expect(speed).toBeCloseTo(SPEED.sprint, 5);
  expect(hipChange, 'Pelvis must not snap when a swing foot plants').toBeLessThan(0.06);
  expect(hovering, 'Planted soles must follow the completed platform pose').toBeLessThan(0.025);
  expect(penetration).toBeLessThan(0.01);
  expectSmooth(motion);
});

it.each([1, -1].flatMap((direction) => [false, true].map((stop) => ({ direction, stop }))))(
  'keeps each foot on its surface through lift/deck transfer direction=$direction stop=$stop', async ({ direction, stop }) => {
    const phase = direction > 0 ? 2.7 : 3.15;
    const height = (time: number) => 0.125 + (1 - Math.cos(phase + time * 0.7)) * 1.1;
    const spawn = new Vector3(0, direction > 0 ? height(0) + 0.145 : 2.42, direction > 0 ? 0.2 : 2.8);
    const { world, movement, avatar, terrain, acquire, built: lift } = await soldierOn(liftAndDeck(height), { spawn, yaw: direction > 0 ? 0 : Math.PI });
    acquire();
    const began = world.time;
    world.onBeforeStep((dt) => lift.setKinematicTarget(new Matrix4().makeTranslation(0, height(world.time + dt - began), 0)));
    const destination = direction > 0 ? 'Deck' : 'Lift';
    let transferred = false, independent = 0, hover = 0, penetration = 0, hipChange = 0;
    let previousHip = avatar.body.bones.hips.getWorldPosition(new Vector3()).y - movement.position.y;
    for (let frame = 0; frame < 300; frame++) {
      const finished = transferred && stop || direction * movement.position.z > (direction > 0 ? 3 : 0.5);
      movement.input.move.z = finished ? 0 : direction;
      world.update(DT);
      transferred ||= movement.platform?.name === destination;
      avatar.body.feet.forEach((foot, index) => {
        if (!foot.planted) return;
        const surface = foot.position.z >= 1.9 ? 'Deck' : foot.position.z <= 1.6 ? 'Lift' : 'Gap';
        if (surface !== 'Gap' && surface !== movement.platform?.name) independent++;
        const gap = Math.min(...soles(avatar.body, sides[index]).map((p) => p.y - terrain.floor(p.x, p.z)));
        hover = Math.max(hover, gap);
        penetration = Math.max(penetration, -gap);
      });
      const hip = avatar.body.bones.hips.getWorldPosition(new Vector3()).y - movement.position.y;
      hipChange = Math.max(hipChange, Math.abs(hip - previousHip));
      previousHip = hip;
    }
    expect(transferred).toBe(true);
    expect(independent, 'A foot must remain on a different surface from the capsule').toBeGreaterThan(0);
    expect(hover, 'Planted contacts must follow their own surface').toBeLessThan(0.025);
    expect(penetration).toBeLessThan(0.01);
    expect(hipChange).toBeLessThan(0.06);
  },
);

it('stays until its panel\'s button is pressed with the index fingertip, then rides up', async () => {
  // (the soldier on the platform facing its panel, on the platform's +X edge)
  const { world, avatar, movement, acquire, advance, built: lift } = await soldierOn((scene) => {
    box(scene, [40, 1, 40], [0, -0.5, 0], 'static', 'Ground');
    const landing = { at: new Vector3(3, 0, 3), yaw: 0 };
    return new Lift(box(scene, [3.2, 0.25, 3.2], [0, 0.125, 0], 'kinematic', 'Lift'), new MeshStandardMaterial(), { down: landing, up: landing });
  }, { spawn: new Vector3(1, 0.27, 0.35), yaw: Math.PI / 2 });
  cleanup(lift.bind(world));
  acquire();
  const foot = lift.body.position.y;
  advance(2);
  expect(lift.body.position.y).toBe(foot);
  expect(lift.within(movement.position, -Math.PI / 2), 'Its back to the panel, it presses nothing').toBeNull();
  const button = lift.within(movement.position, Math.PI / 2);
  expect(button).toBe(lift.buttons.up);
  if (!button) return;
  const face = button.part.getObjectByName('press');
  if (!face) throw new Error('The button has no face to press');
  // (as the button is pressed, the hand where its index's pad is on the button's face)
  let off = Infinity;
  avatar.press(button.part, () => {
    lift.press(button);
    off = avatar.body.gripOn('left', face).wrist.distanceTo(avatar.body.bones.leftHand.getWorldPosition(new Vector3()));
  });
  advance(3);
  expect(off).toBeLessThan(0.01);
  advance(6);
  expect(lift.body.position.y).toBeCloseTo(foot + 2.2, 3);
  expect(avatar.pressing).toBe(false);
});
