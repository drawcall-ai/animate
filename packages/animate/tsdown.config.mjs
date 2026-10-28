import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  dts: true,
});
