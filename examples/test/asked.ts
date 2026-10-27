// The verbs a story asks a body's goals with, recorded as they run (`asking.ts`): the metrics judge the eyes and hands against them.
import { vi } from 'vitest';

vi.mock('@drawcall/animate', async (original) => {
  const actual = await original<typeof import('@drawcall/animate')>();
  const { asking } = await import('./asking');
  const lookAt: typeof actual.lookAt = (body, target, options) => asking(body, { gaze: target }, actual.lookAt(body, target, options));
  const reach: typeof actual.reach = (body, targets, options) => {
    const { left, right } = targets as { left?: import('@drawcall/animate').Target; right?: import('@drawcall/animate').Target };
    return asking(body, { leftWrist: left, rightWrist: right }, actual.reach(body, targets, options));
  };
  const track: typeof actual.track = (body, tracked, options) =>
    asking(body, { head: tracked.head, leftWrist: tracked.left, rightWrist: tracked.right }, actual.track(body, tracked, options));
  return { ...actual, lookAt, reach, track };
});
