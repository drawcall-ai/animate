import { expect, it } from 'vitest';
import { MathUtils, type Object3D, Quaternion, Vector3 } from 'three';
import type { Body } from '@drawcall/animate';
import { beat } from '../src/beats/troops';
import type { Playing } from '../src/play';
import { runBeat } from './run';

// The troops' beat played headless: what the troops do, measured on their simulated bodies (the copies replay them in the viewer).

/** a body's bone by name */
const bone = (body: Body, name: string) => (body.bones as Record<string, Object3D>)[name];
/** how far a body's head is turned off its facing (rad, + to its left) */
function headTurn(body: Body): number {
  const ahead = new Vector3(0, 0, 1).applyQuaternion(bone(body, 'head').getWorldQuaternion(new Quaternion()));
  return MathUtils.euclideanModulo(Math.atan2(ahead.x, ahead.z) - body.facing + Math.PI, 2 * Math.PI) - Math.PI;
}

interface Track {
  /** per troop body, per frame: the head's turn, the hips' world x and z */
  turn: number[][];
  hips: [number, number][][];
  /** per troop body: the time it first turned its head ≥ 8° toward a passing hero, and the hero's z then */
  noticed: (number | undefined)[];
  /** per troop body: the nearest its hands came together during the applause (m), and whether it was tracking hands */
  clapGap: number[];
  clapped: boolean[];
  heroesTurnedAt?: number;
}

let playing: Playing;
const track: Track = { turn: [], hips: [], noticed: [], clapGap: [], clapped: [] };
const troops = () => playing.bodies.slice(8);

it('plays to its end, every body\'s dev log empty', async () => {
  playing = await runBeat(beat, (p) => {
    const bodies = p.bodies.slice(8);
    const heroes = p.bodies.slice(0, 3);
    if (track.heroesTurnedAt === undefined && heroes.every((hero) => Math.abs(Math.abs(hero.facing) - Math.PI) < 0.1)) track.heroesTurnedAt = p.time;
    bodies.forEach((body, index) => {
      (track.turn[index] ??= []).push(headTurn(body));
      (track.hips[index] ??= []).push([bone(body, 'hips').getWorldPosition(new Vector3()).x, bone(body, 'hips').getWorldPosition(new Vector3()).z]);
      const turn = headTurn(body);
      // (a soldier on the +x side faces −x: a hero toward the dais, +z, is to its right, a − turn; on the −x side, to its left)
      const towardDais = body.position.x > 0 ? -turn : turn;
      if (track.noticed[index] === undefined && towardDais > MathUtils.degToRad(8) && !track.heroesTurnedAt) track.noticed[index] = p.time;
      if (track.heroesTurnedAt !== undefined) {
        const gap = bone(body, 'leftHand').getWorldPosition(new Vector3()).distanceTo(bone(body, 'rightHand').getWorldPosition(new Vector3()));
        track.clapGap[index] = Math.min(track.clapGap[index] ?? Infinity, gap);
        track.clapped[index] ||= Object.values(body.owners.hands).some((owner) => owner?.verb === 'track');
      }
    });
  });
  expect(playing.finished()).toBe(true);
  expect(playing.done()).toBe(true);
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
}, 300_000);

it('stands several hundred troops, the front rank and officers simulated', () => {
  // (the count is the beat's: 2 sides × 3 blocks × (9 files × 12 ranks + an officer))
  expect(troops().length).toBe(60);
  expect(playing.scene.getObjectByName('troop copies')).toBeDefined();
});

it('at attention the ranks are alive but not in lockstep', () => {
  // the soldiers of the blocks nearest the dais (z > 24), from 1 s to 14 s, before the heroes come near them: each one's hips sway a
  // little, and they do not sway in step: of every two, their sways' correlation is above 0.9 about as often as two sways of a similar
  // period at random phases would be (about one pair in seven), not for nearly all pairs as copies' would be
  const far = troops().flatMap((body, index) => (body.position.z > 24 ? [track.hips[index].slice(60, 14 * 60).map(([x]) => x)] : []));
  expect(far.length).toBeGreaterThan(10);
  for (const series of far) expect(Math.max(...series) - Math.min(...series)).toBeGreaterThan(0.002);
  const correlation = (a: number[], b: number[]) => {
    const mean = (v: number[]) => v.reduce((sum, x) => sum + x, 0) / v.length;
    const [ma, mb] = [mean(a), mean(b)];
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) {
      ab += (a[i] - ma) * (b[i] - mb);
      aa += (a[i] - ma) ** 2;
      bb += (b[i] - mb) ** 2;
    }
    return ab / Math.sqrt(aa * bb);
  };
  const pairs = far.flatMap((a, i) => far.slice(i + 1).map((b) => correlation(a, b)));
  const inStep = pairs.filter((c) => c > 0.9).length / pairs.length;
  expect(inStep).toBeLessThan(0.3);
});

it('the front rank follows the heroes with a turn of the head that travels up the aisle with them', () => {
  const front = troops().map((body, index) => ({ z: body.position.z, noticed: track.noticed[index] })).filter(({ z }) => z > 7 && z < 29);
  // nearly every front-rank soldier along the walk turns its head toward the heroes
  expect(front.filter(({ noticed }) => noticed !== undefined).length).toBeGreaterThan(0.8 * front.length);
  // and later the further up the aisle it stands: the time it noticed rises with its z, about at the heroes' pace
  const seen = front.filter(({ noticed }) => noticed !== undefined) as { z: number; noticed: number }[];
  const n = seen.length, mz = seen.reduce((s, e) => s + e.z, 0) / n, mt = seen.reduce((s, e) => s + e.noticed, 0) / n;
  const slope = seen.reduce((s, e) => s + (e.z - mz) * (e.noticed - mt), 0) / seen.reduce((s, e) => s + (e.z - mz) ** 2, 0);
  expect(slope).toBeGreaterThan(0.6); // s per m: about 1 / 0.9 m/s, the heroes' pace
  expect(slope).toBeLessThan(1.6);
  // only slightly with the head: at attention the turn stays well inside a person's neck range
  const most = track.turn.flatMap((series) => series.slice(0, Math.round(track.heroesTurnedAt! * 60))).reduce((m, turn) => Math.max(m, Math.abs(turn)), 0);
  expect(most).toBeLessThan(MathUtils.degToRad(50));
});

it('at the finale the troops turn toward the heroes and applaud, then settle', () => {
  expect(track.heroesTurnedAt).toBeDefined();
  // every simulated soldier applauded with its hands, most clapping (hands meeting), and then let its hands down
  expect(track.clapped.filter(Boolean).length).toBe(troops().length);
  expect(track.clapGap.filter((gap) => gap < 0.12).length).toBeGreaterThan(0.6 * troops().length);
  const heroes = playing.bodies.slice(0, 3);
  const centre = heroes.reduce((sum, hero) => sum.add(hero.position), new Vector3()).divideScalar(3);
  for (const body of troops()) {
    const toward = Math.atan2(centre.x - body.position.x, centre.z - body.position.z);
    expect(Math.abs(MathUtils.euclideanModulo(toward - body.facing + Math.PI, 2 * Math.PI) - Math.PI)).toBeLessThan(0.25);
    expect(body.owners.hands).toEqual({});
  }
});
