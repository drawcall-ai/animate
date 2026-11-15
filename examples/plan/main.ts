import { mannequin } from '../mannequin'
import { run } from '../stage'
import { type Played, play, type scenes } from './scenes'

const asked = new URLSearchParams(location.search)
let played: Played
run({
  begin() {
    played = play((asked.get('s') ?? 'shot') as keyof typeof scenes, mannequin, asked.get('v') !== 'today')
    return played.scene
  },
  update: (delta) => played.update(delta),
  focus: () => played.focus(),
  readout: () => played.say(),
})
