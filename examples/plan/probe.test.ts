// @ts-nocheck
import { test } from 'vitest'
import { person } from '../person'
import { play } from './scenes'

test('probe', () => {
  const name = (process.env.S ?? 'shot') as 'shot'
  const p = play(name, person, process.env.V !== 'today')
  const man = p.scene.children[0]
  const out: string[] = []
  for (let k = 0; k < 60 * Number(process.env.T ?? 3.5); k++) {
    p.update(1 / 60)
    if (k % Number(process.env.E ?? 6) === 0) {
      const w = (n: string) => man.getObjectByName(n)!.getWorldPosition(new (man.position.constructor as any)()).toArray().map((v: number) => v.toFixed(2)).join(',')
      const f = (globalThis as any).fig; const v=(x:any)=>x.toArray().map((a:number)=>a.toFixed(2)).join(','); const th=[...f.things.values()][0]?.channel
      const g=f.gait; out.push(`${((k + 1) / 60).toFixed(2)} H ${v(g.hips.value)} hv ${v(g.hips.velocity)} L ${v(g.feet.left.value)} ${g.feet.left.owner} R ${v(g.feet.right.value)} ${g.feet.right.owner} ph ${g.phase.toFixed(2)} st ${g.stepping} | thing ${th&&v(th.value)} fr ${th?.frames.length} rhc ${v(f.hand.right.value)} own ${f.hand.right.owner} hips ${w('hips')} rh ${w('rightHand')} lh ${w('leftHand')} ${p.say()}`)
    }
  }
  console.log(out.join('\n'))
})
