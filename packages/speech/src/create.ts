import { isArpabet, parseArpabet, type Phone, type Speech, VOWEL } from "./speech"

/** Mono samples, such as a Web Audio `AudioBuffer`. */
export interface Samples {
  readonly sampleRate: number
  getChannelData(channel: number): Float32Array
}

/**
 * A phone an aligner timed (s from the start of the recording). `p` is ARPAbet as Montreal Forced Aligner's ARPA models write it
 * (`AA1`, `B`): convert other aligners' output to this, and drop silence labels (`sil`, `sp`, `spn`). A trailing stress digit sets
 * the stress; `stress` (on `Phone.stress`'s scale, not an ARPAbet digit) applies to a symbol without one; with neither, a vowel is
 * unstressed (0.3). `time`, when the mouth hits the phone, is the middle of its span unless given.
 */
export interface TranscriptPhone {
  readonly p: string
  readonly start: number
  readonly end: number
  readonly time?: number
  readonly stress?: number
}

/** A word as an aligner or a speech-to-text service gives it, punctuation and all, and when it is spoken (s), with its phones when an aligner timed them. */
export interface TranscriptWord {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly phones?: readonly TranscriptPhone[]
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isObject = (value: unknown): value is object => typeof value === "object" && value !== null

/** Whether `value` (parsed JSON) is a list of `TranscriptWord`. */
export function isTranscriptWords(value: unknown): value is TranscriptWord[] {
  return Array.isArray(value) && value.every((w, i) => misword(w, i, value[i - 1]) === undefined)
}

/** what is wrong with `w`, the transcript's word `i`, if anything: its text, its span (finite and in order, starting no earlier
 * than `before`'s) and its phones' */
function misword(w: unknown, i: number, before: unknown): string | undefined {
  if (!isObject(w)) return `word ${i} is ${JSON.stringify(w)}, not { text, start, end }`
  const text: unknown = Reflect.get(w, "text"),
    named = `word ${i} ("${text}")`
  if (typeof text !== "string") return `word ${i} has a text of ${JSON.stringify(text)}`
  const span = misspan(w)
  if (span) return `${named} ${span}`
  const start: unknown = Reflect.get(w, "start"),
    previous: unknown = isObject(before) && Reflect.get(before, "start")
  if (finite(start) && finite(previous) && start < previous) return `${named} starts before the one before it`
  const phones: unknown = Reflect.get(w, "phones")
  if (phones === undefined) return
  if (!Array.isArray(phones)) return `${named} has phones ${JSON.stringify(phones)}, not a list`
  for (const [j, ph] of phones.entries()) {
    if (!isObject(ph)) return `${named} has phone ${j} ${JSON.stringify(ph)}, not { p, start, end }`
    const p: unknown = Reflect.get(ph, "p"),
      time: unknown = Reflect.get(ph, "time"),
      stress: unknown = Reflect.get(ph, "stress")
    if (typeof p !== "string") return `${named} has phone ${j} of ${JSON.stringify(p)}`
    const span = misspan(ph)
    if (span) return `${named} has phone ${j} (${p}) that ${span}`
    if (time !== undefined && !finite(time)) return `${named} has phone ${j} (${p}) at ${time} s`
    if (stress !== undefined && !(finite(stress) && stress >= 0 && stress <= 1)) return `${named} has phone ${j} (${p}) of stress ${stress}, not within 0…1`
  }
}

/** what is wrong with `value`'s span, if anything: start and end are finite, start ≤ end */
function misspan(value: object): string | undefined {
  const start: unknown = Reflect.get(value, "start"),
    end: unknown = Reflect.get(value, "end")
  if (!(finite(start) && finite(end) && start <= end)) return `spans ${start}…${end} s`
}

/** A word as written without its punctuation, inner apostrophes, hyphens and single spaces kept, typographic ones (’ ʼ ‘ and — –) read as ' and -; '' when nothing of it is spoken. */
export const spoken = (text: string) =>
  text
    .replace(/[’ʼ‘]/gu, "'")
    .replace(/[—–]/gu, "-")
    .replace(/[^\p{L}\p{N}'\s-]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^['\s-]+|['\s-]+$/g, "")

/** typical phone lengths in conversational speech (s): a word shorter than their sum is compressed, a longer one drawn out in its vowels */
const LENGTH = { stressed: 0.12, vowel: 0.08, consonant: 0.11 }
/** how much earlier laid-out phones are placed (s): word starts from transcription land a little late, and a mouth ahead of the
 * sound reads as natural where one behind it reads as bad lip sync */
const SHIFT = -0.03
/** a loudness or pitch frame (s) */
const FRAME = 0.01

/**
 * A `Speech` from a transcript and, given, its recording, loudness and pitch measured from channel 0; without one (a line timed by
 * hand, or by a speech service's word timings) the speech has neither, and a face says it evenly. Words with nothing spoken (a lone
 * dash) are dropped, so `Speech.words`, which phrases index, can be shorter than the transcript. A word's phones are used as given
 * (by `CachedSpeechAlignmentLoader` or another aligner); a word without is looked up in the CMU pronouncing dictionary, loaded only
 * then, and its phones laid out within the word. Throws on an unknown phone, a word with no pronunciation (digits: spell numbers
 * out), and a transcript `isTranscriptWords` refuses: a word whose span is not finite and in order (start ≤ end), one that starts
 * before the one before it, or a malformed phone.
 */
export async function createSpeech(transcript: readonly TranscriptWord[], audio?: Samples): Promise<Speech> {
  for (const [i, w] of transcript.entries()) {
    const problem = misword(w, i, transcript[i - 1])
    if (problem) throw new Error(`createSpeech: ${problem}`)
  }
  const samples = audio?.getChannelData(0),
    rate = audio?.sampleRate ?? 0
  const words = transcript.map((w) => ({ ...w, text: spoken(w.text) })).filter((w) => w.text)
  return {
    words: words.map(({ text, start, end }) => ({ text, start, end })),
    phones: await laidOut(words),
    energy: samples ? energy(samples, rate) : [],
    pitch: samples ? pitch(samples, rate) : [],
  }
}

/** the words' phones, those of words without looked up and laid out to fill the word: compressed if it is short, drawn out in its vowels if it is long */
async function laidOut(words: readonly TranscriptWord[]): Promise<Phone[]> {
  const out: Phone[] = []
  let dictionary: typeof import("./pronounce") | undefined
  for (const [i, w] of words.entries()) {
    if (w.phones?.length) {
      out.push(...w.phones.map(aligned))
      continue
    }
    // the dictionary is 4.5 MB: it loads only once a word needs it
    dictionary ??= await import("./pronounce")
    const phones = dictionary.pronounce(w.text)
    const start = w.start + SHIFT,
      end = Math.min(w.end, words[i + 1]?.start ?? w.end) + SHIFT
    const want = phones.map((ph) => (ph.stress === 1 ? LENGTH.stressed : VOWEL.test(ph.p) ? LENGTH.vowel : LENGTH.consonant))
    const total = want.reduce((a, b) => a + b, 0),
      spare = end - start - total
    const vowels = want.reduce((sum, d, j) => sum + (VOWEL.test(phones[j].p) ? d : 0), 0)
    const length = (j: number) => {
      if (spare < 0) return (want[j] * (end - start)) / total
      if (vowels === 0) return want[j] + (spare * want[j]) / total
      return want[j] + (VOWEL.test(phones[j].p) ? (spare * want[j]) / vowels : 0)
    }
    let t = start
    for (const [j, ph] of phones.entries()) {
      const d = length(j)
      t += d
      out.push({ ...ph, start: t - d, time: t - d / 2, end: t })
    }
  }
  return out
}

/** an aligner's phone as a `Phone`, its stress digit, if any, moved into `stress` */
function aligned({ p: symbol, start, end, time = (start + end) / 2, stress: given }: TranscriptPhone): Phone {
  const { p, stress = given ?? (VOWEL.test(p) ? 0.3 : 0) } = parseArpabet(symbol)
  if (!isArpabet(p)) throw new Error(`createSpeech: unknown phone "${symbol}"; ARPAbet expected, such as AA1 or B`)
  return { p, stress, time, start, end }
}

/** RMS loudness per frame; a frame's samples are rounded from its exact span, so the track stays at 100 a second */
function energy(x: Float32Array, rate: number): number[] {
  const hop = rate * FRAME,
    out: number[] = []
  for (let i = 0; Math.round((i + 1) * hop) <= x.length; i++) {
    const a = Math.round(i * hop),
      b = Math.round((i + 1) * hop)
    let s = 0
    for (let k = a; k < b; k++) s += x[k] * x[k]
    out.push(Math.sqrt(s / (b - a)))
  }
  return out
}

/** pitch (Hz) per frame by autocorrelation over 40 ms at about 8 kHz, 0 where unvoiced or quiet */
function pitch(samples: Float32Array, sampleRate: number): number[] {
  // speech pitch stays far below 4 kHz, so averaging down to about 8 kHz keeps it and cuts the search ninefold
  const step = Math.max(1, Math.floor(sampleRate / 8000)),
    rate = sampleRate / step
  const x = new Float32Array(Math.floor(samples.length / step))
  for (let i = 0; i < x.length; i++) {
    let s = 0
    for (let k = 0; k < step; k++) s += samples[i * step + k]
    x[i] = s / step
  }
  const hop = rate * FRAME,
    size = Math.round(rate * 0.04)
  const minLag = Math.floor(rate / 400),
    maxLag = Math.ceil(rate / 70)
  const out: number[] = []
  for (let i = 0; i + hop <= x.length; i += hop) {
    const a = Math.max(0, Math.round(i + hop / 2 - size / 2))
    if (a + size + maxLag + 1 > x.length) {
      out.push(0)
      continue
    }
    let e0 = 0
    for (let k = a; k < a + size; k++) e0 += x[k] * x[k]
    if (e0 / size < 1e-5) {
      out.push(0)
      continue
    }
    const r: number[] = []
    for (let l = minLag; l <= maxLag + 1; l++) {
      let c = 0,
        e1 = 0
      for (let k = a; k < a + size; k++) {
        c += x[k] * x[k + l]
        e1 += x[k + l] * x[k + l]
      }
      r.push(c / Math.sqrt(e0 * e1 || 1))
    }
    const best = Math.max(...r)
    // multiples of the period correlate about as well as the period itself: the shortest lag close to the best
    const lag = r.findIndex((v, j) => v >= 0.9 * best && v >= (r[j - 1] ?? 0) && v >= (r[j + 1] ?? 0))
    out.push(best > 0.6 ? rate / (minLag + lag) : 0)
  }
  return out
}
