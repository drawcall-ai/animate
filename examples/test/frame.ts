import type { Solid } from '../src/scenario';
import type { Simulation } from '../src/simulation';
import { Actor, type Side } from './actor';
import { askedOf } from './asking';

/** one person after one frame: what the story asked of it then, and what must keep out of the first person's body */
export interface Frame {
  t: number;
  h: Actor;
  /** each goal asked by name ('gaze', 'head', 'leftWrist', 'rightWrist'), where it is (world) */
  asked: ReadonlyMap<string, unknown>;
  /** what must keep out of the first person's body (the things it handles), as they are then */
  solids: readonly Solid[];
}

/** every person's frame after each frame of the run, to the scenario's end */
export function* frames(sim: Simulation): Generator<Frame[]> {
  const actors = sim.people.map((person) => new Actor(person));
  while (sim.t < sim.scenario.duration) {
    sim.step();
    // (the scene's world matrices as a render would leave them: things and grips are read off them)
    sim.stage.scene.updateMatrixWorld(true);
    const solids = sim.stage.solids?.() ?? [];
    yield actors.map((h) => ({ t: sim.t, h, asked: askedOf(h.body, h.insides.frame.time), solids }));
  }
}

/** the largest value seen and when */
export class Peak {
  value = 0;
  at = 0;
  see(v: number, t: number) {
    if (v <= this.value) return;
    this.value = v;
    this.at = t;
  }
  toString() {
    return `${this.value.toFixed(3)} m @${this.at.toFixed(2)}s`;
  }
}

/** a hand is on something: it holds a thing, a verb of the story has it, or the story asks it somewhere (or tracks it) */
export const tasked = (frame: Frame, side?: Side): boolean => {
  const { h, asked } = frame;
  return side
    ? !!h.insides.holding[side] || !!h.body.owners.hands[side] || asked.has(`${side}Wrist`)
    : tasked(frame, 'left') || tasked(frame, 'right');
};
