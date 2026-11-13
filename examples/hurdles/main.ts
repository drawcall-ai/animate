import { Body } from 'animate-2d'
import { Group } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { race } from './race'
import { type Hurdle, draw, over, track } from './track'

let body: Body
let hurdles: Hurdle[]
/** how far over each bar the lower foot was as it went over it (m) */
let cleared: (number | undefined)[]

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    hurdles = track()
    cleared = hurdles.map(() => undefined)
    body.play(race(body, hurdles))
    return new Group().add(man, draw(hurdles))
  },
  update(delta) {
    body.update(delta)
    hurdles.forEach((hurdle, k) => {
      for (const foot of [body.foot.left, body.foot.right]) {
        const by = over(hurdle, foot.value)
        if (by !== undefined) cleared[k] = Math.min(cleared[k] ?? Infinity, by)
      }
    })
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      ...cleared.map((by, k) => {
        const said = by === undefined ? '…' : `${Math.abs(by).toFixed(2)} m ${by < 0 ? 'under' : 'over'} the bar`
        return `hurdle ${k + 1}  ${said}`
      }),
      `speed     ${body.hips.velocity.z.toFixed(1)} m/s`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
