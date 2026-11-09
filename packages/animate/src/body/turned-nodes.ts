import { MathUtils, Quaternion, Vector3, type Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import type { Goal, Placement } from '../kernel/goal';
import { bisect } from '../kernel/math';
import { within } from '../kernel/scene';
import { placedFor } from '../things/placed';
import { turners } from '../things/holder';
import type { Self } from './self';

/** how far out of a chain's full length a hand's grip on what its body turns is kept: just short of the arm straight — the elbow still
 * bent some 20°, so the arm can follow what it holds as it turns rather than being pulled off it at full stretch */
const HOLDABLE = 0.985;
/** from how far off its grip a hand on its way to it turns what it takes toward itself, fully by how near (m, default body) */
const COMING = { far: 0.15, near: 0.03 };

/**
 * The nodes on a body its app keeps turned in the world (`Body.orient`): each as asked, turned back each sub-step about the node toward
 * the shoulder of each hand holding what hangs from it, or taking hold of it, as far as brings its grip within the arm's reach — a flick
 * faster than the trunk follows waits for the trunk rather than tearing the hands off — and written into the node as the update ends.
 */
export class TurnedNodes {
  private readonly asked = new Map<Object3D, Quaternion>();
  /** each node as it is turned this sub-step */
  readonly turned = new Map<Object3D, Quaternion>();

  constructor(private readonly self: Self) {}

  /** keeps `node` turned to `rotation` in the world, its position following its parent (none: lets it go) */
  set(node: Object3D, rotation: Readonly<Quaternion> | null): void {
    const by = turners.get(node);
    if (by && by !== this) throw new Error(`orient: another body keeps "${node.name}" turned`);
    if (!rotation) {
      turners.delete(node);
      this.asked.delete(node);
      this.turned.delete(node);
      return;
    }
    this.asked.set(node, (this.asked.get(node) ?? new Quaternion()).copy(rotation));
    if (!this.turned.has(node)) this.turned.set(node, rotation.clone());
    turners.set(node, this);
  }

  /** each node turned as asked, brought within reach of the hands on it, this sub-step */
  step(f: Frame): void {
    for (const [node, asked] of this.asked) this.turned.get(node)?.copy(this.reached(f, node, _goal.copy(asked)));
  }

  /** each node's own rotation written as it is turned */
  write(): void {
    for (const [node, rotation] of this.turned) {
      node.parent?.updateWorldMatrix(true, false);
      node.quaternion.copy(node.parent ? node.parent.getWorldQuaternion(_turn).invert().multiply(rotation) : rotation);
    }
  }

  /** `turned` (`node`'s, in place) turned back about the node toward the shoulder of each hand holding what hangs from it, or taking hold
   * of it, as far as brings its grip within its arm's reach (`HOLDABLE` of its length) */
  private reached(f: Frame, node: Object3D, turned: Quaternion): Quaternion {
    const self = this.self, was = _kept.copy(this.turned.get(node) ?? turned);
    this.turned.get(node)?.copy(turned);
    const pivot = placedFor(self, node, _pivot).position;
    // (twice round the hands: the turn that brings one hand's grip within its reach moves every other grip on the node)
    for (let pass = 0; pass < 2; pass++) for (const [hand, chain] of self.species.hands ?? []) {
      const grip = this.gripOf(hand);
      if (!grip || !within(grip.thing, node)) continue;
      const bones = self.skeleton.chain(chain), shoulder = f.current.position(bones[0]);
      const reach = HOLDABLE * bones.slice(1).reduce((sum, bone) => sum + self.skeleton.bones[bone].offset.length(), 0);
      const placed = placedFor(self, grip.thing, _placed);
      const out = _out.copy(grip.goal.position).applyQuaternion(placed.quaternion).add(placed.position).sub(pivot), toward = _toward.subVectors(shoulder, pivot);
      const far = out.length(), near = toward.length();
      if (out.distanceTo(toward) <= reach || far < 1e-6 || near < 1e-6) continue;
      // (the turn about the pivot that brings the grip to the reach's edge, in the plane through it and the shoulder; for a hand still on
      // its way, only as it nears: its hand still turned as it last held something, its grip would seem farther than it is)
      const wanted = Math.acos(Math.min(1, Math.max(-1, (far * far + near * near - reach * reach) / (2 * far * near))));
      const axis = _axis.crossVectors(out, toward);
      if (axis.lengthSq() < 1e-12) continue;
      const off = grip.held ? 0 : _off.addVectors(out, pivot).distanceTo(f.current.position(bones[bones.length - 1])) / self.scale;
      turned.premultiply(_q.setFromAxisAngle(axis.normalize(), (out.angleTo(toward) - wanted) * (1 - MathUtils.smoothstep(off, COMING.near, COMING.far))));
      this.turned.get(node)?.copy(turned);
    }
    this.held(f, node, turned);
    this.turned.get(node)?.copy(was);
    return turned;
  }

  /** `turned` (`node`'s, in place) turned back toward its parent's frame as far as the hands holding what hangs from it, or taking hold of
   * it, hold their grips with their arms clear of the body (`Self.holds`), if they hold them so there: else, held off its grip, a hand
   * would pass through what it held, or its arm through the trunk */
  private held(f: Frame, node: Object3D, turned: Quaternion): void {
    const self = this.self, rest = node.parent && placedFor(self, node.parent, _rest).quaternion;
    const holds = (rotation: Quaternion) => {
      this.turned.get(node)?.copy(rotation);
      return Object.keys(self.holding).every((hand) => {
        const grip = this.gripOf(hand);
        if (!grip || !within(grip.thing, node)) return true;
        const { thing, goal } = grip, placed = placedFor(self, thing, _placed);
        const position = _wrist.copy(goal.position).applyQuaternion(placed.quaternion).add(placed.position);
        return self.holds(f, hand, { position, quaternion: goal.quaternion && _grip.copy(placed.quaternion).multiply(goal.quaternion) });
      });
    };
    if (!rest || holds(turned) || !holds(rest)) return;
    // (the furthest toward `turned` from its parent's frame that they hold, halved in on)
    const asked = _asked.copy(turned);
    turned.slerpQuaternions(rest, asked, bisect((t) => holds(_try.slerpQuaternions(rest, asked, t)), 0, 1, 8));
  }

  /** what hand `hand` holds or is taking hold of, and its wrist's goal on it (the thing's frame), if anything */
  private gripOf(hand: string): { thing: Object3D; goal: Goal; held: boolean } | null {
    const held = this.self.holding[hand], hold = held ?? this.self.coming[hand];
    return hold ? { thing: hold.thing.object, goal: hold.goal, held: held !== null } : null;
  }
}

const _turn = new Quaternion(), _q = new Quaternion(), _kept = new Quaternion(), _goal = new Quaternion();
const _placed: Placement = { position: new Vector3(), quaternion: new Quaternion() }, _pivot: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const _out = new Vector3(), _toward = new Vector3(), _axis = new Vector3(), _off = new Vector3(), _wrist = new Vector3();
const _rest: Placement = { position: new Vector3(), quaternion: new Quaternion() }, _grip = new Quaternion(), _asked = new Quaternion(), _try = new Quaternion();
