import type { LogEntry } from '@drawcall/animate';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, seeded } from './run';

/** Prints the scenario's log (and those of `vary` seeded variations of its people), grouping repeated problems by their worst sample. */
export function main(id: string, options: { vary: number; json: boolean }): boolean {
  if (id === 'all') return SCENARIOS.map((sc) => main(sc.id, options)).some(Boolean);
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`no scenario "${id}" (known: ${SCENARIOS.map((s) => s.id).join(', ')})`);
  const logs = [run(sc), ...Array.from({ length: options.vary }, (_, i) => run(sc, { vary: seeded(i + 1) }))];
  if (options.json) console.log(JSON.stringify(logs));
  else logs.forEach((log, i) => {
    const groups = new Map<string, { worst: LogEntry; count: number }>();
    for (const entry of log) {
      const key = `${entry.check}|${entry.where}|${entry.beat}`;
      const group = groups.get(key);
      if (!group) groups.set(key, { worst: entry, count: 1 });
      else {
        group.count++;
        if (entry.value > group.worst.value) group.worst = entry;
      }
    }
    console.log(`${id}${i ? ` #${i}` : ''}: ${log.length ? `${log.length} entries` : 'clean log'}`);
    const sorted = [...groups.values()].sort((a, b) => score(b.worst) - score(a.worst));
    for (const { worst: e, count } of sorted) console.log(`  ${e.check}${knownFailure(e) ? ' (known)' : ''}: ${e.value.toPrecision(3)} > ${e.limit} @${e.time.toFixed(2)}s ${e.where} [${e.beat || 'unlabelled'}] (${count})`);
  });
  return logs.some((log) => log.some((entry) => !knownFailure(entry)));
}
const score = (e: LogEntry) => e.value / Math.max(e.limit, 1e-3);
