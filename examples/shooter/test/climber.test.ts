import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { gripping, heights } from '../src/ladder/climbing';
import { STILE, createLadder } from '../src/ladder/model';
import { box, DT, jerkless, mountable } from './course';
import { gripOn, placement } from '@drawcall/animate/puppet';

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
    const { world, ladder, soldier, climber, until, heard } = await yard();
    expect(climber.near).toBe(true);
    const bones = soldier.avatar.body.bones, smooth = jerkless(soldier.avatar.rifle);
    climber.mount();
    // (straight on from the walk up, without waiting at the foot, and on at once: each move heard as it ends, the left hand onto its rung
    // before the right slings the rifle, the right foot stepping in to the ladder's foot and the left up onto the first rung)
    expect(until(() => smooth() && climber.state === 'mounting', 3)).toBeLessThan(2);
    heard.length = 0;
    // (its muzzle kept this side of the rungs as it steps in)
    let muzzle = -Infinity;
    const ahead = () => { muzzle = Math.max(muzzle, ladder.body.worldToLocal(soldier.avatar.muzzle.getWorldPosition(new Vector3())).z); };
    expect(until(() => { ahead(); return smooth() && climber.state === 'on'; }, 3)).toBeLessThan(1.9);
    expect(heard).toEqual(['rung', 'cloth', 'step-b', 'rung', 'rung']);
    expect(muzzle).toBeLessThan(0);
    expect(soldier.avatar.rifle.parent).toBe(bones.chest);

    // On, each hand holds a rung as its grasp has it, its wrist where that puts it, and each ankle is just above and behind one.
    const holding = () => (['left', 'right'] as const).every((side) => {
      const foot = ladder.body.worldToLocal(bones[`${side}Foot`].getWorldPosition(new Vector3()));
      const wrist = bones[`${side}Hand`].getWorldPosition(new Vector3());
      const holds = ladder.body.children.filter((child) => child.name.startsWith(`${side} hand on rung`));
      const nearest = Math.min(...holds.map((hold) => gripOn(soldier.avatar.body, side, placement(soldier.avatar.body, side, hold)).wrist.distanceTo(wrist)));
      return nearest < 0.01 && offRung(foot, ladder.spacing) < 0.12;
    });
    expect(holding()).toBe(true);
    // (let go of mid-stride, it climbs on until all four hold, and stays there)
    climber.climb(1);
    until(() => !holding(), 1);
    climber.climb(0);
    expect(until(holding, 1)).toBeLessThan(0.7);
    const still = () => {
      const chest = bones.chest.getWorldPosition(new Vector3());
      for (let frame = 0; frame < 20; frame++) world.update(DT);
      return bones.chest.getWorldPosition(new Vector3()).distanceTo(chest);
    };
    still();
    expect(holding()).toBe(true);
    expect(still()).toBeLessThan(0.002);

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
    // (each move: the limb, and the rungs it went from and to, below the stiles' holds above the landing)
    const moves: { limb: string; by: number }[] = [], was = new Map<string, number>();
    for (let height = foot; height <= top; height += 0.005) {
      const limbs = gripping(ladder, height), [left, rightFoot, right, leftFoot] = limbs;
      expect(left.grips).toBe(rightFoot.grips);
      expect(right.grips).toBe(leftFoot.grips);
      if (left.rung <= ladder.rungs && right.rung <= ladder.rungs) expect(left.rung).not.toBe(right.rung);
      expect(leftFoot.rung).not.toBe(rightFoot.rung);
      for (const { side, kind, rung } of limbs) {
        const limb = `${side} ${kind}`, from = was.get(limb);
        if (rung > ladder.rungs) continue;
        if (from !== undefined && from !== rung) moves.push({ limb, by: rung - from });
        // (a hand on past the other's, to the rung above it)
        if (kind === 'hand' && from !== undefined && from !== rung) expect(rung).toBe((side === 'left' ? right : left).rung + 1);
        was.set(limb, rung);
      }
    }
    for (const kind of ['hand', 'foot']) {
      const own = moves.filter(({ limb }) => limb.endsWith(kind));
      expect(own.length).toBeGreaterThan(2);
      // (two rungs a move, the left and the right by turns)
      expect(own.map(({ by }) => by)).toEqual(own.map(() => 2));
      own.slice(1).forEach(({ limb }, k) => expect(limb).not.toBe(own[k].limb));
    }
  });

  it('gets on from the landing, its thumbs round the stiles opposite its fingers, and climbs down to the foot', async () => {
    const { ladder, soldier, climber, until } = await yard('top');
    climber.mount();
    until(() => climber.state === 'on', 10);
    // (each hand on its stile's highest hold, under the bend at its head: the fingers round one face of the flat bar, the thumb round the
    // other, as each hand has them the same)
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1, tip = (finger: string) => soldier.avatar.body.object.getObjectByName(`${side}${finger}Distal_end`);
      const out = (finger: string) => sign * (ladder.body.worldToLocal(tip(finger)?.getWorldPosition(new Vector3()) ?? new Vector3(NaN)).x - sign * STILE);
      expect(out('Thumb')).toBeLessThan(0);
      for (const finger of ['Index', 'Middle', 'Ring', 'Little']) expect(out(finger), `${side} ${finger}`).toBeGreaterThan(0);
    }
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
