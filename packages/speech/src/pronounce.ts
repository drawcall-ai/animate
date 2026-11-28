// How words are pronounced, from the CMU pronouncing dictionary: imported lazily, the dictionary being 4.5 MB.

import { dictionary } from "cmu-pronouncing-dictionary"
import { parseArpabet, VOWEL } from "./speech"

/** a rough guess for words missing from the dictionary, a phone for each letter a…z, keeping the lips' closures on b, m and p */
const LETTER: Record<string, string> = Object.fromEntries(
  "AE B K D EH F G HH IH JH K L M N AA P K R S T AH V W K Y Z".split(" ").map((p, i) => [String.fromCharCode(97 + i), p]),
)

/** ARPAbet phones with stress, from the dictionary or, for an unknown word, its letters; parts split by hyphens or spaces in turn.
 * Throws on a part with no pronunciation (one with digits the dictionary lacks). */
export function pronounce(word: string): { p: string; stress: number }[] {
  return word
    .toLowerCase()
    .split(/[-\s]+/)
    .filter(Boolean)
    .flatMap((part) => {
      const phones = lookup(part)
      if (!phones.length) throw new Error(`No pronunciation for "${word}": spell it out, numbers as words`)
      return phones
    })
}

function lookup(part: string): { p: string; stress: number }[] {
  const entry = dictionary[part] ?? dictionary[part.replace(/'/g, "")]
  if (entry)
    return entry.split(" ").map((token) => {
      const { p, stress = 0 } = parseArpabet(token)
      return { p, stress }
    })
  // letters guess nothing about how digits are read
  if (/\p{N}/u.test(part)) return []
  return [...part].flatMap((c) => (LETTER[c] ? [{ p: LETTER[c], stress: VOWEL.test(LETTER[c]) ? 0.6 : 0 }] : []))
}
