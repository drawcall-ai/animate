/** the layers the debug view draws, each from its own package's intent */
export const LAYERS = ['plan', 'gait', 'hand', 'body'] as const
export type Layer = (typeof LAYERS)[number]

/** the layers `?debug=plan,gait,hand,body` asks for: every one with a bare `?debug`, none without it */
export function shown(search: string): Set<Layer> {
  const asked = new URLSearchParams(search).get('debug')
  if (asked === null) return new Set()
  return new Set(asked ? LAYERS.filter((layer) => asked.split(',').includes(layer)) : LAYERS)
}
