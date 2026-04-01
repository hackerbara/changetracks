import MarkdownIt from 'markdown-it';
import { CriticMarkupParser, computeSettledView, computeOriginalText } from '@changedown/core';
import type { ChangeNode } from '@changedown/core';
import type { ViewMode } from '@changedown/core/host';
import { changedownPlugin } from './plugin.js';
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
  render(text: string, viewMode: ViewMode): RenderResult;
  dispose(): void;
}

const parser = new CriticMarkupParser();

function makeConfig(viewMode: ViewMode, opts: PreviewRendererOptions): PluginConfig {
  return {
    enabled: true,
    showFootnotes: viewMode === 'review',
    showComments: true,
    renderInCodeFences: true,
    metadataDetail: 'badge',
    authorColors: 'auto',
    isDarkTheme: true,
    emitSourceMap: opts.sourceMap,
    urlResolver: opts.urlResolver,
  };
}

/** Add data-source-line attributes to block tokens for scroll sync. */
function addSourceLinePlugin(md: MarkdownIt): void {
  for (const rule of ['paragraph_open', 'heading_open', 'blockquote_open', 'list_item_open', 'hr', 'code_block', 'fence'] as const) {
    const original = md.renderer.rules[rule];
    md.renderer.rules[rule] = function (tokens: any, idx: any, options: any, env: any, self: any) {
      const token = tokens[idx];
      if (token.map && token.map.length >= 1) {
        const settledLine = token.map[0] + 1; // 1-based
        const settledToRaw: Map<number, number> | undefined = env?.settledToRaw;
        const originalLine = settledToRaw?.get(settledLine) ?? settledLine;
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
  let lastPluginViewMode: ViewMode | null = null;
  let plainMd: MarkdownIt | null = null;

  function getPluginMd(viewMode: ViewMode): MarkdownIt {
    if (pluginMd && lastPluginViewMode === viewMode) return pluginMd;
    const config = makeConfig(viewMode, opts);
    const instance = new MarkdownIt({ html: true, linkify: true });
    changedownPlugin(instance, () => config);
    // sourceMap handled by changedownPlugin when emitSourceMap is true
    pluginMd = instance;
    lastPluginViewMode = viewMode;
    return instance;
  }

  function getPlainMd(): MarkdownIt {
    if (plainMd) return plainMd;
    plainMd = new MarkdownIt({ html: true, linkify: true });
    if (opts.sourceMap) addSourceLinePlugin(plainMd);
    return plainMd;
  }

  return {
    render(text: string, viewMode: ViewMode): RenderResult {
      const changes = parser.parse(text).getChanges();

      if (viewMode === 'settled') {
        const view = computeSettledView(text, changes);
        const settledText = view.lines.map(l => l.text).join('\n');
        const env = { settledToRaw: view.settledToRaw };
        return { html: getPlainMd().render(settledText, env), changes };
      }

      if (viewMode === 'raw') {
        const original = computeOriginalText(text);
        return { html: getPlainMd().render(original), changes };
      }

      return { html: getPluginMd(viewMode).render(text), changes };
    },

    dispose() {
      pluginMd = null;
      plainMd = null;
    },
  };
}
