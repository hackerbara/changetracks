import MarkdownIt = require('markdown-it');
import markdownItKatex = require('@traptitech/markdown-it-katex');
import { parseForFormat, ChangeType } from '@changedown/core';
import type { ViewMode } from '../view-mode';
import { changedownPlugin, PluginConfig } from '@changedown/preview';

/**
 * Renders markdown (with CriticMarkup) to HTML using markdown-it
 * and the changedown preview plugin. Runs in the extension host.
 *
 * @param viewMode Controls how changes are rendered:
 *   - 'review' (default): full CriticMarkup rendering with colors
 *   - 'changes': full markup rendered, CSS hides deletions and metadata; change gutters visible
 *   - 'raw': pre-change view — insertions stripped, deletions/subs resolved to old text
 *   - 'settled': post-change view — deletions stripped, insertions/subs resolved to new text
 */
export function renderMarkdownToHtml(
    markdown: string,
    isDarkTheme = false,
    viewMode: ViewMode = 'review'
): string {
    const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

    const isChanges = viewMode === 'changes';
    const isResolved = viewMode === 'raw' || viewMode === 'settled';

    const config: PluginConfig = {
        enabled: true,
        showFootnotes: isChanges,  // Changes: keep ref badges (definitions hidden via CSS); others: sidebar handles it
        showComments: !isResolved,
        renderInCodeFences: true,
        metadataDetail: 'badge',
        authorColors: isResolved ? 'never' : 'auto',
        isDarkTheme,
    };

    md.use(markdownItKatex, { throwOnError: false });
    md.use(changedownPlugin, () => config);

    let src = markdown;

    // For raw/settled modes, pre-process to strip one side of changes
    if (isResolved) {
        const doc = parseForFormat(src);
        const changes = [...doc.getChanges()].sort((a, b) => b.range.start - a.range.start);

        for (const c of changes) {
            if (viewMode === 'raw') {
                if (c.type === ChangeType.Insertion) {
                    // Strip insertion entirely — it didn't exist in the original
                    src = src.slice(0, c.range.start) + src.slice(c.range.end);
                } else if (c.type === ChangeType.Deletion) {
                    // Resolve to original text (the deleted content)
                    const text = c.originalText ?? src.slice(c.contentRange.start, c.contentRange.end);
                    src = src.slice(0, c.range.start) + text + src.slice(c.range.end);
                } else if (c.type === ChangeType.Substitution) {
                    // Resolve to original text (before the substitution)
                    const text = c.originalText ?? '';
                    src = src.slice(0, c.range.start) + text + src.slice(c.range.end);
                }
            } else {
                // viewMode === 'settled'
                if (c.type === ChangeType.Insertion) {
                    // Resolve to inserted text (keep the content)
                    const text = c.modifiedText ?? src.slice(c.contentRange.start, c.contentRange.end);
                    src = src.slice(0, c.range.start) + text + src.slice(c.range.end);
                } else if (c.type === ChangeType.Deletion) {
                    // Strip deletion entirely — it's gone in the final
                    src = src.slice(0, c.range.start) + src.slice(c.range.end);
                } else if (c.type === ChangeType.Substitution) {
                    // Resolve to modified text (after the substitution)
                    const text = c.modifiedText ?? '';
                    src = src.slice(0, c.range.start) + text + src.slice(c.range.end);
                }
            }
        }
    }

    return md.render(src);
}
