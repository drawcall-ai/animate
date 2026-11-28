import { expect, test } from "vitest"
import { createSpeech } from "../src"
import { isTranscriptWords } from "../src/create"

// a second of a 150 Hz tone at 48 kHz, standing in for a voiced recording
const rate = 48000
const tone = Float32Array.from({ length: rate }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 150 * i) / rate))
const audio = { sampleRate: rate, getChannelData: () => tone }
/** how much earlier laid-out phones are placed than their words (s) */
const SHIFT = -0.03
const symbols = async (text: string) => (await createSpeech(audio, [{ text, start: 0.1, end: 0.5 }])).phones.map((p) => p.p)

test("drops what is not spoken, looks words up, guesses unknown ones keeping their closures, and fits the phones in each word", async () => {
  const speech = await createSpeech(audio, [
    { text: "Hello,", start: 0.1, end: 0.45 },
    { text: "Bob!", start: 0.5, end: 0.8 },
    { text: "-", start: 0.8, end: 0.85 },
    { text: "zorbly", start: 0.85, end: 0.95 },
  ])
  expect(speech.words.map((w) => w.text)).toEqual(["Hello", "Bob", "zorbly"])
  expect(
    speech.phones
      .slice(0, 7)
      .map((p) => p.p)
      .join(" "),
  ).toBe("HH AH L OW B AA B")
  expect(speech.phones.slice(7).some((p) => p.p === "B")).toBe(true)
  for (const [i, w] of speech.words.entries()) {
    const own = speech.phones.filter((p) => p.time > w.start - 0.05 && p.time < w.end)
    expect(own.length, w.text).toBeGreaterThan(0)
    expect(
      own.every((p) => p.start >= w.start + SHIFT - 1e-9 && p.end <= (speech.words[i + 1]?.start ?? w.end) + SHIFT + 1e-9),
      w.text,
    ).toBe(true)
  }
})

test("measures loudness and pitch at 100 frames a second, whatever the sample rate", async () => {
  const speech = await createSpeech(audio, [])
  expect(speech.energy.length).toBe(100)
  // at 22050 Hz a frame is 220.5 samples
  expect((await createSpeech({ sampleRate: 22050, getChannelData: () => tone.subarray(0, 22050) }, [])).energy.length).toBe(100)
  const voiced = speech.pitch.filter((f) => f > 0)
  expect(voiced.length).toBeGreaterThan(80)
  expect(voiced.every((f) => Math.abs(f - 150) < 5)).toBe(true)
})

test("reads typographic apostrophes and dashes as plain ones and a space inside a word as a break, and refuses digits", async () => {
  expect(await symbols("you’re")).toEqual(await symbols("you're"))
  expect(await symbols("it—I")).toEqual([...(await symbols("it")), ...(await symbols("I"))])
  expect((await symbols("Hello there")).join(" ")).toBe("HH AH L OW DH EH R")
  await expect(createSpeech(audio, [{ text: "42", start: 0.1, end: 0.5 }])).rejects.toThrow('No pronunciation for "42"')
  await expect(createSpeech(audio, [{ text: "1990s", start: 0.1, end: 0.5 }])).rejects.toThrow('No pronunciation for "1990s"')
})

test("takes an aligner's phones as given, a stress digit moved into its stress, and refuses symbols outside ARPAbet", async () => {
  const phones = (p: string) => [{ text: "odd", start: 0.1, end: 0.5, phones: [{ p, start: 0.1, end: 0.5 }] }]
  expect((await createSpeech(audio, phones("AA1"))).phones).toEqual([{ p: "AA", stress: 1, time: 0.3, start: 0.1, end: 0.5 }])
  await expect(createSpeech(audio, phones("XX"))).rejects.toThrow('unknown phone "XX"')
  expect((await createSpeech(audio, [...phones("AA"), ...phones("B")])).phones.map((p) => p.stress)).toEqual([0.3, 0])
  // a given stress is on the phone's scale: an ARPAbet digit, 2 for secondary, is refused
  expect(isTranscriptWords([{ text: "odd", start: 0.1, end: 0.5, phones: [{ p: "AA", start: 0.1, end: 0.5, stress: 2 }] }])).toBe(false)
  expect(isTranscriptWords([{ text: "odd", start: 0.5, end: 0.1 }])).toBe(false)
})

test("refuses words whose span is not finite and in order, or that come out of order, and keeps dense words in order", async () => {
  await expect(createSpeech(audio, [{ text: "odd", start: 0.5, end: 0.1 }])).rejects.toThrow('word 0 ("odd") spans 0.5…0.1 s')
  await expect(createSpeech(audio, [{ text: "odd", start: NaN, end: 0.1 }])).rejects.toThrow('word 0 ("odd") spans NaN…0.1 s')
  await expect(
    createSpeech(audio, [
      { text: "one", start: 0.4, end: 0.6 },
      { text: "two", start: 0.1, end: 0.3 },
    ]),
  ).rejects.toThrow('word 1 ("two") starts before the one before it')
  // eight phones in 0.1 s: in order and within the word
  const { phones } = await createSpeech(audio, [{ text: "strengths", start: 0.1, end: 0.2 }])
  expect(phones.length).toBeGreaterThanOrEqual(8)
  for (const [i, ph] of phones.entries()) {
    expect(ph.start).toBeLessThanOrEqual(ph.time)
    expect(ph.time).toBeLessThanOrEqual(ph.end)
    if (i > 0) expect(ph.start).toBeCloseTo(phones[i - 1].end)
  }
  expect(phones[phones.length - 1].end).toBeLessThanOrEqual(0.2 + SHIFT + 1e-9)
})
