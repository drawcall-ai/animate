import { MathUtils, Vector3 } from 'three';
import { HIP_FOV } from './camera';

/** Radians per mouse count from the hip. */
const SENSITIVITY = 0.002;
/** How long a click too quick to be held still fires, in milliseconds: long enough to bring the rifle up out of a sprint. */
const CLICK = 200;

export class Input {
  yaw = 0;
  pitch = -0.06;
  aim = false;
  readonly move = new Vector3();
  private readonly keys = new Set<string>();
  private readonly presses = new Set<string>();
  private readonly events = new AbortController();
  private lockTime = 0;
  private clicked = -Infinity;
  private held = false;

  /** `fov` is the camera's current vertical field of view in degrees. */
  constructor(private readonly canvas: HTMLCanvasElement, onLock: (locked: boolean) => void, fov: () => number) {
    const options = { signal: this.events.signal };
    document.addEventListener('pointerlockchange', () => {
      this.clear();
      this.lockTime = performance.now();
      onLock(this.locked);
    }, options);
    window.addEventListener('blur', () => { this.clear(); document.exitPointerLock(); }, options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.clear(); document.exitPointerLock(); }
    }, options);
    document.addEventListener('keydown', (event) => {
      if (!this.locked) return;
      if (event.code === 'Escape') { document.exitPointerLock(); return; }
      if (['Space', 'Backspace', 'Tab'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.repeat) return;
      this.presses.add(event.code);
    }, options);
    document.addEventListener('keyup', (event) => this.keys.delete(event.code), options);
    document.addEventListener('mousemove', (event) => {
      if (!this.locked || performance.now() - this.lockTime < 80) return;
      // A zoomed view turns by the same share of the screen per count as the hip's.
      const sensitivity = SENSITIVITY * Math.tan(MathUtils.degToRad(fov()) / 2) / Math.tan(MathUtils.degToRad(HIP_FOV) / 2);
      this.yaw -= event.movementX * sensitivity;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - event.movementY * sensitivity));
    }, options);
    document.addEventListener('mousedown', (event) => {
      if (!this.locked) return;
      if (event.button === 0) { this.held = true; this.clicked = performance.now(); }
      if (event.button === 2) this.aim = true;
    }, options);
    document.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.held = false;
      if (event.button === 2) this.aim = false;
    }, options);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  /** Fire is held, or a click has not been answered by a shot yet. */
  get trigger() { return this.held || performance.now() - this.clicked < CLICK; }
  fired() { this.clicked = -Infinity; }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  get crouch() { return this.keys.has('KeyC'); }
  get jump() { return this.keys.has('Space'); }

  direction() {
    const x = Number(this.keys.has('KeyA')) - Number(this.keys.has('KeyD'));
    const z = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    return this.move.set(x, 0, z).normalize().applyAxisAngle(UP, this.yaw);
  }

  pressed(code: string) { return this.presses.delete(code); }
  down(code: string) { return this.keys.has(code); }
  // The operating system's pointer speed stays: raw counts (unadjustedMovement) are far slower on macOS mice and trackpads.
  async lock() { await this.canvas.requestPointerLock(); }

  clear() {
    this.keys.clear();
    this.presses.clear();
    this.held = this.aim = false;
    this.clicked = -Infinity;
    this.move.set(0, 0, 0);
  }

  reset() { this.clear(); this.yaw = 0; this.pitch = -0.06; }
  dispose() { this.events.abort(); document.exitPointerLock(); }
}

const UP = new Vector3(0, 1, 0);
