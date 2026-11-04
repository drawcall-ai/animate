import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Contacts, type Sound } from '../src/audio';

function setup() {
  const events: { sound: Sound; gain: number }[] = [];
  const contacts = new Contacts((sound, gain) => events.push({ sound, gain }));
  const body = { feet: [
    { planted: true, position: new Vector3(), yaw: 0 },
    { planted: true, position: new Vector3(), yaw: 0 },
  ] };
  const motion = { grounded: true, actualVelocity: new Vector3() };
  const step = (left: boolean, right: boolean, speed: number, vertical = 0, grounded = true) => {
    body.feet[0].planted = left; body.feet[1].planted = right;
    motion.grounded = grounded; motion.actualVelocity.set(0, vertical, speed);
    contacts.update(body, motion);
  };
  contacts.reset(body, motion);
  return { contacts, body, motion, events, step };
}

it('plays one sound per solved footfall, with running louder than walking', () => {
  const { step, events } = setup();
  step(true, true, 1.4);
  step(false, true, 1.4);
  step(true, true, 1.4);
  step(true, true, 1.4);
  step(true, false, 3.5);
  step(true, true, 3.5);
  expect(events.map((event) => event.sound)).toEqual(['step-a', 'step-b']);
  expect(events[1].gain).toBeGreaterThan(events[0].gain);
});

it('keeps blocked movement, idle foot adjustments, and reset silent', () => {
  const { step, contacts, body, motion, events } = setup();
  for (let i = 0; i < 8; i++) { step(false, true, 0); step(true, true, 0); }
  step(false, true, 1.4);
  body.feet[0].planted = true;
  contacts.reset(body, motion);
  step(true, true, 1.4);
  expect(events).toEqual([]);
});

it('plays the final moving footfall after stopping, then keeps idle adjustments silent', () => {
  const { step, events } = setup();
  step(false, true, 1.4);
  step(false, true, 0);
  step(true, true, 0);
  step(false, true, 0);
  step(true, true, 0);
  expect(events.map((event) => event.sound)).toEqual(['step-a']);
});

it('waits for animated foot contact after physics touchdown and plays one landing', () => {
  const { step, events } = setup();
  step(false, false, 3.5, 5, false);
  step(false, false, 3.5, -4, false);
  step(false, false, 1.4, 0, true);
  expect(events.map((event) => event.sound)).toEqual(['jump']);
  step(false, false, 0);
  step(true, true, 0);
  step(true, true, 0);
  expect(events.map((event) => event.sound)).toEqual(['jump', 'land']);
});

it('does not call walking off an edge a jump and scales landing by fall speed', () => {
  const falls = [1, 5].map((speed) => {
    const { step, events } = setup();
    step(false, false, 1.4, 0, false);
    step(false, false, 1.4, -speed, false);
    step(true, false, 1.4);
    expect(events.map((event) => event.sound)).toEqual(['land']);
    return events[0].gain;
  });
  expect(falls[1]).toBeGreaterThan(falls[0]);
});
