import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // @tryvienna/sdk is a peer dependency provided by the plugin host at
      // runtime. Map it to the local stub for test environments.
      '@tryvienna/sdk': resolve(
        __dirname,
        '../../packages/vienna-plugin/src/vendor/tryvienna-sdk.ts',
      ),
    },
  },
  test: {
    // The Word add-in real-mode harness owns fixed local ports (3001 and 39990).
    // Running test files in parallel lets one worker kill another worker's
    // harness server during readiness checks, producing false launch failures.
    fileParallelism: false,
    setupFiles: ['./vitest-setup.ts'],
    include: [
      'core/**/*.test.ts',
      'engine/**/*.test.ts',
      'mcp/**/*.test.ts',
      'hooks/**/*.test.ts',
      'opencode/**/*.test.ts',
      'lsp/**/*.test.ts',
      'preview/**/*.test.ts',
      'vienna/**/*.test.ts',
      'word-add-in/**/*.test.ts',
      'word-addin/**/*.test.ts',
    ],
    server: {
      deps: {
        inline: [
          '@changedown/core',
          '@changedown/docx',
          '@changedown/lsp-server',
          '@changedown/preview',
          '@changedown/mcp',
          '@changedown/opencode-plugin',
          'changedown',
          'changedown-hooks',
          '@changedown/vienna-plugin',
          'diff',
          'xxhash-wasm',
        ],
      },
    },
  },
});
