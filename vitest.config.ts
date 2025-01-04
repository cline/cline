import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    deps: {
      interopDefault: true,
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
      'vscode': path.resolve(__dirname, './tests/vscode-mocks.ts'),
    },
  },
});
