import { defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config';

// Share the library’s life-seed variation so scenario tests exercise the same idle motion.
export default mergeConfig(vite, defineConfig({ test: { setupFiles: ['../packages/animate/test/life-seed.ts'] } }));
