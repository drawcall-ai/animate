import { isTranscriptWords, type TranscriptWord } from "../create"

/** A recording and what is said in it, to be timed word by word and phone by phone. */
export interface SpeechAlignmentRequest {
  /** the recording: a root-absolute public path (`/speech/line.mp3`) or a full URL; WAV, MP3, Ogg, FLAC and most other formats */
  audio: string
  /** what is said in it, word for word: words are looked up in the CMU pronouncing dictionary, so spell out numbers */
  text: string
}

/** Where browsers read cached alignments. */
export interface SpeechAlignmentCacheOptions {
  /** the URL browsers read cached results from, any Vite base included (`/app/_cache/`; default `/_cache/`) */
  cachePath?: string
}

/**
 * Times each word of a text and its phones in a recording, for `createSpeech`, cached with @drawcall/cache: its Vite plugin
 * aligns in Node with a speech model (the optional peers `@huggingface/transformers`, `@audio/decode` and `@audio/resample-sinc`;
 * the first run downloads 300 MB), and browsers only read the result. Write each load literally,
 * `new CachedSpeechAlignmentLoader().loadAsync({ audio: "/speech/line.mp3", text: "…" })`, so the plugin finds it.
 */
export class CachedSpeechAlignmentLoader {
  readonly #cachePath: string | undefined

  constructor({ cachePath }: SpeechAlignmentCacheOptions = {}) {
    this.#cachePath = cachePath
  }

  /** Throws on an `audio` that is neither root-absolute nor a URL, and, in a browser, on an alignment the plugin has not cached. */
  async loadAsync({ audio, text }: SpeechAlignmentRequest): Promise<TranscriptWord[]> {
    // Node, which aligns, has no page to resolve a relative URL against
    const rootAbsolute = audio.startsWith("/") && !audio.startsWith("//")
    if (!rootAbsolute && !URL.canParse(audio))
      throw new Error(`CachedSpeechAlignmentLoader: audio must be a root-absolute path like /speech/line.mp3 or a full URL, not ${audio}`)
    // an optional peer: only an app that aligns needs it
    const { CacheEntry, publicFile } = await import("@drawcall/cache")
    const entry = new CacheEntry({
      // bumped when the alignment or its JSON changes
      version: "speech-alignment@2",
      basePath: this.#cachePath,
      dependencies: { audio: { value: audio }, text: { value: text } },
    })
    const bytes = await entry.load()
    if (bytes) {
      const words: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (!isTranscriptWords(words)) throw new Error(`CachedSpeechAlignmentLoader: the cached alignment of ${audio} is no transcript`)
      return words
    }
    // the aligner is Node's alone: `#align` is a stub in browsers, which never bundle the speech model
    const { align } = await import("#align")
    const words = await align(audio, text)
    // a re-recording at the same path aligns again
    await entry.save(new TextEncoder().encode(JSON.stringify(words)), { dependencies: rootAbsolute ? [{ path: publicFile(audio) }] : [] })
    return words
  }
}
