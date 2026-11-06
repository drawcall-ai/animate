import { Quaternion, Vector3, type Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import type { Placement } from '../kernel/goal';
import { smoothstep } from '../kernel/math';
import { within } from '../kernel/scene';
import { oriented, resolve } from '../things/resolve';
import type { Self } from './runtime';

/** how far out of a chain's full length a hand's grip on what its body turns is kept: just within its reach (`REACH`) */
const HOLDABLE = 0.975;
/** from how far off its grip a hand on its way to it turns what it takes toward itself, fully by how near (m, default body) */
const COMING = { far: 0.15, near: 0.03 };

/**
 * The nodes on a body its app keeps turned in the world (`Body.orient`): each as asked, turned back each sub-step about the node toward
 * the shoulder of each hand holding what hangs from it, or taking hold of it, as far as brings its grip within the arm's reach — a flick
 * faster than the trunk follows waits for the trunk rather than tearing the hands off — and written into the node as the update ends.
 */
export class Orient {
  private readonly asked = new Map<Object3D, Quaternion>();
  private readonly turned = new Map<Object3D, Quaternion>();

  constructor(private readonly self: Self) {}

  /** keeps `node` turned to `rotation` in the world, its position following its parent (none: lets it go) */
  set(node: Object3D, rotation: Readonly<Quaternion> | null): void {
    if (!rotation) {
      oriented.delete(node);
      this.asked.delete(node);
      this.turned.delete(node);
      return;
    }
    this.asked.set(node, (this.asked.get(node) ?? new Quaternion()).copy(rotation));
    const turned = this.turned.get(node) ?? rotation.clone();
    oriented.set(node, turned);
    this.turned.set(node, turned);
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
    const pivot = resolve(self, node, _pivot).position;
    for (let pass = 0; pass < 2; pass++) for (const [hand, chain] of self.species.hands ?? []) {
      const hold = self.holding[hand], side = hand as 'left' | 'right', coming = hold ? null : self.fingers?.coming(side);
      const thing = hold?.thing.object ?? coming?.thing, goal = hold ? hold.goal.position : coming?.wrist;
      if (!thing || !goal || !within(thing, node)) continue;
      const bones = self.skeleton.chain(chain), shoulder = f.current.position(bones[0]);
      const reach = HOLDABLE * bones.slice(1).reduce((sum, bone) => sum + self.skeleton.bones[bone].offset.length(), 0);
      const placed = resolve(self, thing, _placed);
      const out = _out.copy(goal).applyQuaternion(placed.quaternion).add(placed.position).sub(pivot), toward = _toward.subVectors(shoulder, pivot);
      const far = out.length(), near = toward.length();
      if (out.distanceTo(toward) <= reach || far < 1e-6 || near < 1e-6) continue;
      // (the turn about the pivot that brings the grip to the reach's edge, in the plane through it and the shoulder; for a hand still on
      // its way, only as it nears: its hand still turned as it last held something, its grip would seem farther than it is)
      const wanted = Math.acos(Math.min(1, Math.max(-1, (far * far + near * near - reach * reach) / (2 * far * near))));
      const axis = _axis.crossVectors(out, toward);
      if (axis.lengthSq() < 1e-12) continue;
      const off = hold ? 0 : _off.addVectors(out, pivot).distanceTo(f.current.position(bones[bones.length - 1])) / self.scale;
      turned.premultiply(_q.setFromAxisAngle(axis.normalize(), (out.angleTo(toward) - wanted) * (1 - smoothstep(COMING.near, COMING.far, off))));
      this.turned.get(node)?.copy(turned);
    }
    this.turned.get(node)?.copy(was);
    return turned;
  }
}

const _turn = new Quaternion(), _q = new Quaternion(), _kept = new Quaternion(), _goal = new Quaternion();
const _placed: Placement = { position: new Vector3(), quaternion: new Quaternion() }, _pivot: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const _out = new Vector3(), _toward = new Vector3(), _axis = new Vector3(), _off = new Vector3();
