// The verbs a story asks a body's goals with, recorded as they run (`asking.ts`): the metrics judge the eyes and hands against them.
import { Vector3 } from 'three';
import { vi } from 'vitest';

vi.mock('@drawcall/animate', async (original) => {
  const actual = await original<typeof import('@drawcall/animate')>();
  const { asking } = await import('./asking');
  // (another body as the target, or as a function's, is its eyes, as lookAt reads them; lookAt itself says when it has none)
  const eyesOf = (seen: import('@drawcall/animate').Body) => seen.species.gaze?.eyes(seen.pose, new Vector3()) ?? seen.position;
  const lookAt: typeof actual.lookAt = (body, target, options) => {
    const gaze = target instanceof actual.Body ? () => eyesOf(target)
      : typeof target === 'function' ? (time: number) => { const at = target(time); return at instanceof actual.Body ? eyesOf(at) : at; }
      : target;
    return asking(body, { gaze }, actual.lookAt(body, target, options));
  };
  const reach: typeof actual.reach = (body, targets, options) => {
    const { left, right } = targets as { left?: import('@drawcall/animate').Target; right?: import('@drawcall/animate').Target };
    return asking(body, { leftWrist: left, rightWrist: right }, actual.reach(body, targets, options));
  };
  const track: typeof actual.track = (body, tracked, options) =>
    asking(body, { head: tracked.head, leftWrist: tracked.left, rightWrist: tracked.right }, actual.track(body, tracked, options));
  return { ...actual, lookAt, reach, track };
});
