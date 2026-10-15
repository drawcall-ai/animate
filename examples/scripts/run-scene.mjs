// Run scenarios headlessly; verification stays in behaviours and their owning modules.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer, createServerModuleRunner } from 'vite';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'), allowPositionals: true,
  options: { vary: { type: 'string', default: '0' }, json: { type: 'boolean', default: false } },
});
const [id] = positionals;
const count = Number(values.vary);
if (!id || positionals.length !== 1 || !Number.isInteger(count) || count < 0) throw new Error('usage: pnpm run-scene <id> [--vary N] [--json]');
const root = fileURLToPath(new URL('..', import.meta.url));
const tracer = fileURLToPath(new URL('../test/beats.ts', import.meta.url));
const labels = {
  name: 'labels', enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@drawcall/animate' && importer !== tracer && importer?.includes('/src/scenarios/')) return tracer;
  },
};
const server = await createServer({ root, plugins: [labels], logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  const { main } = await runner.import('/test/cli.ts');
  process.exitCode = main(id, { vary: count, json: values.json }) ? 1 : 0;
} finally { await server.close(); }
