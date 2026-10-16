import { defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config';

export default mergeConfig(vite, defineConfig({ test: { setupFiles: ['../packages/animate/test/life-seed.ts'] } }));
