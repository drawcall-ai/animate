import { Quaternion, Vector3 } from 'three';
import { action, parallel, type ReusableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '../../core/body';
import { INDEX, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { middleJoint } from '../procedures/legs';
import type { Effector } from '../status';
import { intend } from './follow';

/** how stiffly a hand follows its target (Hz): a held thing goes where it is carried */
const HAND_STIFFNESS = 60;
/** how strongly the elbow is placed where the arm's plane puts it (a weak hint: the hand's target leaves its swivel open) */
const ELBOW = 0.3;

const ORIGIN = new Vector3();
const _shoulder = new Vector3();
const _dl = new Vector3();
const _pole = new Vector3();
const _w = new Vector3();
const _elbow = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();
const _goal = new Vector3();
/** the arm's joints a hand target claims: not the clavicle, which stays as it rests (light, the solve would shrug it into its stop first) */
const ARM = ['UpperArm', 'LowerArm', 'Hand'] as const;

/**
 * Reaching with hand `side` for its target (the wrist, and the hand's turn when given), every
 * frame: the hand pulled there, a part weight part of the way from where it was (so a weight
 * ramping in is a reach), its arm claimed from the relaxed pose and the swing; the elbow
 * swivelled as the hand's place asks; reported in the intent.
 */
export function reach<W>(h: Humanoid<W>, side: Side, target: (ctx: Ctx<W>) => Readonly<Effector>): ReusableTimeline<Ctx<W>> {
  const p = h.proportions;
  const sign = side === 'left' ? 1 : -1;
  const hand = INDEX[`${side}Hand`];
  const upper = INDEX[`${side}UpperArm`];
  const chest = INDEX.chest;
  const axis = p.offsets[`${side}LowerArm`].clone().normalize();
  // (the hand's target takes its arm from the relaxed pose and the swing)
  const claims = ARM.map((b) => INDEX[`${side}${b}`]);
  return function* () {
    // (where the hand was as the reach began: a part weight goes part of the way from there)
    const from = new Vector3();
    yield* parallel<Ctx<W>>(
      'all',
      intend(h, `${side}Hand`, target),
      action<Ctx<W>>({
        update: (ctx) => {
          const t = target(ctx);
          if (t.weight <= 0) {
            from.copy(ctx.body.positions[hand]);
            return;
          }
          const goal = _goal.lerpVectors(from, t.position, t.weight);
          h.hints.armSwing(ctx.time, 0);
          ctx.propose.target({ kind: 'position', point: { bone: hand, at: ORIGIN }, value: goal, weight: 1, stiffness: HAND_STIFFNESS, claims, owner: 'reach' });
          if (t.quaternion) ctx.propose.target({ kind: 'orientation', point: { bone: hand, at: ORIGIN }, value: t.quaternion, weight: t.weight, stiffness: HAND_STIFFNESS, claims, owner: 'reach' });
          // the elbow: a blend of where it goes for a hand hanging, forward, up, out and across
          // (copied from the old core, a801be4:packages/core/src/limbs/arms.ts), in the chest's frame
          const shoulder = _shoulder.copy(ctx.body.positions[upper]);
          const qChest = _q.copy(ctx.body.rotations[chest]);
          const dl = _dl.subVectors(goal, shoulder).normalize().applyQuaternion(_qi.copy(qChest).invert());
          dl.x *= sign;
          _pole
            .set(0.12, 0, -1)
            .multiplyScalar(Math.max(0, -dl.y))
            .addScaledVector(_w.set(0.4, -1, -0.15), Math.max(0, dl.z))
            .addScaledVector(_w.set(0.12, -0.15, 1), Math.max(0, dl.y))
            .addScaledVector(_w.set(0, -1, -0.4), Math.max(0, dl.x))
            .addScaledVector(_w.set(0.7, -0.6, 0), Math.max(0, -dl.x));
          _pole.x *= sign;
          _pole.applyQuaternion(qChest);
          const elbow = middleJoint(shoulder, _w.copy(goal), p.upperArm, p.forearm, _pole, _elbow);
          ctx.propose.target({ kind: 'aim', point: { bone: upper, at: ORIGIN }, axis, value: elbow, weight: ELBOW * t.weight, stiffness: HAND_STIFFNESS, owner: 'reach' });
        },
      }),
    );
  };
}

/** Carrying something in both hands: each hand on its target (`left`, `right`), together. */
export function carry<W>(h: Humanoid<W>, hands: { left: (ctx: Ctx<W>) => Readonly<Effector>; right: (ctx: Ctx<W>) => Readonly<Effector> }): ReusableTimeline<Ctx<W>> {
  return function* () {
    yield* parallel<Ctx<W>>('all', reach(h, 'left', hands.left), reach(h, 'right', hands.right));
  };
}
