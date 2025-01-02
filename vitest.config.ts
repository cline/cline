import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Use node environment for more comprehensive testing
    environment: 'node',
    
    // Glob patterns for test files
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'src/test/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'src/utils/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'src/shared/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'src/__tests__/**/*.{test,spec}.{js,ts,jsx,tsx}'
    ],
    
    // Exclude patterns
    exclude: [
      '**/node_modules/**', 
      '**/dist/**', 
      '**/.{idea,git,cache,output,temp}/**'
    ],
    
    // Coverage configuration
    coverage: {
      provider: 'v8', // Use V8 for coverage
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      
      // Minimum coverage thresholds
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80
      }
    },
    
    // Alias configuration for easier imports
    alias: {
      '@': path.resolve(__dirname, './src')
    },
    
    // Global setup files
    setupFiles: [
      './src/__tests__/setup.ts'
    ],
    
    // Timeout and performance settings
    testTimeout: 10000, // 10 seconds max per test
    
    // Ensure globals are available
    globals: true,
    
    // Improve logging and debugging
    reporters: ['verbose'],
    
    // Collect coverage by default
    collectCoverage: true,
    
    // Detailed logging
    logHeapUsage: true,
    
    // Fail on zero tests
    failOnEmpty: true
  }
});
