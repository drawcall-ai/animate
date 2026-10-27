// Node benchmark. usage: pnpm bench [-- --n 20,50,100 --seconds 15 --warmup 3 --scenarios stroll,dog-fetch --alloc-sites]
// (bundled by vite, run with --expose-gc: see the examples' package.json)
import { Session } from 'node:inspector/promises';
import { parseArgs } from 'node:util';
import { Crowd, measure, named, report, type Host } from './measure';

const { values: args } = parseArgs({
  // (`pnpm bench -- --n 50` passes the `--` on)
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    n: { type: 'string', default: '20,50,100' },
    seconds: { type: 'string', default: '15' },
    warmup: { type: 'string', default: '3' },
    // the scenarios timed (default all)
    scenarios: { type: 'string' },
    'alloc-sites': { type: 'boolean', default: false },
  },
});
const gc = globalThis.gc;
if (!gc) throw new Error('run with --expose-gc');
const host: Host = { heap: () => process.memoryUsage().heapUsed, collect: () => gc() };

const sizes = args.n.split(',').map(Number);
const scenarios = named(args.scenarios);
const results = [];
for (const n of sizes) results.push(await measure(n, Number(args.seconds), Number(args.warmup), host, scenarios));
console.log(`node ${process.version}, ${args.seconds} s per crowd after ${args.warmup} s warm-up\n`);
console.log(report(results));
if (args['alloc-sites']) await allocationSites(new Crowd(sizes[0], scenarios));

