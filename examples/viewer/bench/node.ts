// Node benchmark. usage: pnpm bench [-- --n 20,50,100 --seconds 15 --warmup 3 --scenarios stroll,dog-fetch]
// (bundled by vite, run with --expose-gc: see the examples' package.json)
import { parseArgs } from 'node:util';
import { measure, named, report } from './measure';

const { values: args } = parseArgs({
  // (`pnpm bench -- --n 50` passes the `--` on)
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    n: { type: 'string', default: '20,50,100' },
    seconds: { type: 'string', default: '15' },
    warmup: { type: 'string', default: '3' },
    // the scenarios timed (default all)
    scenarios: { type: 'string' },
  },
});
const sizes = args.n.split(',').map(Number);
const scenarios = named(args.scenarios);
const results = [];
for (const n of sizes) results.push(measure(n, Number(args.seconds), Number(args.warmup), scenarios));
console.log(`node ${process.version}, ${args.seconds} s per crowd after ${args.warmup} s warm-up\n`);
console.log(report(results));
