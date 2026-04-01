import { DECORATION_STYLES } from '@changedown/core/host';
import type { DecorationStyleDef } from '@changedown/core/host';

/**
 * Maps from DecorationTypeId → changedownPlugin CSS class name.
 * The plugin emits cn-ins, cn-del, etc.; DECORATION_STYLES uses
 * insertion, deletion, etc. This map bridges the two naming schemes.
 */
const TYPE_TO_CLASS: Record<string, string> = {
  insertion: 'cn-ins',
  deletion: 'cn-del',
  substitutionOriginal: 'cn-sub-del',
  substitutionModified: 'cn-sub-ins',
  highlight: 'cn-hl',
  comment: 'cn-comment',
  moveFrom: 'cn-move-from',
  moveTo: 'cn-move-to',
  settledRef: 'cn-settled-ref',
  settledDim: 'cn-settled-dim',
  ghostDeletion: 'cn-ghost-text',
  consumed: 'cn-consumed',
  consumingAnnotation: 'cn-consumed-label',
};

export function generatePreviewCSS(theme: 'dark' | 'light' = 'dark'): string {
  const rules: string[] = [];

  for (const [typeId, className] of Object.entries(TYPE_TO_CLASS)) {
    const style = DECORATION_STYLES[typeId as keyof typeof DECORATION_STYLES] as DecorationStyleDef | undefined;
    if (!style) continue;

    const s = theme === 'dark' ? style.dark : style.light;
    const parts: string[] = [];

    if (s.color) parts.push(`color: ${s.color}`);
    if (s.backgroundColor) parts.push(`background-color: ${s.backgroundColor}`);
    if (s.textDecoration && s.textDecoration !== 'none') parts.push(`text-decoration: ${s.textDecoration}`);
    if (s.border) parts.push(`border-bottom: ${s.border}`);
    if (s.fontStyle) parts.push(`font-style: ${s.fontStyle}`);
    if (s.opacity) parts.push(`opacity: ${s.opacity}`);

    if (parts.length > 0) {
      rules.push(`.${className} { ${parts.join('; ')} }`);
    }
  }

  return rules.join('\n');
}

/**
 * Returns CSS rules for view-mode differentiation as a string.
 * These rules are the same as in preview.css — this function exists
 * so webview consumers (docx preview) can embed them inline.
 *
 * When updating these rules, also update packages/preview/media/preview.css
 * (search for "Changes view mode" section).
 */
export function generateViewModeCSS(): string {
  return `/* === Changes view mode: simplified preview === */
/* Hide deletions, move sources, move labels */
[data-view-mode="changes"] .cn-del,
[data-view-mode="changes"] .cn-sub-del,
[data-view-mode="changes"] del.cn-move-from,
[data-view-mode="changes"] .cn-move-label { display: none; }

/* Insertions as plain text (keep green color, remove underline) */
[data-view-mode="changes"] .cn-ins,
[data-view-mode="changes"] .cn-sub-ins,
[data-view-mode="changes"] ins.cn-move-to { text-decoration: none; }

/* Hide comments, highlights, metadata, footnotes, ref badges */
[data-view-mode="changes"] .cn-comment { display: none; }
[data-view-mode="changes"] .cn-hl { background: none; padding: 0; }
[data-view-mode="changes"] .cn-anchor-meta { display: none; }
[data-view-mode="changes"] .cn-footnotes { display: none; }
[data-view-mode="changes"] .cn-ref { display: none; }

/* Reset status dimming */
[data-view-mode="changes"] .cn-accepted { opacity: 1; }
[data-view-mode="changes"] .cn-rejected { opacity: 1; font-style: normal; }

/* Change gutter: insertion (green) */
[data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(ins.cn-ins) {
  border-left: 3px solid #66BB6A; padding-left: 8px; margin-left: -12px;
}
.vscode-light [data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(ins.cn-ins),
.cn-light [data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(ins.cn-ins) {
  border-left-color: #1E824C;
}

/* Change gutter: deletion only (red) */
[data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(del.cn-del):not(:has(ins.cn-ins)) {
  border-left: 3px solid #EF5350; padding-left: 8px; margin-left: -12px; min-height: 1.2em;
}
.vscode-light [data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(del.cn-del):not(:has(ins.cn-ins)),
.cn-light [data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(del.cn-del):not(:has(ins.cn-ins)) {
  border-left-color: #C0392B;
}

/* Change gutter: substitution (blue) */
[data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(.cn-sub-del) {
  border-left: 3px solid #64B5F6; padding-left: 8px; margin-left: -12px;
}
.vscode-light [data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(.cn-sub-del),
.cn-light [data-view-mode="changes"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(.cn-sub-del) {
  border-left-color: #2980B9;
}`;
}
