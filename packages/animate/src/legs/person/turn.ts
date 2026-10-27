// The trunk's turn about the vertical with the stride: the pelvis and the thorax, walking and running, arms free or holding.
import { lerp } from '../../kernel/math';
import type { PersonLegged } from './legged';

/**
 * How far each turns per metre the left foot leads the right along the facing (rad/m, walking ~1.3 m/s and running ~3.5 m/s; × its
 * legs over the default body's: the stride's length is the legs'). Snippet (Saunders, Schache et al. 2005, Clin Biomech): the lumbo-pelvic turn grows with the
 * stride's length, walking and running alike. Read (Kovše et al. 2026, table): the pelvis 14.2° peak to peak at 2.8 m/s, 15.8° at 3.3, 17.0° at
 * 3.9 (female runners); read (Perpiñá-Martínez et al. 2023): men 10–14°, women 13–16° at 2.4–3.3 m/s; recalled: 8–10° walking. Read
 * (Pontzer et al. 2009, the shoulder line): 8.1° walking 1.5 m/s, 23.75° running 3.0 m/s; the thorax below the shoulder girdle turns less
 * (snippet: MacWilliams et al. 2014 — the thoracic spine takes most of it, more running). Tuned so the feet's ~0.7 m lead walking and
 * ~0.8 m running give the pelvis 8° and 14°, the thorax 8° and 20° peak to peak.
 */
const GAIN = { pelvis: { walk: 0.104, run: 0.15 }, thorax: { walk: 0.104, run: 0.21 } };
/** the foot lead (m, default body) past which the turn grows no further: a lunge or a stretched catching step is not a stride */
const MOST = 1.5;
/**
 * Running with neither arm free to swing (both hands holding), the trunk turns further to take up the legs' swing. Read (Arellano &
 * Kram 2014, J Exp Biol, 3 m/s; the results as the publisher's page gives them): arms held behind the back or across the chest, the shoulders turn 10% / 44% further, the pelvis 63% /
 * 102%; read (Pontzer 2009): arms folded, the shoulders 50% further. Snippet (Seay et al. 2011, Ergonomics): soldiers running with a
 * rifle in both hands turn the trunk further. Walking it barely changes (Pontzer: 8.1° → 8.6°). Here × `thorax` and × `pelvis` running.
 */
const HELD = { thorax: 1.4, pelvis: 1.6 };
/** the thorax rolls with its turn, the shoulder going forward rising (rad per rad, walking and running; CMU mocap) */
const ROLL = { walk: 0.55, run: 0.14 };

/** neither arm free to swing: both hands hold something */
export const armsHeld = (person: Pick<PersonLegged, 'holding'>) => !!person.holding.left && !!person.holding.right;

export interface Turn {
  /** the pelvis's and the thorax's turn off the facing (rad, + to the left), the thorax's roll (rad) */
  pelvis: number;
  thorax: number;
  roll: number;
}

/**
 * The trunk's turn with the stride as the left foot leads the right by `ahead` (m along the facing, × `legs` — its legs over the default
 * body's;
 * − behind), `walk` (0 standing … 1 walking), `run` (0 walking … 1 running); `held`: neither arm free to swing.
 * Walking, the pelvis turns forward on the side of the leading foot, furthest as it lands, the thorax against it — its left forward as the
 * right foot leads, with the arm swinging forward on that side (read, Pontzer 2009: 149° apart at 1.5 m/s). Running, the pelvis turns the
 * other way (snippet, MacWilliams 2014: "pelvic rotation patterns in running were reversed compared with walking"): forward on the side
 * of the trailing foot as it lifts and swings through (snippet, Novacheck 1998: toward the free leg); the thorax still forward on the side
 * opposite the leading foot, so the two turn together (read, Pontzer 2009: 94 ± 61° apart at 3 m/s, 33° with the arms folded; here in
 * phase).
 */
export function strideTurn(ahead: number, legs: number, walk: number, run: number, held: boolean, out: Turn): Turn {
  const lead = MOST * Math.tanh(ahead / legs / MOST) * walk;
  out.pelvis = -lerp(GAIN.pelvis.walk, -GAIN.pelvis.run * (held ? HELD.pelvis : 1), run) * lead;
  out.thorax = lerp(GAIN.thorax.walk, GAIN.thorax.run * (held ? HELD.thorax : 1), run) * lead;
  out.roll = -lerp(ROLL.walk, ROLL.run, run) * out.thorax;
  return out;
}
