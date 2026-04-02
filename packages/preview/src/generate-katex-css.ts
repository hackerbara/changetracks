/**
 * Node.js-only utility for reading KaTeX CSS from disk.
 *
 * Isolated from the main barrel to avoid pulling `fs`/`module` into
 * browser bundles. Import from `@changedown/preview/katex-css` or
 * directly from this file.
 *
 * The CSS includes @font-face rules with relative font paths —
 * consumers must either:
 *   (a) serve the katex/dist/fonts directory alongside the CSS, or
 *   (b) use the CDN version (https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css)
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

export function generateKatexCSS(): string {
  const require = createRequire(import.meta.url);
  const katexCssPath = require.resolve('katex/dist/katex.min.css');
  return readFileSync(katexCssPath, 'utf8');
}
