import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { grab, lookAt, wait, walkTo, type Body } from '@drawcall/animate';
import { floorAt } from '../hall';
import { droidsLife, type Cue } from '../droids/life';
import { createTroops, serve } from '../troops';
import { Director, type ShotLog } from '../film/camera';
import { fixed, middleOf, onFace, panning, placeOf, tracking } from '../film/rigs';
import { closeDoors, threshold } from '../film/doors';
import { cushion, dressMedal } from '../film/medals';
import { footsteps } from '../film/footsteps';
import { beat as procession } from './procession';
import { medalMoment as stageMedalMoment } from './gestures';
import { createMedal, createWornPlace, handOver } from './ceremony';
import { beat as finale } from './finale';
import type { Beat } from './index';

// The whole scene as one film, as the last scene of A New Hope plays it: the doors open, the trio walks up the aisle between the troops
// at attention and climbs to Leia, who hangs Luke's medal and then Han's (Luke bows, Han winks, Chewbacca roars); the droids react
// throughout, and the trio turns to the hall as the troops applaud. The camera and the sound are steps of the same story.
//
// It composes the other beats rather than rewriting them: the procession, the medal moment's gestures and the finale are each staged into
// this one setting and their stories run in turn, the next one's preparation starting before the last ends; the droids' moods and the
// troops come from the story functions their modules export. Where the beats' setups disagree, this beat reconciles them:
// - the heroes start outside the doors (no beat starts them there), so `arrange` moves their entrance marks back through the doorway;
// - the gestures beat places Leia before each hero from where he stands when it is staged, so it is staged once they are on their marks;
// - the beats' stories do not say when their moments happen (the wink, the roar), so the film reads them off the bodies (`owners`);
// - the medal moment's gestures are given the ceremony's real medals: the bearer takes each off his cushion and hands it over to Leia
//   (the ceremony's `handOver`), and she carries it onto the hero's chest and lets go of it there.

/** how long the doors take to open, and when the heroes set off through them (s) */
const DOORS = 6;
const SET_OFF = 1.6;
/** the heroes wait outside, this far back from their marks inside the doorway (m) */
const OUTSIDE = 4.5;
/** after the trio starts to turn, when the troops break into applause (s) */
const TROOPS_AFTER_TURN = 1.0;
/** how long the final wide holds on the cheering hall once the trio stands facing it, and the music's fade (s) */
const FINAL_HOLD = 6;
const FADE = 4;

/** the times (s) the film's events happened in its last run, and its shots: for checking the cutting and the sound's sync */
export const lastFilm: { events: Record<string, number>; shots: ShotLog[]; ends?: Record<string, boolean | number> } = { events: {}, shots: [] };

