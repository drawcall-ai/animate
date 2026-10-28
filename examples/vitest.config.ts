import { defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config';

// Share the library’s life-seed variation so scenario tests exercise the same idle motion. A scenario test simulates whole
// scenes (2–4 s each alone), so it is given the time it takes on a loaded machine, not vitest's default 5 s.
export default mergeConfig(vite, defineConfig({ test: { setupFiles: ['../packages/animate/test/life-seed.ts', './test/asked.ts'], testTimeout: 30_000 } }));
