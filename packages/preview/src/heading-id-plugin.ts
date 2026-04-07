import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/**
 * Convert heading text to a GitHub-compatible slug.
 * Strips HTML tags, removes non-word characters (unicode-aware),
 * lowercases, trims, and replaces whitespace with hyphens.
 */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/**
 * Deduplicate a slug against a seen-map.
 * First occurrence returns the slug as-is; subsequent occurrences get a -N suffix.
 */
function deduplicate(slug: string, seen: Map<string, number>): string {
  const count = seen.get(slug) ?? 0;
  seen.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count}`;
}

/**
 * Extract plain text from an inline token's children.
 * Only `text` and `code_inline` child tokens contribute content.
 */
function extractText(token: Token): string {
  if (!token.children) return '';
  return token.children
    .filter(t => t.type === 'text' || t.type === 'code_inline')
    .map(t => t.content)
    .join('');
}

/**
 * markdown-it plugin that adds GitHub-compatible `id` attributes to heading tokens.
 * The `seen` map is created fresh per render call (inside the rule callback)
 * so that a cached MarkdownIt instance does not accumulate state across renders.
 */
export function headingIdPlugin(md: MarkdownIt): void {
  md.core.ruler.push('heading_id', (state) => {
    const seen = new Map<string, number>();
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'heading_open') continue;

      const inlineToken = tokens[i + 1];
      if (!inlineToken || inlineToken.type !== 'inline') continue;

      const text = extractText(inlineToken);
      const slug = githubSlug(text);
      if (!slug) continue;

      const deduped = deduplicate(slug, seen);
      token.attrSet('id', deduped);
    }
  });

  // Renderer rules: wrap heading content in anchor links
  const defaultLinkHref = (slug: string) => `#${slug}`;

  const originalOpen = md.renderer.rules['heading_open'];
  md.renderer.rules['heading_open'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const id = token.attrGet('id');
    const linkHref = (env as { linkHref?: (slug: string) => string })?.linkHref ?? defaultLinkHref;
    const base = originalOpen
      ? originalOpen(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    if (id) {
      return base + `<a href="${linkHref(id)}" style="color: inherit; text-decoration: none" class="heading-anchor">`;
    }
    return base;
  };

  const originalClose = md.renderer.rules['heading_close'];
  md.renderer.rules['heading_close'] = (tokens, idx, options, env, self) => {
    // Check if the corresponding heading_open had an id
    let hasId = false;
    for (let j = idx - 1; j >= 0; j--) {
      if (tokens[j].type === 'heading_open') {
        hasId = !!tokens[j].attrGet('id');
        break;
      }
    }
    const base = originalClose
      ? originalClose(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    return hasId ? '</a>' + base : base;
  };
}

// Cached MarkdownIt instance for parseHeadings — stateless across calls
// because the heading_id core rule creates a fresh `seen` map per parse.
let _headingMd: MarkdownIt | null = null;
function getHeadingMd(): MarkdownIt {
  if (!_headingMd) {
    _headingMd = new MarkdownIt({ html: true });
    headingIdPlugin(_headingMd);
  }
  return _headingMd;
}

/**
 * Parse h1 and h2 headings from raw markdown, returning slugs that exactly
 * match the runtime heading IDs produced by headingIdPlugin.
 * Also extracts the first paragraph after each heading as a description.
 */
export function parseHeadings(
  raw: string,
  stripMarkup?: (text: string) => string,
): Array<{ slug: string; text: string; description: string }> {
  const tokens = getHeadingMd().parse(raw, {});
  const results: Array<{ slug: string; text: string; description: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;

    if (token.tag !== 'h1' && token.tag !== 'h2') continue;

    const slug = token.attrGet('id');
    if (!slug) continue;

    const inlineToken = tokens[i + 1];
    const text = inlineToken ? extractText(inlineToken) : '';

    // Find first paragraph after this heading
    let description = '';
    for (let j = i + 3; j < tokens.length; j++) {
      if (tokens[j].type === 'heading_open') break; // next heading, stop
      if (tokens[j].type === 'inline' && tokens[j - 1]?.type === 'paragraph_open') {
        let content = tokens[j].content;
        if (stripMarkup) content = stripMarkup(content);
        content = content
          .replace(/\*\*/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .trim();
        if (content) {
          description = content.length > 550 ? content.slice(0, 547) + '...' : content;
          break;
        }
      }
    }

    results.push({ slug, text, description });
  }

  return results;
}
