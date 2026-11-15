import { Layers } from '@drawcall/debug'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { type Played, play, type scenes } from './scenes'

const asked = new URLSearchParams(location.search)
// each layer's own view: `?debug=plan,gait,body`, or `?debug` for all of them
const shown = asked.get('debug')
const layers = shown === null ? undefined : new Layers(new Set(shown ? shown.split(',') : ['plan', 'gait', 'body']))
let played: Played
run({
  begin() {
    played = play((asked.get('s') ?? 'shot') as keyof typeof scenes, mannequin, asked.get('v') !== 'today')
    if (layers) played.scene.add(layers)
    return played.scene
  },
  update(delta) {
    played.update(delta)
    const told = played.told?.()
    if (layers && told) layers.draw(told)
  },
  focus: () => played.focus(),
  readout: () => played.say(),
})
