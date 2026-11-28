// What a recorded line carries: its timing and its sound, all in seconds into the recording.

/** A word as spoken, without punctuation. */
export interface Word {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** An ARPAbet phone without its stress digit (`AA`, `B`): `time` is its acoustic centre within its span, `stress` 1 primary, 0.6 secondary, 0.3 unstressed, 0 for a consonant. */
export interface Phone {
  readonly p: string
  readonly stress: number
  readonly time: number
  readonly start: number
  readonly end: number
}

/** A line as `createSpeech` measures it; its loudness and pitch are empty for a line made without its recording. */
export interface Speech {
  readonly words: readonly Word[]
  readonly phones: readonly Phone[]
  /** RMS loudness at 100 frames a second */
  readonly energy: readonly number[]
  /** pitch (Hz) at 100 frames a second, 0 where unvoiced */
  readonly pitch: readonly number[]
}

/** `Phone.stress` for each ARPAbet stress digit */
const STRESS: Record<string, number> = { 1: 1, 2: 0.6, 0: 0.3 }

/** An ARPAbet symbol as dictionaries and aligners write it (`AA1`): the phone and, with a digit, its stress. */
export function parseArpabet(symbol: string): { p: string; stress?: number } {
  const match = /^(\D+)([012])$/.exec(symbol)
  return match ? { p: match[1], stress: STRESS[match[2]] } : { p: symbol }
}

const ARPABET = new Set("AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG OW OY P R S SH T TH UH UW V W Y Z ZH".split(" "))

/** whether `p` is an ARPAbet phone without its stress digit */
export const isArpabet = (p: string) => ARPABET.has(p)

/** the ARPAbet vowels */
export const VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/
