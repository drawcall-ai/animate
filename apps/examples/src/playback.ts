import { Bone, Quaternion, Vector3, type Object3D } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { Simulation, type Prop, type Scenario } from './scenario';

/** the height the camera looks at over the body's travel path (m) */
const FOCUS_HEIGHT = 0.95;

/**
 * A simulation shown at display rate. The sim runs at a fixed 60 Hz; displays often refresh
 * faster (120 Hz), so what's shown is interpolated between the last two steps — otherwise the
 * body moves only on some frames while the camera glides every frame, which reads as stutter
 * ("Fix Your Timestep"). The actors' models show the blend; each step starts from the exact
 * state the last one left, so the simulation is the same however it is shown.
 */
export class Playback {
  readonly sim: Simulation;
  /** what the humanoids pose: each model's scene and bones (not viverse's hidden rest copy; glTF-style models, not VRMs) */
  private readonly nodes: Object3D[] = [];
  /** the nodes' positions and quaternions (7 numbers each) after the previous and the current step */
  private readonly prev: Float64Array;
  private readonly current: Float64Array;
  /** the props after the previous and the current step (as the models stood then: held ones are in the hands) */
  private prevProps: Prop[] = [];
  private currentProps: Prop[] = [];
  private readonly prevRoot = new Vector3();

  constructor(scenario: Scenario, model?: () => CharacterModel) {
    this.sim = new Simulation(scenario, model);
    for (const { model } of this.sim.actors) {
      this.nodes.push(model.scene);
      model.scene.traverse((o) => {
        if (o instanceof Bone && !o.name.startsWith('rest_')) this.nodes.push(o);
      });
    }
    this.prev = new Float64Array(7 * this.nodes.length);
    this.current = new Float64Array(7 * this.nodes.length);
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

  /**
   * Shows the models `alpha` (0..1) of the way from the previous step to the current one and
   * returns the props and the first actor's travel point in between.
   */
  blend(alpha: number): { props: Prop[]; root: Vector3 } {
    const { prev: a, current: b } = this;
    this.nodes.forEach((n, i) => {
      const k = 7 * i;
      n.position.set(a[k] + (b[k] - a[k]) * alpha, a[k + 1] + (b[k + 1] - a[k + 1]) * alpha, a[k + 2] + (b[k + 2] - a[k + 2]) * alpha);
      n.quaternion.fromArray(a, k + 3).slerp(_q.fromArray(b, k + 3), alpha);
    });
    const props = this.currentProps.map((p, i) => {
      const q = this.prevProps[i];
      if (!q || q.kind !== p.kind || !('position' in q) || !('position' in p)) return p;
      const position = q.position.clone().lerp(p.position, alpha);
      return q.kind === 'rod' && p.kind === 'rod' ? { ...p, position, to: q.to.clone().lerp(p.to, alpha) } : { ...p, position };
    });
    const root = this.prevRoot.clone().lerp(this.root(), alpha);
    return { props, root };
  }

  /** the models as the last step left them */
  private restore() {
    this.nodes.forEach((n, i) => {
      n.position.fromArray(this.current, 7 * i);
      n.quaternion.fromArray(this.current, 7 * i + 3);
    });
  }

  /** the models' state is the current one */
  private record() {
    this.nodes.forEach((n, i) => {
      n.position.toArray(this.current, 7 * i);
      n.quaternion.toArray(this.current, 7 * i + 3);
    });
    // (copied: the scenarios move their props' vectors in place)
    this.currentProps = this.sim.props().map((p) => (p.kind === 'rod' ? { ...p, position: p.position.clone(), to: p.to.clone() } : 'position' in p ? { ...p, position: p.position.clone() } : p));
  }

  /** the current state is where the next blend starts */
  private remember() {
    this.prev.set(this.current);
    this.prevProps = this.currentProps;
    this.prevRoot.copy(this.root());
  }

  private root() {
    return this.sim.actors[0].model.scene.position.clone().setY(FOCUS_HEIGHT);
  }
}

const _q = new Quaternion();
