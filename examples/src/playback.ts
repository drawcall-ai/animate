import { Box3, Quaternion, Vector3, type Object3D } from 'three';
import type { Body } from '@drawcall/animate';
import type { Look } from './scenario';
import { isPerson, type Simulation } from './simulation';

/** the height the camera looks at over a person's travel, above the floor (y = 0; × its standing height): about the hips, but not bobbing with them */
const FOCUS_HEIGHT = 0.54;

/** The run's scene graph as a step left it: every node under the scene, its parent and its local position and rotation. */
class Snapshot {
  readonly nodes: Object3D[] = [];
  readonly parents: (Object3D | null)[] = [];
  /** each node's position and quaternion (7 numbers) */
  values = new Float64Array(0);
  /** each node's index */
  readonly index = new Map<Object3D, number>();

  /** the scene as it stands now */
  take(scene: Object3D) {
    this.nodes.length = this.parents.length = 0;
    this.index.clear();
    scene.traverse((node) => {
      if (node === scene) return;
      this.index.set(node, this.nodes.length);
      this.nodes.push(node);
      this.parents.push(node.parent);
    });
    if (this.values.length < 7 * this.nodes.length) this.values = new Float64Array(7 * this.nodes.length * 2);
    this.nodes.forEach((node, i) => {
      node.position.toArray(this.values, 7 * i);
      node.quaternion.toArray(this.values, 7 * i + 3);
    });
  }

  /** the nodes as they were taken */
  show() {
    this.nodes.forEach((node, i) => {
      node.position.fromArray(this.values, 7 * i);
      node.quaternion.fromArray(this.values, 7 * i + 3);
    });
  }
}

/**
 * A simulation shown at display rate. The sim runs at a fixed 60 Hz; displays often refresh faster (120 Hz), so what's shown is
 * interpolated between the last two steps — otherwise the bodies move only on some frames while the camera glides every frame, which
 * reads as stutter ("Fix Your Timestep"). What is shown is the run's scene graph: each node's local position and rotation blended
 * between the two steps while its parent stayed the same (a thing taken into a hand or set down shows where it is now). Each step starts
 * from the exact state the last one left, so the simulation is the same however it is shown.
 */
export class Playback {
  private previous = new Snapshot();
  private current = new Snapshot();
  private readonly previousFocus = new Vector3();
  /** the player's look after the previous and the current step, if there is a player */
  private previousLook: Look | null = null;
  private currentLook: Look | null = null;

  constructor(readonly sim: Simulation) {
    this.record();
    this.remember();
  }

  /** one fixed step, remembering the state it started from */
  step() {
    this.restore();
    this.remember();
    this.sim.step();
    this.record();
  }

  /** runs forward to `t`, showing only its last step */
  advanceTo(t: number) {
    this.restore();
    this.sim.advanceTo(t);
    this.record();
    this.remember();
  }

  /** shows the scene `alpha` (0..1) of the way from the previous step to the current one; the camera's focus and the player's look then */
  blend(alpha: number): { focus: Vector3; look: Look | null } {
    const { previous, current } = this;
    const a = previous.values, b = current.values;
    current.nodes.forEach((node, i) => {
      const k = 7 * i, was = previous.index.get(node);
      if (was === undefined || previous.parents[was] !== current.parents[i]) return;
      const j = 7 * was;
      node.position.set(a[j] + (b[k] - a[j]) * alpha, a[j + 1] + (b[k + 1] - a[j + 1]) * alpha, a[j + 2] + (b[k + 2] - a[j + 2]) * alpha);
      node.quaternion.fromArray(a, j + 3).slerp(_q.fromArray(b, k + 3), alpha);
    });
    const focus = this.previousFocus.clone().lerp(this.focus(), alpha);
    const [from, to] = [this.previousLook, this.currentLook];
    // (the look blended as the rifle placed in it is: the camera and the rifle shown at the same instant)
    const look = from && to && { eye: from.eye.clone().lerp(to.eye, alpha), yaw: from.yaw + (to.yaw - from.yaw) * alpha, pitch: from.pitch + (to.pitch - from.pitch) * alpha };
    return { focus, look };
  }

  /** the scene as the last step left it (its world matrices too: the run reads them) */
  private restore() {
    this.current.show();
    this.sim.stage.scene.updateMatrixWorld(true);
  }

  /** the scene's state is the current one */
  private record() {
    this.current.take(this.sim.stage.scene);
    // (copied: a player keeps its look's vectors)
    const look = this.sim.stage.player?.look();
    this.currentLook = look ? { ...look, eye: look.eye.clone() } : null;
  }

  /** the current state is where the next blend starts */
  private remember() {
    [this.previous, this.current] = [this.current, this.previous];
    this.current.take(this.sim.stage.scene);
    this.previousLook = this.currentLook;
    this.previousFocus.copy(this.focus());
  }

  /** the body the shots follow: the first */
  private get subject(): Body {
    const body = this.sim.stage.bodies[0];
    if (!body) throw new Error(`${this.sim.scenario.id} has no body to show`);
    return body;
  }

  /** how the first body moves over the floor (m/s) */
  get velocity(): Vector3 {
    return this.subject.velocity;
  }

  /** the way the first body faces (rad) */
  get facing(): number {
    return this.subject.facing;
  }

  /** where every body's joints are, with a margin for what lies beyond them */
  get bounds(): Box3 {
    const bounds = new Box3();
    for (const body of this.sim.stage.bodies) for (let i = 0; i < body.pose.skeleton.bones.length; i++) bounds.expandByPoint(body.pose.position(i));
    // Tuned 20 cm silhouette allowance beyond joints (head, barrel, hands and feet).
    return bounds.expandByScalar(0.2);
  }

  /** what the camera looks at: over the first body's travel (people and creatures together: the middle of them all) */
  private focus(): Vector3 {
    const { bodies } = this.sim.stage;
    if (bodies.some(isPerson) && !bodies.every(isPerson)) return this.bounds.getCenter(new Vector3());
    const body = this.subject;
    return body.position.setY(body.species.person ? FOCUS_HEIGHT * body.species.person.height : body.species.bones[0].position[1]);
  }
}

const _q = new Quaternion();
