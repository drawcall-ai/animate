import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// test against the workspace packages' TypeScript sources, not their builds
export default defineConfig({ ssr: { resolve: { conditions: ['@prohuman/source', ...defaultServerConditions] } } });
