import type { TranscriptWord } from "../create"

/** Aligning runs a 300 MB speech model, which belongs in the cache plugin's Node run, not in a browser. */
export async function align(audio: string, _text: string): Promise<TranscriptWord[]> {
  throw new Error(
    `The alignment of ${audio} is not cached: load it literally where the @drawcall/cache Vite plugin finds it or, under a Vite base, give the loader its cachePath`,
  )
}
