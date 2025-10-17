import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Jest-like globals such as describe, it, expect
    environment: 'node', // Run tests in Node.js environment
    // setupFiles: ['./src/test/setup.ts'],  // Your test setup file if needed
    exclude: ['**/vendor/**', '**/node_modules/**', '**/dist/**'],
  },
});
