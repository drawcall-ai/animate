import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { wait, type Until } from '@drawcall/animate';

// The story camera as part of the story: each shot is a timeline step that frames its subjects from where they are each frame (bones
// as the scene shows them) and holds until its `until`. A shot either cuts in (the camera jumps to its framing) or moves in from the
// framing the camera had (an eased dolly, pan or crane); a shot may also move between two framings of its own while it holds.
//
// The camera is placed after every body has updated (`apply`, from the beat's `afterStep`), so it frames the pose
// that is drawn, not the one before it.

/** where the camera is, what it looks at and its vertical field of view (degrees) */
export interface Framing {
  eye: Vector3;
  at: Vector3;
  fov: number;
}
export const framing = (): Framing => ({ eye: new Vector3(), at: new Vector3(), fov: 40 });

/** a framing worked out afresh each frame, from where its subjects are (into `out`) */
export type Rig = (out: Framing) => Framing;

export interface ShotOptions {
  /** when the shot ends: seconds after it starts, or a condition */
  until: Until;
  /**
   * how the shot begins: `'cut'` (default) jumps to it; `'move'` eases in from the framing the camera has; a rig starts at that rig's
   * framing and eases to the shot's own over `seconds` (a dolly, pan or crane within one shot)
   */
  from?: 'cut' | 'move' | Rig;
  /** how long the move takes (s; default 2) */
  seconds?: number;
  /**
   * how the camera follows a moving framing (s): its eye and aim trail the rig's by about this long, so a walker's bob or a turning head
   * does not shake the frame. 0 locks on.
   */
  lag?: number;
}

/** a logged shot: when it began (story s), its name */
export interface ShotLog {
  time: number;
  name: string;
}

/** eases 0…1 in and out with zero velocity and acceleration at both ends (a dolly that starts and stops gently) */
const smootherstep = (u: number) => {
  const t = MathUtils.clamp(u, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export class Director {
  readonly shots: ShotLog[] = [];
  /** story seconds, kept by the shots as they run */
  time = 0;
  private rig?: Rig;
  private from?: Rig | Framing;
  private seconds = 2;
  private lag = 0.25;
  private elapsed = 0;
  private cut = true;
  private readonly wanted = framing();
  private readonly start = framing();
  private readonly shown = framing();

  constructor(readonly camera: PerspectiveCamera) {}

  /** one shot of the film, as a story step: frames `rig` until `until` (see `ShotOptions`) */
  *shot(name: string, rig: Rig, { until, from = 'cut', seconds = 2, lag = 0.25 }: ShotOptions) {
    const director = this;
    this.shots.push({ time: this.time, name });
    this.rig = rig;
    this.seconds = seconds;
    this.lag = lag;
    this.elapsed = 0;
    this.cut = from === 'cut';
    this.from = from === 'move' ? copy(this.start, this.shown) : from === 'cut' ? undefined : from;
    yield* parallel('race', wait(until), action({ update: (_, clock) => void (director.elapsed += clock.delta) }));
  }

  /** places the camera for this frame: call once every body has updated (s) */
  apply(seconds: number): void {
    this.time += seconds;
    const rig = this.rig;
    if (!rig) return;
    rig(this.wanted);
    if (this.from) {
      const start = typeof this.from === 'function' ? this.from(this.start) : this.from;
      const u = smootherstep(this.elapsed / this.seconds);
      this.wanted.eye.lerpVectors(start.eye, this.wanted.eye, u);
      this.wanted.at.lerpVectors(start.at, this.wanted.at, u);
      this.wanted.fov = MathUtils.lerp(start.fov, this.wanted.fov, u);
    }
    if (this.cut || this.lag <= 0) {
      copy(this.shown, this.wanted);
      this.cut = false;
    } else {
      const k = 1 - Math.exp(-seconds / this.lag);
      this.shown.eye.lerp(this.wanted.eye, k);
      this.shown.at.lerp(this.wanted.at, k);
      this.shown.fov += (this.wanted.fov - this.shown.fov) * k;
    }
    const { camera } = this;
    camera.position.copy(this.shown.eye);
    camera.lookAt(this.shown.at);
    if (camera.fov !== this.shown.fov) {
      camera.fov = this.shown.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  /** what the camera looks at now (for the viewer's orbit control to take over from) */
  get aim(): Vector3 {
    return this.shown.at;
  }
}

function copy(out: Framing, from: Framing): Framing {
  out.eye.copy(from.eye);
  out.at.copy(from.at);
  out.fov = from.fov;
  return out;
}