export const beat: Beat & { order: number } = {
  id: 'film',
  title: 'The film: the whole scene, filmed',
  order: 0,
  duration: 150,
  arrange(marks) {
    for (const hero of ['lukeEnter', 'hanEnter', 'chewbaccaEnter'] as const) marks[hero].position.z -= OUTSIDE;
  },
  stage(setting) {
    const { scene, marks, cast, dress, camera, sound, hall } = setting;
    const { luke, han, chewbacca, leia, medalBearer: bearer, dodonna, threepio, artoo } = cast;

    // the beats this film is made of, staged into its own setting (each adds its floor); the gestures beat waits for the heroes
    const walk = procession.stage(setting);
    const turn = finale.stage(setting);
    let medalMoment: ReturnType<typeof stageMedalMoment> | undefined;

    const troops = createTroops(dress);
    scene.add(troops.echoes);
    const doors = closeDoors(hall);
    const director = new Director(camera);
    // the medals lie on a cushion on a stand before the bearer's mark, each to be worn before its hero's chest
    const tray = cushion(bearer);
    const lukeMedal = dressMedal(createMedal('luke medal')), hanMedal = dressMedal(createMedal('han medal'));
    // each lies face up, its ribbon toward the bearer
    lukeMedal.position.set(0.08, 0.005, 0.04);
    hanMedal.position.set(-0.08, 0.005, 0.04);
    lukeMedal.rotation.x = hanMedal.rotation.x = -Math.PI / 2;
    tray.add(lukeMedal, hanMedal);
    const worn = { luke: createWornPlace(luke, 'luke medal place'), han: createWornPlace(han, 'han medal place') };
    scene.add(tray, threshold());
    const INNER = { left: 'inner left', right: 'inner right' } as const;
    const steps = footsteps(
      [
        { body: luke, volume: 0.5, rate: 1, name: 'Luke' },
        { body: han, volume: 0.55, rate: 0.95, name: 'Han' },
        { body: chewbacca, volume: 0.8, rate: 0.72, name: 'Chewbacca' },
        { body: leia, volume: 0.3, rate: 1.15, name: 'Leia' },
        { body: bearer, volume: 0.3, rate: 1.05, name: 'bearer' },
      ],
      sound,
      floorAt,
    );

    // what has happened, and when (film time, s): the tracks below wait on these to stay in step with each other
    const events: Record<string, number> = {};
    /** the share of the troops applauding or cheering as the film ends */
    let cheering = 0;
    lastFilm.events = events;
    lastFilm.shots = director.shots;
    const mark = (name: string) => void (events[name] ??= director.time);
    const has = (name: string) => () => events[name] !== undefined;
    const since = (name: string, seconds: number) => () => events[name] !== undefined && director.time >= events[name] + seconds;
    /** waits until `condition` has held for `seconds` on end, and marks `name` at the moment it began to hold */
    function* holds(name: string, condition: () => boolean, seconds: number) {
      let began: number | undefined;
      yield* wait(() => {
        if (!condition()) began = undefined;
        else began ??= director.time;
        return began !== undefined && director.time - began >= seconds;
      });
      events[name] ??= began!;
    }
    /** whether a verb named `verb` holds any of `body`'s parts (`hands`: its hands only), as the stories asked it */
    const doing = (body: Body, verb: string, part: 'hands' | 'any' = 'hands') => {
      const { go, look, trunk, head, hands } = body.owners;
      return [hands.left, hands.right, ...(part === 'any' ? [go, look, trunk, head] : [])].some((owner) => owner?.verb === verb);
    };

    const hallPoint = new Vector3(0, 1.7, 14);
    const onMark = (hero: 'luke' | 'han' | 'chewbacca') => {
      const target = marks[`${hero}Decorated`].position, body = cast[hero];
      return Math.hypot(body.position.x - target.x, body.position.z - target.z) < 0.12;
    };

    // ---- the action: the doors and the walk, the medals with their gestures, the turn ----------------------------------------------

    function* opening() {
      sound.play('doors', { from: new Vector3(0, 7, 0.3), near: 10, why: 'the doors begin to open' });
      yield* parallel('all', doors.open(DOORS), function* () {
        // the trio sets off as the doors part, not once they stand open
        yield* wait(SET_OFF);
        mark('walking');
        yield* walk.story();
        mark('arrived');
      });
    }

    /**
     * the bearer takes both medals off the cushion while the trio climbs, Luke's in his right hand and Han's in his left (as the film's
     * officer stands ready with them), steps up beside Leia and hands her Luke's; he waits there with Han's until she has that too
     */
    function* leiaTakesTheMedal() {
      yield* wait(() => luke.position.z > 32.2);
      mark('bearer steps up');
      if (!(yield* grab(bearer, lukeMedal, { right: INNER.right }))) throw new Error('the bearer could not take Luke\'s medal');
      if (!(yield* grab(bearer, hanMedal, { left: INNER.left }))) throw new Error('the bearer could not take Han\'s medal');
      const spot = place(0.65, 36.15, Math.PI + 0.5); // at her right, turned a little toward her
      yield* parallel('all', walkTo(bearer, spot, { speed: 0.5 }), lookAt(leia, luke, { until: 1.2 }));
      yield* parallel('race', lookAt(bearer, leia), function* () {
        yield* handOver(bearer, leia, lukeMedal);
        mark('Leia takes Luke\'s medal');
      });
      mark('bearer holds Han\'s medal');
      yield* parallel('race', lookAt(bearer, luke), wait(has('Leia takes Han\'s medal')));
      yield* walkTo(bearer, marks.medalBearer, { speed: 0.5 });
    }
    /** on her way from Luke to Han: the bearer, waiting with Han's medal, hands it over to her */
    function* takeHan() {
      yield* wait(has('bearer holds Han\'s medal'));
      yield* parallel('race', lookAt(bearer, leia), function* () {
        yield* handOver(bearer, leia, hanMedal);
      });
      mark('Leia takes Han\'s medal');
      return true;
    }
    /** a placement empty on the dais (x, z), its +Z turned to `face` */
    function place(x: number, z: number, face: number) {
      const spot = new Object3D();
      spot.position.set(x, floorAt(x, z), z);
      spot.rotation.y = face;
      scene.add(spot);
      return spot;
    }

    /** the gestures beat (Leia to Luke, his bow, to Han, his wink, Chewbacca's roar), staged once the trio stands on its marks */
    function* medals() {
      yield* wait(() => onMark('luke') && onMark('han') && onMark('chewbacca') && has('Leia takes Luke\'s medal')());
      medalMoment = stageMedalMoment(setting, { luke: { medal: lukeMedal, place: worn.luke }, han: { medal: hanMedal, place: worn.han }, takeHan });
      mark('medals');
      yield* parallel('all', medalMoment.story(), watchTheMoments());
      mark('medals done');
    }

    /** what the medal moment does, read off the bodies and the medals: the film marks the moments */
    function* watchTheMoments() {
      const nearer = (hero: Body) => leia.position.distanceTo(hero.position) < 0.9;
      yield* wait(() => doing(leia, 'carry') && nearer(luke));
      mark('Leia hangs Luke\'s medal');
      yield* wait(() => lukeMedal.parent === worn.luke);
      mark('Luke medal hung');
      yield* wait(() => doing(leia, 'carry') && nearer(han));
      mark('Leia hangs Han\'s medal');
      yield* wait(() => hanMedal.parent === worn.han);
      mark('Han medal hung');
      // his wink's half-nod: a pose of his head
      yield* wait(() => doing(han, 'pose', 'any'));
      mark('wink');
      // the roar's arms going out: his head is going back
      yield* wait(() => doing(chewbacca, 'reach'));
      mark('roar');
      yield* holds('roared', () => !doing(chewbacca, 'reach'), 0.2);
    }

    function* theFinale() {
      mark('turn');
      yield* parallel(
        'all',
        turn.story(),
        (function* () {
          yield* wait(TROOPS_AFTER_TURN);
          mark('troops cheer');
        })(),
        // Leia steps back to the middle of the dais behind them, her eyes on the hall
        parallel('race', walkTo(leia, marks.leia, { speed: 0.6 }), lookAt(leia, hallPoint)),
      );
      mark('facing the hall');
      yield* wait(FINAL_HOLD);
      // (checked before the film ends: its end stops the troops' stories with it)
      cheering = troops.troopers.filter(({ body }) => body.owners.hands.left !== undefined || body.owners.hands.right !== undefined).length / troops.troopers.length;
      sound.fade('march', FADE);
      sound.fade('crowd', FADE);
      sound.fade('hall', FADE);
      yield* wait(FADE);
      mark('end');
    }

    function* action() {
      sound.play('march', { volume: 0.55, why: 'the march' });
      sound.play('hall', { volume: 0.35, loop: true, why: 'the hall' });
      yield* parallel('all', opening(), leiaTakesTheMedal(), function* () {
        yield* medals();
        yield* theFinale();
      });
    }

    // ---- the rest of the hall: the dais party, the droids, the troops -------------------------------------------------------------

    function* daisParty() {
      yield* parallel(
        'all',
        // Leia and the bearer watch the trio come up; once he steps up to her, their eyes are the medals' story
        parallel('race', wait(has('bearer steps up')), lookAt(leia, luke), lookAt(bearer, luke)),
        (function* () {
          // Dodonna follows each hero in turn, then looks out over the hall with them
          yield* lookAt(dodonna, luke, { until: has('Luke medal hung') });
          yield* lookAt(dodonna, han, { until: has('Han medal hung') });
          yield* lookAt(dodonna, chewbacca, { until: has('turn') });
          yield* lookAt(dodonna, hallPoint);
        })(),
      );
    }

    const cues: Cue[] = [
      // the droids watch the trio come up the hall, follow Luke's medal, then Han's, cheer each, start at the roar, and cheer the finale
      { focus: luke.bones.head, until: has('Leia hangs Luke\'s medal'), artoo: 'watch', threepio: 'watch' },
      { focus: lukeMedal, until: has('Luke medal hung'), artoo: 'watch', threepio: 'watch' },
      { focus: luke.bones.head, until: 2.6, artoo: 'cheer', threepio: 'watch' },
      { focus: hanMedal, until: has('Han medal hung'), artoo: 'watch', threepio: 'watch' },
      { focus: han.bones.head, until: since('roar', -0.1), artoo: 'cheer', threepio: 'watch' },
      { focus: chewbacca.bones.head, until: since('roared', 0.3), artoo: 'cheer', threepio: 'startle' },
      { focus: luke.bones.head, until: has('troops cheer'), artoo: 'watch', threepio: 'watch' },
      { focus: hallPoint, until: Infinity, artoo: 'cheer', threepio: 'watch' },
    ];

    const applauding = () => troops.troopers.some(({ body }) => body.owners.hands.left !== undefined || body.owners.hands.right !== undefined);
    function* droidAndCrowdSounds() {
      const dome = artoo.bones.dome as Object3D;
      yield* wait(has('Luke medal hung'));
      sound.play('r2Cheer1', { from: dome, volume: 0.8, why: 'R2 cheers Luke' });
      yield* wait(has('Han medal hung'));
      sound.play('r2Cheer2', { from: dome, volume: 0.8, why: 'R2 cheers Han' });
      yield* wait(has('roar'));
      sound.play('roar', { from: chewbacca.bones.head, near: 5, why: 'Chewbacca roars (head thrown back, arms out)' });
      yield* wait(since('roar', 0.35));
      sound.play('threepio', { from: threepio.bones.head, volume: 0.9, why: 'C-3PO startles (hands flying up)' });
      yield* wait(since('roar', 1.1));
      sound.play('r2Whistle', { from: dome, volume: 0.8, why: 'R2 whistles at the roar' });
      yield* wait(applauding);
      mark('applause');
      for (const [x, z] of [[8, 12], [-8, 12], [8, 24], [-8, 24]]) sound.play('crowd', { from: new Vector3(x, 1.7, z), near: 9, volume: 0.8, why: 'the troops applaud and cheer' });
      for (let chirp = 0; ; chirp++) {
        yield* wait(2.2 + (chirp % 3) * 0.7);
        sound.play(chirp % 2 ? 'r2Chatter' : 'r2Cheer1', { from: dome, volume: 0.75, why: 'R2 cheers the finale' });
      }
    }

    function* troopsOfTheHall() {
      yield* parallel('all', troops.replay(), ...troops.troopers.map((trooper) => serve(trooper, has('troops cheer'))));
    }

    // ---- the camera: the film's shots, cut and moved on the action -----------------------------------------------------------------

    const trio = [luke.bones.head, han.bones.head, chewbacca.bones.head];
    const standing = (body: Body) => (out: Vector3) => out.copy(body.position);
    const between = (a: Object3D, b: Object3D, down = 0.1) => (out: Vector3) => middleOf([a, b], out).setY(out.y - down);
    const leiaHead = (out: Vector3) => placeOf(leia.bones.head, out);
    const lukeZ = (z: number) => () => luke.position.z > z;

    function* shots() {
      const d = director;
      // from inside the hall: the doors part on the daylight, the trio waiting in it; they set off as the doors open
      yield* d.shot('the doors open on the trio', fixed([0, 3.2, 15], [0, 2.6, 0], 34), {
        from: fixed([0, 3.6, 16.5], [0, 3.4, 0], 34),
        seconds: 7,
        until: lukeZ(0.6),
      });
      // the wide from high in the doorway, down the aisle between the troops: the trio walks away under the camera, which cranes up
      yield* d.shot('wide from the doorway down the aisle', fixed([0, 10.5, 3], [0, 0.5, 26], 50), {
        from: fixed([0, 9.4, -0.6], [0, 0, 9], 50),
        seconds: 11,
        until: lukeZ(10),
      });
      yield* d.shot('reverse: Leia waits on the dais', panning([0.6, 2.1, 25.5], leiaHead, 9, -0.25), {
        from: panning([0.6, 2.1, 24], leiaHead, 11, -0.25),
        seconds: 4,
        until: 4,
      });
      yield* d.shot('tracking ahead of the trio, the ranks either side', tracking(standing(luke), [0, 1.75, 5.2], [0, 1.3, 0], 40), { until: 7, lag: 0.6 });
      yield* d.shot('tracking alongside, past the officers', tracking(standing(luke), [2.9, 1.6, 3.4], [-0.5, 1.35, -0.3], 34), { until: 5.5, lag: 0.5 });
      // (from beside the steps, off the trio's line: they are still between the ranks)
      yield* d.shot('reverse: Leia, Dodonna and the droids watch them come', fixed([-5.6, 2.3, 31.4], [-1.4, 2.0, 36.3], 30), { until: 3.5 });
      yield* d.shot('behind the trio, craning up as the dais nears', tracking(standing(luke), [0, 4.4, -6.5], [0, 1.4, 9], 42), {
        from: tracking(standing(luke), [0, 2.0, -4.6], [0, 1.6, 9], 42),
        seconds: 6,
        until: lukeZ(31.8),
        lag: 0.5,
      });
      yield* d.shot('the climb, from beside the steps; the bearer brings the medals', panning([-6.8, 2.3, 30.6], (out) => middleOf(trio, out), 34, -0.2), { until: has('medals'), lag: 0.4 });
      // a long lens from high beside the dais, looking down past Han's head onto Luke and Leia in profile
      yield* d.shot('medium: Leia hangs Luke\'s medal', panning([4.8, 3.8, 35.1], between(luke.bones.head, leia.bones.head, 0.15), 17), {
        until: since('Luke medal hung', 1.2),
        lag: 0.4,
      });
      yield* d.shot('cutaway: R2-D2 cheers, C-3PO beside him', fixed([-1.5, 2.15, 32.4], [-3.0, 1.95, 36.0], 30), { until: 2.6 });
      // a long lens from the side of the dais, in profile (nobody stands between Han and the camera)
      yield* d.shot('medium: Leia hangs Han\'s medal', panning([6.5, 2.45, 35.3], between(han.bones.head, leia.bones.head), 17), { until: since('Han medal hung', 0.9), lag: 0.4 });
      // the wink comes 1.5 s after the medal is on; Chewbacca's wind-up 1.2 s after the wink ends (the gestures beat's own timing)
      yield* d.shot('close-up: Han\'s wink', onFace(han, { distance: 1.5, around: 0.6, fov: 24 }), { until: since('wink', 2.7), lag: 0.15 });
      yield* d.shot('close-up: Chewbacca roars', onFace(chewbacca, { distance: 2.3, around: -1.15, up: 0.1, lift: 0.1, fov: 30 }), { until: since('roar', 1.3), lag: 0.3 });
      yield* d.shot('cutaway: C-3PO startles, R2-D2 cheers', onFace(threepio, { distance: 3.3, around: 0.45, up: -0.5, lift: -0.3, fov: 34 }), { until: since('roar', 2.8), lag: 0.2 });
      yield* d.shot('close: Leia smiles', onFace(leia, { distance: 1.7, around: 0.3, fov: 24 }), { until: since('turn', 0.3), lag: 0.3 });
      yield* d.shot('the trio turns to the hall', fixed([0, 2.3, 28.8], [0, 2.15, 34.6], 30), { until: since('turn', 4.5) });
      yield* d.shot('final wide: the hall cheers the heroes', fixed([0, 10.5, 9], [0, 1.8, 34], 46), {
        from: fixed([0, 3.0, 26.5], [0, 2.2, 34], 36),
        seconds: 14,
        until: Infinity,
      });
    }

    let ended = false;
    return {
      extras: troops.troopers.map((trooper) => trooper.body),
      filmed: true,
      story: function* () {
        // the action ends the film; everything else runs beside it as long as it lasts
        yield* parallel('race', action(), daisParty(), droidsLife(artoo, threepio, cues), troopsOfTheHall(), droidAndCrowdSounds(), shots());
        ended = true;
      },
      afterStep(seconds) {
        steps.update();
        director.apply(seconds);
      },
      done: () => {
        const hung = lukeMedal.parent === worn.luke && hanMedal.parent === worn.han;
        lastFilm.ends = { ended, medals: medalMoment?.done() ?? false, hung, turned: turn.done(), cheering };
        return ended && (medalMoment?.done() ?? false) && hung && turn.done() && cheering > 0.9;
      },
      dispose: doors.restore,
    };
  },
};
