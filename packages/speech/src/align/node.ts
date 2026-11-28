import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import decode from "@audio/decode"
import resample from "@audio/resample-sinc"
import { publicURL } from "@drawcall/cache"
import { AutoModelForCTC, AutoProcessor, env, Tensor } from "@huggingface/transformers"
import { spoken, type TranscriptWord } from "../create"
import { pronounce } from "../pronounce"
import { logSoftmax, spanned, viterbi } from "./ctc"

// CTC forced alignment: a wav2vec2 model that hears IPA phones gives each 20 ms frame of the recording a probability per phone, and
// the most likely path through the text's dictionary phones, in order, times each of them.

const MODEL = "onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX"
/** the model's sample rate (Hz) */
const RATE = 16000
/** the model's IPA token for each ARPAbet phone: stressed AH and ER sound other than unstressed ones */
const IPA: Record<string, string> = {
  AA: "ɑː",
  AE: "æ",
  AH1: "ʌ",
  AH: "ə",
  AO: "ɔː",
  AW: "aʊ",
  AY: "aɪ",
  EH: "ɛ",
  ER1: "ɜː",
  ER: "ɚ",
  EY: "eɪ",
  IH: "ɪ",
  IY: "iː",
  OW: "oʊ",
  OY: "ɔɪ",
  UH: "ʊ",
  UW: "uː",
  B: "b",
  CH: "tʃ",
  D: "d",
  DH: "ð",
  F: "f",
  G: "ɡ",
  HH: "h",
  JH: "dʒ",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ŋ",
  P: "p",
  R: "ɹ",
  S: "s",
  SH: "ʃ",
  T: "t",
  TH: "θ",
  V: "v",
  W: "w",
  Y: "j",
  Z: "z",
  ZH: "ʒ",
}

// (one model for every load the cache plugin runs at once; a failed load is forgotten, so the next call tries again)
let loaded:
  | Promise<[Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>, Awaited<ReturnType<typeof AutoModelForCTC.from_pretrained>>, Map<string, number>]>
  | undefined
const model = () =>
  (loaded ??= Promise.all([AutoProcessor.from_pretrained(MODEL), AutoModelForCTC.from_pretrained(MODEL, { dtype: "q8" }), loadVocab()]).catch(
    (error: unknown) => {
      loaded = undefined
      throw error
    },
  ))

/** The model's token ids. Transformers loads no vocab.json for a model without tokenizer.json and exports no loader for its hub files,
 * so the file is downloaded once into transformers' cache directory, beside the model files it caches. */
async function loadVocab(): Promise<Map<string, number>> {
  const file = join(env.cacheDir, MODEL, "vocab.json")
  if (!existsSync(file)) {
    const path = env.remotePathTemplate.replaceAll("{model}", MODEL).replaceAll("{revision}", "main")
    const response = await fetch(new URL(`${path}vocab.json`, env.remoteHost))
    if (!response.ok) throw new Error(`Could not load the ${MODEL} vocabulary (${response.status})`)
    await mkdir(dirname(file), { recursive: true })
    // (renamed into place, so that an interrupted download leaves no partial file)
    await writeFile(`${file}.part`, new Uint8Array(await response.arrayBuffer()))
    await rename(`${file}.part`, file)
  }
  const vocab: unknown = JSON.parse(await readFile(file, "utf8"))
  if (typeof vocab !== "object" || vocab === null) throw new Error(`The ${MODEL} vocabulary is not a JSON object`)
  return new Map(Object.entries(vocab).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
}

/** `text`'s words and phones timed in the recording at `audio` (a public path or URL). */
export async function align(audio: string, text: string): Promise<TranscriptWord[]> {
  const words = text
    .split(/\s+/)
    .map(spoken)
    .filter(Boolean)
    .map((word) => ({ word, phones: pronounce(word) }))
  if (words.length === 0) throw new Error(`Nothing to align in the text for ${audio}: "${text}"`)
  const response = await fetch(publicURL(audio))
  if (!response.ok) throw new Error(`Could not load ${audio} (${response.status})`)
  const [processor, ctc, vocab] = await model()
  const token = (ipa: string) => {
    const id = vocab.get(ipa)
    if (id === undefined) throw new Error(`${MODEL} has no token ${ipa}`)
    return id
  }
  const phones = words.flatMap(({ phones }, w) => phones.map((ph) => ({ ...ph, w })))
  const target = phones.map(({ p, stress }) => token(IPA[stress === 1 && IPA[`${p}1`] ? `${p}1` : p]))

  const decoded = await decode(new Uint8Array(await response.arrayBuffer()))
  const samples = resample(decoded.channelData[0], { from: decoded.sampleRate, to: RATE })
  const { logits }: { logits: unknown } = await ctc(await processor(samples))
  if (!(logits instanceof Tensor) || !(logits.data instanceof Float32Array)) throw new Error(`${MODEL} gave no float32 logits`)
  const [, frames, tokens] = logits.dims
  const spans = viterbi(logSoftmax(logits.data, frames, tokens), frames, tokens, target, token("<pad>"))
  const frame = samples.length / RATE / frames

  const timed = spanned(phones.map(({ p, stress }, k) => ({ p, stress, time: ((spans[k][0] + spans[k][1] + 1) / 2) * frame })))
  return words.map(({ word }, w) => {
    const own = timed.filter((_, k) => phones[k].w === w)
    return { text: word, start: own[0].start, end: own[own.length - 1].end, phones: own }
  })
}
