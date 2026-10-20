import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { grab, handTo, hold, INDEX, facingAt, release, wear, yawOf, type Behaviour, type Frame, type Item, type Placement } from '@drawcall/animate';
import { slideIn } from './gauntlets';
import { along, at, busy, eyesOn, take, turn, type Knight } from './knight';

// Shield and lance: taken up and borne.

type F = Frame;

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
export function takeShield(k: Knight, shield: Item): Behaviour {
  const steady = hold(k.h, shield);
  return function* () {
    // Both grips must be in reach, with room between the shield's face and the sword at the hip.
    const aside = (shield.grips.enter.position.x - shield.grips.edge.position.x) / 2;
    yield* take(k, { right: [shield, 'edge'] }, { face: yawOf(shield.current.quaternion) + Math.PI, spot: { aside } })();
    yield* eyesOn(k, () => shield.current.position, () => parallel<F>('race', slideIn(k, 'left', shield, 'enter', 'grip'), steady))();
    yield* wear(k.h, shield, INDEX.leftLowerArm)();
    yield* grab(k.h, { left: [shield, 'grip'] }, { walk: false, look: false })();
    // Clear the peg into the same body-relative pose used while walking.
    yield* parallel<F>('race', busy(k, release(k.h, ['right'], { away: { right: new Vector3(-0.3, -0.15, -0.15) } })), bearShield(k));
  };
}

/** how the fist bearing the shield goes along with the body (m/s², m/s): briskly, with the hips as they bob and turn walking */
const BORNE = { accel: 30, speed: 3 };

/** the shield borne on the left arm across the belly: endless */
export const bearShield = (k: Knight): Behaviour => handTo(k.h, 'left', facingAt(k.h, INDEX.hips, FIST), BORNE);

/**
 * the lance borne upright in the right hand, the fist by the right side at the lower ribs (pulled in:
 * its natural carry has the fist 22 cm ahead of the hips, but `balance` leaves the centre of mass
 * a little ahead under a load in front; its rewrite handles that, and then the lance goes back out)
 */
const UPRIGHT = at(-0.27, 0.3, 0.1, new Quaternion());

/** The lance out of its rack: the right hand takes it (the lance ahead of the right shoulder: the head clear of the shaft), lifts it out of its socket and brings it in upright by the right side. Then bear it (`bearLance`). */
export function takeLance(k: Knight, lance: Item): Behaviour {
  const lift = (_f: Frame, s: Required<Placement>) => at(s.position.x, s.position.y + 0.1, s.position.z);
  return function* () {
    yield* take(k, { right: [lance, 'grip'] }, { spot: { aside: -0.22 } })();
    yield* along(k, lance, [[0.6, lift], [1.2, UPRIGHT]], { frame: facingAt(k.h, INDEX.hips, { position: new Vector3() }) })();
  };
}

/** the lance borne upright by the right side: endless */
export const bearLance = (k: Knight, lance: Item): Behaviour => hold(k.h, lance, { to: facingAt(k.h, INDEX.hips, UPRIGHT) });
