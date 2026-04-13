import MarkdownIt = require('markdown-it');
import markdownItKatex = require('@traptitech/markdown-it-katex');
import { parseForFormat, ChangeType } from '@changedown/core';
import type { BuiltinView } from '@changedown/core/host';
import { changedownPlugin, PluginConfig } from '@changedown/preview';

/**
 * Renders markdown (with CriticMarkup) to HTML using markdown-it
 * and the changedown preview plugin. Runs in the extension host.
 *
 * @param view Controls how changes are rendered:
 *   - 'working' (default): full CriticMarkup rendering with all markup visible
 *   - 'simple': full markup rendered, CSS hides deletions and metadata; change gutters visible
 *   - 'original': pre-change view — insertions stripped, deletions/subs resolved to old text
 *   - 'decided': post-change view — deletions stripped, insertions/subs resolved to new text
 *   - 'raw': full CriticMarkup rendered without author colors
 */
export function renderMarkdownToHtml(
    markdown: string,
    isDarkTheme = false,
    view: BuiltinView = 'working'
): string {
    const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

    const isSimple = view === 'simple';
    const isResolved = view === 'original' || view === 'decided';

    const config: PluginConfig = {
        enabled: true,
        showFootnotes: isSimple,  // Simple: keep ref badges (definitions hidden via CSS); others: sidebar handles it
        showComments: !isResolved,
        renderInCodeFences: true,
        metadataDetail: 'badge',
        authorColors: isResolved ? 'never' : 'auto',
        isDarkTheme,
    };

    md.use(markdownItKatex, { throwOnError: false });
    md.use(changedownPlugin, () => config);

    let src = markdown;

    // For original/final modes, pre-process to strip one side of changes
    if (isResolved) {
        const doc = parseForFormat(src);
        const changes = [...doc.getChanges()].sort((a, b) => b.range.start - a.range.start);

        for (const c of changes) {
            if (view === 'original') {
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
                // view === 'decided'
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
