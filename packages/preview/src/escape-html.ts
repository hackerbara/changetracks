/**
 * Shared HTML escaping utility for preview rendering.
 *
 * Used by both plugin.ts (code fence preview) and replacements.ts (inline preview).
 */

/** Escape HTML special characters for safe insertion into HTML content. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Pre-compiled regexes for whitelisted inline tag restoration. */
const SAFE_TAG_REGEXES: Array<{ open: RegExp; close: RegExp; tag: string }> =
    ['u', 'b', 'i', 'em', 'strong', 's', 'sub', 'sup'].map(tag => ({
        open: new RegExp(`&lt;${tag}&gt;`, 'g'),
        close: new RegExp(`&lt;/${tag}&gt;`, 'g'),
        tag,
    }));
const SMALLCAPS_OPEN_RE = /&lt;span style=&quot;font-variant:small-caps&quot;&gt;/g;
const SPAN_CLOSE_RE = /&lt;\/span&gt;/g;

/**
 * Restore whitelisted inline formatting tags after HTML escaping.
 * Shared by sanitizeContentHtml (fence rendering) and prepareChangeContent
 * (change content rendering with pre-rendered KaTeX).
 */
export function restoreWhitelistedTags(escaped: string): string {
    let s = escaped;
    for (const { open, close, tag } of SAFE_TAG_REGEXES) {
        s = s.replace(open, `<${tag}>`);
        s = s.replace(close, `</${tag}>`);
    }
    s = s.replace(SMALLCAPS_OPEN_RE, '<span style="font-variant:small-caps">');
    s = s.replace(SPAN_CLOSE_RE, '</span>');
    return s;
}

/**
 * Escape HTML then restore whitelisted inline formatting tags.
 *
 * Used for CriticMarkup change content in code fences (plugin.ts).
 * LaTeX math regions ($...$ and $$...$$) are preserved unescaped because
 * markdown-it-katex processes them after the HTML wrapper tags are emitted.
 */
export function sanitizeContentHtml(text: string): string {
    const mathRegions: string[] = [];
    const placeholder = '\x00MATH';
    let withPlaceholders = text.replace(/\$\$[\s\S]*?\$\$/g, (m) => {
        mathRegions.push(m);
        return placeholder + (mathRegions.length - 1) + '\x00';
    });
    withPlaceholders = withPlaceholders.replace(/\$[^\n$]+?\$/g, (m) => {
        mathRegions.push(m);
        return placeholder + (mathRegions.length - 1) + '\x00';
    });

    let s = restoreWhitelistedTags(escapeHtml(withPlaceholders));
    s = s.replace(/\x00MATH(\d+)\x00/g, (_m, idx) => mathRegions[Number(idx)]);
    return s;
}
