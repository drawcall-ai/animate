import type { LogEntry } from '@drawcall/animate';
import { SCENARIOS } from '../src/scenarios';
import { run, vary } from './run';

/** Print the body's log, grouping repeated problems by their worst sample. */
export function main(id: string, options: { vary: number; json: boolean }): boolean {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`no scenario "${id}" (known: ${SCENARIOS.map((s) => s.id).join(', ')})`);
  const logs = [run(sc), ...Array.from({ length: options.vary }, (_, i) => run(vary(sc, i + 1)))];
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
    for (const { worst: e, count } of sorted) console.log(`  ${e.check}: ${e.value.toPrecision(3)} > ${e.limit} @${e.time.toFixed(2)}s ${e.where} [${e.beat || 'unlabelled'}] (${count})`);
  });
  return logs.some((log) => log.length > 0);
}
const score = (e: LogEntry) => e.value / Math.max(e.limit, 1e-3);
