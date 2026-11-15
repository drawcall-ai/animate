import { LoadingManager } from 'three'

/**
 * A path from the root of an example's public folder, such as `/models/bowler.glb`, where the page serves it: below
 * Vite's base, which is `/` in development and `/animate/<example>/` on GitHub Pages.
 */
export const served = (path: string) => import.meta.env.BASE_URL + path.replace(/^\//, '')

/**
 * What a rig is loaded with in the browser: its model and the weights the vitecache plugin rigged ahead are read below
 * the base. (The plugin, in Node, loads without them, from the public folder.)
 */
export const rigging = {
  manager: new LoadingManager().setURLModifier((url) => (url.startsWith('/') ? served(url) : url)),
  cache: { cachePath: served('/_vitecache/') },
}
