import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// test against @prohuman/core's TypeScript source, not its build
export default defineConfig({ ssr: { resolve: { conditions: ['@prohuman/source', ...defaultServerConditions] } } });
