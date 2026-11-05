import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { gripping, heights } from '../src/ladder/climbing';
import { STILE, createLadder } from '../src/ladder/model';
import { box, DT, jerkless, mountable } from './course';

/** A ladder climbing toward +Z up to a landing 2.4 m up, and a soldier a step from its `end` who can climb it. */
async function yard(end: 'foot' | 'top' = 'foot') {
  const scene = new Scene();
  box(scene, [30, 1, 30], [0, -0.5, 0], 'static', 'Ground');
  box(scene, [3, 0.3, 3], [0, 2.25, 1.68], 'static', 'Landing');
  const ladder = createLadder(2.4);
  scene.add(ladder.body);
  const spot = ladder.marks[end].getWorldPosition(new Vector3());
  const yard = await mountable(scene, spot.add(new Vector3(0.6, 0.02, end === 'foot' ? -0.6 : 0.6)), () => ({ ladder }));
  const climber = yard.soldier.climber;
  if (!climber) throw new Error('The soldier has no ladder');
  return { ...yard, climber };
}

/** How far `point` (in the ladder's frame) is from the nearest rung (m). */
function offRung(point: Vector3, spacing: number) {
  const rung = new Vector3(Math.max(-STILE, Math.min(STILE, point.x)), Math.round(point.y / spacing) * spacing, 0);
  return point.distanceTo(rung);
}

describe('Climber', () => {
  it('climbs up with its rifle slung, its hands and feet on the rungs, and steps off onto the landing taking its rifle back', async () => {
    const { ladder, soldier, climber, until, heard } = await yard();
    expect(climber.near).toBe(true);
    const bones = soldier.avatar.body.bones, smooth = jerkless(soldier.avatar.rifle);
    climber.mount();
    // (straight on from the walk up, without waiting at the foot, and on at once: each move heard as it ends)
    expect(until(() => smooth() && climber.state === 'mounting', 3)).toBeLessThan(2);
    heard.length = 0;
    expect(until(() => smooth() && climber.state === 'on', 2)).toBeLessThan(1.3);
    expect(heard).toEqual(['cloth', 'rung', 'rung', 'rung', 'rung']);
    expect(soldier.avatar.rifle.parent).toBe(bones.chest);

    // On, each hand holds a rung as its grasp has it, its wrist where that puts it, and each ankle is just above and behind one.
    for (const side of ['left', 'right'] as const) {
      const at = (bone: 'Hand' | 'Foot') => ladder.body.worldToLocal(bones[`${side}${bone}`].getWorldPosition(new Vector3()));
      const wrist = bones[`${side}Hand`].getWorldPosition(new Vector3());
      const holds = ladder.body.children.filter((child) => child.name.startsWith(`${side} hand on rung`));
      const nearest = Math.min(...holds.map((hold) => soldier.avatar.body.gripOn(side, hold).wrist.distanceTo(wrist)));
      expect(nearest).toBeLessThan(0.01);
      expect(offRung(at('Foot'), ladder.spacing)).toBeLessThan(0.12);
    }

    climber.climb(1);
    heard.length = 0;
    const rifle = () => soldier.avatar.rifle;
    until(() => climber.state === 'dismounting', 10);
    // (a hand and a foot onto a rung each rung climbed, each limb every other rung)
    const climbed = Math.round((2.4 - 2 * ladder.spacing) / ladder.spacing);
    expect(heard.filter((sound) => sound === 'rung').length).toBeGreaterThanOrEqual(2 * (climbed - 1));
    // (getting off readies a fresh body with its own rifle off screen, a few frames)
    const posed = rifle();
    expect(until(() => rifle() !== posed, 0.5)).toBeLessThan(0.15);
    const out = jerkless(rifle());
    until(() => out() && climber.state === 'off', 4);
    expect(out.jerk).toBeLessThan(0.02);
    expect(smooth.jerk).toBeLessThan(0.02);
    expect(soldier.avatar.acquired).toBe(true);
    expect(soldier.movement.grounded).toBe(true);
    expect(soldier.movement.position.y).toBeCloseTo(2.4, 1);
  });

  it('climbs hand over hand, each hand two rungs on past the other\'s with the opposite foot', () => {
    const ladder = createLadder(2.4), { foot, top } = heights(ladder);
    const held = { left: [] as number[], right: [] as number[] };
    for (let height = foot; height <= top; height += 0.005) {
      const [left, rightFoot, right, leftFoot] = gripping(ladder, height);
      expect(left.grips).toBe(rightFoot.grips);
      expect(right.grips).toBe(leftFoot.grips);
      // (the rungs, below the stiles' holds above the landing)
      if (left.rung <= ladder.rungs && right.rung <= ladder.rungs) expect(left.rung).not.toBe(right.rung);
      for (const hand of [left, right]) if (hand.rung <= ladder.rungs && held[hand.side].at(-1) !== hand.rung) held[hand.side].push(hand.rung);
    }
    for (const rungs of Object.values(held)) {
      expect(rungs.length).toBeGreaterThan(1);
      expect(rungs.slice(1).map((rung, k) => rung - rungs[k])).toEqual(rungs.slice(1).map(() => 2));
    }
  });

  it('gets on from the landing and climbs down to the foot', async () => {
    const { soldier, climber, until } = await yard('top');
    climber.mount();
    until(() => climber.state === 'on', 10);
    climber.climb(-1);
    until(() => climber.state === 'off', 12);
    expect(soldier.movement.grounded).toBe(true);
    expect(soldier.movement.position.y).toBeCloseTo(0, 1);
  });

  it('falls off as a ragdoll when killed on the ladder', async () => {
    const { world, soldier, climber, until } = await yard();
    climber.mount();
    until(() => climber.state === 'on', 10);
    soldier.hurt(100, soldier.avatar.body.bones.chest.getWorldPosition(new Vector3()), new Vector3(0, 0, -1));
    expect(climber.state).toBe('off');
    for (let frame = 0; frame < 120; frame++) world.update(DT);
    expect(soldier.look().eye.y).toBeLessThan(1);
  });
});
