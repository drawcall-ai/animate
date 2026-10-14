import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { closeHand, handTo, hold, INDEX, onBone, release, wear, yawOf, type Behaviour, type Frame, type Item, type Placement, type World } from '@drawcall/animate';
import { forwardOf } from '../../math';
import { slideIn } from './gauntlets';
import { along, at, busy, eyesOn, facingAt, take, turn, type Knight } from './knight';

// Shield and lance: taken up and borne.

type F = Frame<World>;

/**
 * the left fist on the shield's grip as the shield is borne (in the hips' frame, facing as the body
 * does): on the forearm across the belly, the fist before the navel, thumb up, the shield's face
 * turned out to the front and left
 */
const FIST = at(0.1, 0.16, 0.32, turn(0, Math.PI + 0.35, 0).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)));

/**
 * The shield off the wall, where it hangs on a peg by its strap, its back to the room: facing it
 * (the way its back faces away), the right hand steadies it by its edge, the left arm goes through
 * the strap to the grip; worn on the left forearm, the right hand lets go and the left fist lifts
 * it off the peg and draws it back. Then bear it (`bearShield`).
 */
export function takeShield(k: Knight, shield: Item): Behaviour<World> {
  const steady = hold(k.h, shield, { right: 'edge' });
  return function* () {
    yield* take(k, { right: [shield, 'edge'] }, { face: yawOf(shield.current.quaternion) + Math.PI })();
    yield* eyesOn(k, () => shield.current.position, () => parallel<F>('race', slideIn(k, 'left', shield, 'enter', 'grip'), steady), 0)();
    yield* wear(k.h, shield, INDEX.leftLowerArm)();
    yield* closeHand(k.h, 'left', shield, 'grip')();
    // (the right hand off to the side and down, out of the shield's way; then the shield up off the peg and back off the wall)
    const fist = { position: k.h.pose.position(INDEX.leftHand).clone(), quaternion: k.h.pose.rotation(INDEX.leftHand).clone() };
    yield* parallel<F>('race', busy(k, release(k.h, ['right'], { away: { right: new Vector3(-0.3, -0.15, -0.15) } })), handTo(k.h, 'left', fist));
    fist.position.addScaledVector(UP, 0.05).addScaledVector(forwardOf(k.h.gait.facing), -0.08);
    yield* handTo(k.h, 'left', fist, { until: 'reached' })();
  };
}

/** the shield borne on the left arm across the belly: endless */
export const bearShield = (k: Knight): Behaviour<World> => handTo(k.h, 'left', onBone(k.h, INDEX.hips, FIST, { facing: true }));

/** the lance borne upright in the right hand, the fist by the right side at the lower ribs */
const UPRIGHT = at(-0.27, 0.3, 0.1, new Quaternion());

/** The lance out of its rack: the right hand takes it (the lance ahead of the right shoulder: the head clear of the shaft), lifts it out of its socket and brings it in upright by the right side. Then bear it (`bearLance`). */
export function takeLance(k: Knight, lance: Item): Behaviour<World> {
  const lift = (s: Required<Placement>) => at(s.position.x, s.position.y + 0.1, s.position.z);
  return function* () {
    yield* take(k, { right: [lance, 'grip'] }, { stand: { aside: -0.22 } })();
    yield* along(k, facingAt(k, 'hips'), [[lance, { right: 'grip' }, [[0.6, lift], [1.2, UPRIGHT]]]])();
  };
}

/** the lance borne upright by the right side: endless */
export const bearLance = (k: Knight, lance: Item): Behaviour<World> => hold(k.h, lance, { right: 'grip' }, { to: onBone(k.h, INDEX.hips, UPRIGHT, { facing: true }) });

const UP = new Vector3(0, 1, 0);
