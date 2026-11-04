import { MathUtils } from 'three';

/** Engine speeds (rpm): idling, the starter turning it over, revved up to change up a gear, dropped to change down one, and the most. */
const RPM = { idle: 780, cranking: 210, up: 3000, down: 1350, top: 3800 };
/** How far above idle (rpm) the full throttle holds the engine with the clutch slipping, pulling away: in first or reverse, and higher. */
const PULLING = { low: 900, high: 300 };
/** Engine rpm per m/s of road speed in each forward gear, and in reverse: four gears up to the rover's top speed. */
const GEARS = [560, 330, 220, 165];
const REVERSE = 560;
/** Seconds the starter turns it over before it catches, and a gear change takes with the clutch down. */
const CRANKING = 0.75;
const SHIFT = 0.3;
/** How fast the rpm follows (1/s): driven through the gears, and free with the clutch down or in neutral. */
const FOLLOW = { driven: 14, free: 5 };
/** Catching, how far it flares past idle (rpm), and how fast the flare dies away (1/s). */
const FLARE = { rpm: 800, decay: 2.5 };

/**
 * The rover's diesel and its gearbox, for its sound: off, turning over on the starter, or running, its speed (rpm) following the wheels in
 * gear, or the throttle with the clutch slipping pulling away and down through a change, and how hard it is working (`load`, 0 … 1).
 */
export class Engine {
  state: 'off' | 'cranking' | 'running' = 'off';
  rpm = 0;
  load = 0;
  /** 1 … 4 forward, −1 reverse */
  gear = 1;
  private cranked = 0;
  private shifting = 0;
  private flare = 0;

  get running() { return this.state === 'running'; }
  /** Whether it drives the wheels: running, in gear with the clutch up. */
  get driving() { return this.running && this.shifting === 0; }

  /** Turns the key to start it, if it is not already going. */
  start() {
    if (this.state !== 'off') return;
    this.state = 'cranking';
    this.cranked = 0;
  }

  /** Turns the key off: it runs down. */
  stop() { this.state = 'off'; }

  reset() {
    this.state = 'off';
    this.rpm = this.load = this.cranked = this.shifting = this.flare = 0;
    this.gear = 1;
  }

  /** Steps it `dt` s on, the throttle at `throttle` (−1 … 1, back in reverse) and the rover rolling at `speed` (m/s, forward). */
  update(dt: number, throttle: number, speed: number) {
    if (this.state === 'off') {
      this.rpm = MathUtils.damp(this.rpm, 0, 4, dt);
      this.load = 0;
      return;
    }
    if (this.state === 'cranking') {
      this.rpm = RPM.cranking;
      if ((this.cranked += dt) >= CRANKING) {
        this.state = 'running';
        this.flare = 1;
      }
      return;
    }
    this.flare = MathUtils.damp(this.flare, 0, FLARE.decay, dt);
    const idle = RPM.idle + FLARE.rpm * this.flare;
    this.shift(dt, throttle, speed);
    const pedal = Math.abs(throttle);
    const wheels = Math.abs(speed) * (this.gear < 0 ? REVERSE : GEARS[this.gear - 1]);
    // (pulling away, the clutch slips with the engine held up off idle; off the throttle it idles, in gear or not)
    const pulling = idle + pedal * (this.gear === 1 || this.gear < 0 ? PULLING.low : PULLING.high);
    // (through a change it falls toward what the next gear will turn it at)
    const wanted = this.shifting > 0 ? Math.max(idle, 0.92 * wheels) : Math.min(RPM.top, Math.max(wheels, pulling));
    this.rpm = MathUtils.damp(this.rpm, wanted, this.shifting > 0 ? FOLLOW.free : FOLLOW.driven, dt);
    this.load = MathUtils.damp(this.load, this.shifting > 0 ? 0 : pedal, 10, dt);
  }

  /**
   * Changes gear only on the throttle (off it, slowing, the clutch goes down below idle and it stays in gear): at a standstill straight
   * into first or reverse, put in with the clutch already down; on the move, the clutch down for `SHIFT` s, up a gear revved past
   * `RPM.up`, and down, straight to the gear for the road speed, dropped below `RPM.down`.
   */
  private shift(dt: number, throttle: number, speed: number) {
    this.shifting = Math.max(0, this.shifting - dt);
    if (this.shifting > 0 || throttle === 0) return;
    const backing = throttle < 0;
    if (Math.abs(speed) < 0.5) {
      this.gear = backing ? -1 : 1;
      return;
    }
    if (this.gear < 0 || backing) return;
    const rpm = speed * GEARS[this.gear - 1];
    if (rpm > RPM.up && this.gear < GEARS.length) this.change(this.gear + 1);
    else if (rpm < RPM.down && this.gear > 1) this.change(fitting(speed));
  }

  private change(gear: number) {
    if (gear === this.gear) return;
    this.gear = gear;
    this.shifting = SHIFT;
  }
}

/** The lowest forward gear that turns the engine under `RPM.up` at `speed` (m/s): the one that pulls hardest. */
function fitting(speed: number) {
  const gear = GEARS.findIndex((rpm) => speed * rpm < RPM.up);
  return gear < 0 ? GEARS.length : gear + 1;
}
