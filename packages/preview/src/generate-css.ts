import { DECORATION_STYLES, VIEW_PRESETS } from '@changedown/core/host';
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
  moveLabel: 'cn-move-label',
  anchorMeta: 'cn-anchor-meta',
  decidedRef: 'cn-decided-ref',
  decidedDim: 'cn-decided-dim',
  footnoteBlock: 'cn-footnotes',
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

  // Override browser default <mark> styling: UA stylesheets set color to black,
  // which makes highlighted text invisible on dark backgrounds.
  rules.push('.cn-hl { color: inherit }');

  // KaTeX equations inherit color from their wrapper — ensure they use the
  // page's text color, not the browser's <mark> default.
  rules.push('.katex { color: inherit }');

  return rules.join('\n');
}

/** Gutter indicator rules — layout-dependent, not derivable from visibility data. */
const GUTTER_RULES = `
/* Change gutter: insertion (green) */
[data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(ins.cn-ins) {
  border-left: 3px solid #66BB6A; padding-left: 8px; margin-left: -12px;
}
.vscode-light [data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(ins.cn-ins),
.cn-light [data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(ins.cn-ins) {
  border-left-color: #1E824C;
}

/* Change gutter: deletion only (red) */
[data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(del.cn-del):not(:has(ins.cn-ins)) {
  border-left: 3px solid #EF5350; padding-left: 8px; margin-left: -12px; min-height: 1.2em;
}
.vscode-light [data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(del.cn-del):not(:has(ins.cn-ins)),
.cn-light [data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(del.cn-del):not(:has(ins.cn-ins)) {
  border-left-color: #C0392B;
}

/* Change gutter: substitution (blue) */
[data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(.cn-sub-del) {
  border-left: 3px solid #64B5F6; padding-left: 8px; margin-left: -12px;
}
.vscode-light [data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(.cn-sub-del),
.cn-light [data-view-name="simple"] :is(p,li,h1,h2,h3,h4,h5,h6,blockquote,pre):has(.cn-sub-del) {
  border-left-color: #2980B9;
}`;

let cachedViewModeCSS: string | undefined;

/**
 * Returns CSS rules for view differentiation.
 * Derives visibility rules from VIEW_PRESETS (core) and maps
 * them to CSS via data-view-name scoping. Gutter indicators are
 * hand-authored (layout rules using :has() selectors, not derivable from data).
 * Result is cached after the first call since VIEW_PRESETS is static.
 */
export function generateViewModeCSS(): string {
  if (cachedViewModeCSS !== undefined) return cachedViewModeCSS;
  const rules: string[] = [];

  for (const [name, view] of Object.entries(VIEW_PRESETS)) {
    const d = view.display;
    const scope = `[data-view-name="${name}"]`;
    const hidden: string[] = [];
    const plain: string[] = [];

    if ((d.deletions ?? 'inline') === 'hide') {
      hidden.push(`${scope} .cn-del`, `${scope} .cn-sub-del`, `${scope} .cn-move-from`, `${scope} .cn-move-label`);
    }
    if ((d.comments ?? 'inline-marker') === 'hide') hidden.push(`${scope} .cn-comment`);
    if ((d.highlights ?? 'inline') === 'hide') hidden.push(`${scope} .cn-hl`);
    else if ((d.highlights ?? 'inline') !== 'inline') plain.push(`${scope} .cn-hl`);
    if ((d.footnoteRefs ?? 'show') === 'hide') hidden.push(`${scope} .cn-ref`);
    if ((d.footnotes ?? 'show') === 'hide') hidden.push(`${scope} .cn-footnotes`);

    if (hidden.length > 0) rules.push(hidden.join(',\n') + ' { display: none; }');
    if (plain.length > 0) rules.push(plain.join(',\n') + ' { background: none; padding: 0; }');
  }

  // Additional non-visibility overrides for simple mode
  rules.push(`
/* Insertions as plain text (keep color, remove underline) */
[data-view-name="simple"] .cn-ins,
[data-view-name="simple"] .cn-sub-ins,
[data-view-name="simple"] ins.cn-move-to { text-decoration: none; }

/* Reset status dimming */
[data-view-name="simple"] .cn-accepted { opacity: 1; }
[data-view-name="simple"] .cn-rejected { opacity: 1; font-style: normal; }`);

  rules.push(GUTTER_RULES);
  cachedViewModeCSS = rules.join('\n\n');
  return cachedViewModeCSS;
}

