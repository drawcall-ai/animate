/** The element with `id`, which must exist and be of `type`. */
export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} is missing or not a ${type.name}`);
  return el;
}

/** A canvas' 2D context (fails if the canvas already has another kind). */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D context');
  return ctx;
}

declare global {
  interface Window {
    /** the capture scripts wait for this */
    __ready?: boolean;
    /** video mode: advance one display frame; false once the scenario is over */
    __frame?: (dt: number) => boolean;
  }
}
