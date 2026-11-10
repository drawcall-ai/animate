import { Object3D, Quaternion, Vector3 } from 'three';
import { nameOf } from './species/define';
import { selfOf, type Body } from './body';
import type { Self } from './body/self';
import type { HandShape } from './fingers/shape';
import { handPlanOf, pointOf } from './person/hands/plan';
import { handOn, type HandPlacement } from './fingers/placement';
import { toWorld, worldOf } from './kernel/scene';
import { Thing } from './things/thing';
import { personOf } from './verbs/person-of';

// For a body its app poses itself, its update stopped (what no verb does: sitting, climbing): where its hands go, and how its fingers shape.

/**
 * The placement hand `side` takes the grip `empty` by (its thing the empty's parent): what the grip leaves free fixed as a grab fixes it,
 * from where the body stood at its last update. Hand it to `gripOn` and `shapeHand`: asked again before the body's next update, it is the
 * same placement, so a hand holds a grip the same however the app has posed the body since; after an update it is picked afresh.
 */
export function placement(body: Body, side: 'left' | 'right', empty: Object3D): HandPlacement {
  const thing = empty.parent;
  if (!thing) throw new Error(`placement: "${empty.name}" hangs from nothing`);
  const self = personOf(body, 'placement'), kept = picked[side].get(empty);
  if (kept?.updates === self.updates && kept.self === self) return kept.placement;
  const chosen = handPlanOf(self, side, Thing.of(thing), empty.name).placement;
  picked[side].set(empty, { self, updates: self.updates, placement: chosen });
  return chosen;
}

/** each hand's placements `placement` picked, by grip: for which body, at how many of its updates */
const picked = { left: new WeakMap<Object3D, Kept>(), right: new WeakMap<Object3D, Kept>() };
interface Kept { self: Self; updates: number; placement: HandPlacement }

/**
 * Eases hand `side`'s fingers `seconds` on toward `to` and writes them (a puppet: its update stopped, the two would fight): the placement
 * the hand is on or on its way to, opening as it comes and, once the wrist is where `gripOn` puts it, taking the shape the placement asks
 * (closed round its thing's meshes as the placement has the hand there, or held); a shape; or relaxed for `null`. Call it every frame
 * after posing the hand. A skeleton without finger bones is a misuse.
 */
export function shapeHand(body: Body, side: 'left' | 'right', to: HandPlacement | HandShape | null, seconds: number): void {
  fingersOf(body).set(side, to, seconds);
}

/** Where hand `side` goes for `placement`: the wrist, and the world rotation to give the hand bone (`bones.leftHand`) — the placement's
 * point of the hand on its target, turned as it asks. A hand without finger bones is placed by a nominal one's point, as a grab places it. */
export function gripOn(body: Body, side: 'left' | 'right', on: HandPlacement): { wrist: Vector3; rotation: Quaternion } {
  const fingers = selfOf(body).fingers;
  if (fingers) return fingers.gripOn(side, on);
  const self = personOf(body, 'gripOn'), bone = self.hands[side], hand = handOn(pointOf(self, side, on.point), on);
  const at = toWorld({ position: hand.position, quaternion: hand.quaternion.multiply(self.restOf(bone)) }, worldOf(on.on));
  return { wrist: at.position, rotation: at.quaternion };
}

/** the fingers of `body`; a skeleton without finger bones has none, a misuse said at once */
function fingersOf(body: Body): NonNullable<Self['fingers']> {
  const fingers = selfOf(body).fingers;
  if (!fingers) throw new Error(`fingers: a ${nameOf(body.species)} skeleton has no finger bones`);
  return fingers;
}
