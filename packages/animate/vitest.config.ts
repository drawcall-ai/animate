import { defineConfig } from 'vitest/config';

// (a test steps whole stories headless, up to a few seconds each alone: it is given the time it takes on a loaded machine, not vitest's 5 s)
export default defineConfig({ test: { setupFiles: ['./test/life-seed.ts'], testTimeout: 30_000 } });
