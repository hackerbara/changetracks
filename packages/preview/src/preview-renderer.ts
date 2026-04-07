import MarkdownIt from 'markdown-it';
import markdownItKatex from '@traptitech/markdown-it-katex';
import { CriticMarkupParser, computeCurrentView, computeOriginalText } from '@changedown/core';
import type { ChangeNode } from '@changedown/core';
import type { View } from '@changedown/core/host';
import { changedownPlugin } from './plugin.js';
import { headingIdPlugin } from './heading-id-plugin.js';
import type { PluginConfig } from './plugin.js';

export interface PreviewRendererOptions {
  sourceMap?: boolean;
  urlResolver?: (url: string) => string | null;
}

export interface RenderResult {
  html: string;
  changes: ChangeNode[];
}

export interface PreviewRenderer {
  render(text: string, view: View, env?: Record<string, unknown>): RenderResult;
  dispose(): void;
}

const parser = new CriticMarkupParser();

function makeConfig(view: View, opts: PreviewRendererOptions): PluginConfig {
  return {
    enabled: true,
    showFootnotes: (view.display.footnotes ?? 'show') !== 'hide',
    showComments: true,
    renderInCodeFences: true,
    metadataDetail: 'badge',
    authorColors: view.display.authorColors ?? 'auto',
    isDarkTheme: true,
    emitSourceMap: opts.sourceMap,
    urlResolver: opts.urlResolver,
    viewName: view.name,
  };
}

/**
 * Apply the KaTeX math plugin to a MarkdownIt instance.
 * Handles $...$ (inline) and $$...$$ (display) delimiters.
 * throwOnError is false: invalid LaTeX renders as an error span rather than
 * throwing and breaking the entire preview.
 */
function applyMathPlugin(md: MarkdownIt): void {
  md.use(markdownItKatex, { throwOnError: false });
}

/** Add data-source-line attributes to block tokens for scroll sync. */
function addSourceLinePlugin(md: MarkdownIt): void {
  for (const rule of ['paragraph_open', 'heading_open', 'blockquote_open', 'list_item_open', 'hr', 'code_block', 'fence'] as const) {
    const original = md.renderer.rules[rule];
    md.renderer.rules[rule] = function (tokens: any, idx: any, options: any, env: any, self: any) {
      const token = tokens[idx];
      if (token.map && token.map.length >= 1) {
        const currentLine = token.map[0] + 1; // 1-based
        const currentToRaw: Map<number, number> | undefined = env?.currentToRaw;
        const originalLine = currentToRaw?.get(currentLine) ?? currentLine;
        token.attrSet('data-source-line', String(originalLine));
      }
      return original
        ? original(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
    };
  }
}

export function createPreviewRenderer(opts: PreviewRendererOptions = {}): PreviewRenderer {
  let pluginMd: MarkdownIt | null = null;
  let lastCacheKey: string | null = null;
  let plainMd: MarkdownIt | null = null;

  function getPluginMd(view: View): MarkdownIt {
    const cacheKey = `${view.name}:${view.display.footnotes ?? 'show'}:${view.display.authorColors ?? 'auto'}`;
    if (pluginMd && lastCacheKey === cacheKey) return pluginMd;
    const config = makeConfig(view, opts);
    const instance = new MarkdownIt({ html: true, linkify: true });
    applyMathPlugin(instance);
    changedownPlugin(instance, () => config);
    instance.use(headingIdPlugin);
    // sourceMap handled by changedownPlugin when emitSourceMap is true
    pluginMd = instance;
    lastCacheKey = cacheKey;
    return instance;
  }

  function getPlainMd(): MarkdownIt {
    if (plainMd) return plainMd;
    plainMd = new MarkdownIt({ html: true, linkify: true });
    applyMathPlugin(plainMd);
    plainMd.use(headingIdPlugin);
    if (opts.sourceMap) addSourceLinePlugin(plainMd);
    return plainMd;
  }

  return {
    render(text: string, view: View, env?: Record<string, unknown>): RenderResult {
      const changes = parser.parse(text).getChanges();

      if (view.projection === 'decided') {
        const settled = computeCurrentView(text, changes);
        const currentText = settled.lines.map(l => l.text).join('\n');
        const currentEnv = { currentToRaw: settled.currentToRaw, ...env };
        return { html: getPlainMd().render(currentText, currentEnv), changes };
      }

      if (view.projection === 'original') {
        const original = computeOriginalText(text);
        return { html: getPlainMd().render(original, env ?? {}), changes };
      }

      return { html: getPluginMd(view).render(text, env ?? {}), changes };
    },

    dispose() {
      pluginMd = null;
      lastCacheKey = null;
      plainMd = null;
    },
  };
}
