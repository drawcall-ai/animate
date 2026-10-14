// Judges a scenario: runs it headless (and seeded variations of it) and prints a short report, the
// worst first. Exits 1 when a check fails.
// usage: pnpm judge <scenario> [--vary N] [--json] [--look] [--out captures/look]
//   --vary N  also N seeded variations (the actors' start, facing and height a little off)
//   --json    writes .judge/<scenario>.json and tells what changed since the last run
//   --look    renders the moments worth a look (beats setting off, the worst failures, dead time,
//             the end) and prints yes/no questions per frame for a vision model
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer, createServerModuleRunner } from 'vite';

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: {
    vary: { type: 'string', default: '0' },
    json: { type: 'boolean', default: false },
    look: { type: 'boolean', default: false },
    out: { type: 'string', default: 'captures/look' },
  },
});
const [id] = positionals;
if (!id) throw new Error('usage: pnpm judge <scenario> [--vary N] [--json] [--look]');

const root = fileURLToPath(new URL('..', import.meta.url));
const tracer = fileURLToPath(new URL('../test/beats.ts', import.meta.url));
// (the scenarios' tasks made through the tracer, which itself imports the package)
const beats = {
  name: 'beats',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@drawcall/animate' && importer !== tracer) return tracer;
  },
};
const server = await createServer({ root, plugins: [beats], logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
let result;
try {
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  const { main } = await runner.import('/test/cli.ts');
  result = main(id, { vary: Number(args.vary), json: args.json, look: args.look });
} finally {
  await server.close();
}

if (args.look) {
  const times = result.events.map((e) => e.t.toFixed(2));
  const capture = fileURLToPath(new URL('capture.mjs', import.meta.url));
  const shot = spawnSync('node', [capture, '--examples', id, '--times', times.join(','), '--views', 'three,side', '--trail', '0.5', '--each', '--out', args.out], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (shot.status !== 0) throw new Error('capture failed');
  console.log(`look (${args.out}/, views three-quarter | side, 0.5 s trails): answer each yes/no`);
  result.events.forEach((e, i) => {
    console.log(`${args.out}/${id}@${times[i]}.png — ${e.why}`);
    for (const q of e.questions) console.log(`  [ ] ${q}`);
  });
}
process.exit(result.failed ? 1 : 0);
