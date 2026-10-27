import { runTimeline, type Update } from '@pmndrs/timeline';
import type { Body } from '@drawcall/animate';
import { Cast, FIXED_DT, type CastOptions, type Person, type Scenario, type Stage } from './scenario';

/** A scenario run at a fixed 60 Hz, as an app runs one: each frame its story steps, then every body updates. */
export class Simulation {
  readonly stage: Stage;
  /** its people, in order (the metrics read the first) */
  readonly people: readonly Person[];
  /** s */
  t = 0;
  private readonly updateStory: Update<unknown>;

  constructor(readonly scenario: Scenario, cast: CastOptions = {}) {
    this.stage = scenario.stage(new Cast(cast));
    for (const body of this.stage.bodies) this.stage.scene.add(body.object);
    this.people = this.stage.bodies.filter(isPerson);
    this.updateStory = runTimeline(this.stage.story);
  }

  /** one frame: the story, then every body (each reading the others as they were before this frame) */
  step() {
    this.updateStory(undefined, FIXED_DT);
    for (const body of this.stage.bodies) body.update(FIXED_DT);
    this.t += FIXED_DT;
  }

  advanceTo(t: number) {
    while (this.t + FIXED_DT * 0.5 < t) this.step();
  }
}

/** whether `body` is a person */
export const isPerson = (body: Body): body is Person => body.species.person !== undefined;
