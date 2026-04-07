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
