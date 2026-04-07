import { describe, it, expect, beforeAll } from 'vitest';
import MarkdownIt from 'markdown-it';
import { headingIdPlugin, createPreviewRenderer, parseHeadings } from '@changedown/preview';
import { initHashline } from '@changedown/core';
import { VIEW_PRESETS } from '@changedown/core/host';

// computeCurrentView (used by createPreviewRenderer in 'settled' mode) requires
// xxhash-wasm to be initialized before any test in this file runs.
beforeAll(async () => {
  await initHashline();
});

function makeInstance(): MarkdownIt {
  const md = new MarkdownIt();
  md.use(headingIdPlugin);
  return md;
}

describe('headingIdPlugin — slug generation', () => {
  it('basic slug: spaces become hyphens, lowercase', () => {
    const md = makeInstance();
    const html = md.render('## Hello World');
    expect(html).toContain('id="hello-world"');
  });

  it('special characters: apostrophes and punctuation stripped', () => {
    const md = makeInstance();
    const html = md.render("## What's New?");
    expect(html).toContain('id="whats-new"');
  });

  it('inline code: code content is included in the slug', () => {
    const md = makeInstance();
    const html = md.render('## The `render` Method');
    expect(html).toContain('id="the-render-method"');
  });

  it('links: link text included, URL stripped', () => {
    const md = makeInstance();
    const html = md.render('## See [docs](url)');
    expect(html).toContain('id="see-docs"');
  });

  it('duplicates: first occurrence has plain slug, second gets -1 suffix', () => {
    const md = makeInstance();
    const html = md.render('## Example\n\n## Example');
    expect(html).toContain('id="example"');
    expect(html).toContain('id="example-1"');
  });

  it('unicode: non-ASCII letters are preserved', () => {
    const md = makeInstance();
    // Ü is U+00DC; after toLowerCase() becomes ü (U+00FC)
    const html = md.render('## \u00dcber Design');
    expect(html).toContain('id="\u00fcber-design"');
  });

  it('empty after stripping: heading with only punctuation gets no id', () => {
    const md = makeInstance();
    const html = md.render('## ***');
    expect(html).not.toContain('id=');
  });

  it('multiple heading levels: each gets the correct slug', () => {
    const md = makeInstance();
    const html = md.render('# H1\n\n## H2\n\n### H3');
    expect(html).toContain('id="h1"');
    expect(html).toContain('id="h2"');
    expect(html).toContain('id="h3"');
  });

  it('CriticMarkup in heading: insertion markup stripped from slug', () => {
    const renderer = createPreviewRenderer();
    const { html } = renderer.render('## Updated {++title++}', VIEW_PRESETS.review);
    // The changedown plugin rewrites {++title++} to HTML spans before heading-id
    // processes it, so the slug should strip the HTML and produce 'updated-title'
    expect(html).toContain('id="updated-title"');
    renderer.dispose();
  });
});

describe('headingIdPlugin — integration: all view modes', () => {
  it('review mode: heading gets id attribute', () => {
    const renderer = createPreviewRenderer();
    const { html } = renderer.render('## Design', VIEW_PRESETS.review);
    expect(html).toContain('id="design"');
    renderer.dispose();
  });

  it('settled mode: heading gets id attribute (plain MarkdownIt path)', () => {
    const renderer = createPreviewRenderer();
    const { html } = renderer.render('## Design', VIEW_PRESETS.final);
    expect(html).toContain('id="design"');
    renderer.dispose();
  });

  it('raw mode: heading gets id attribute (plain MarkdownIt path)', () => {
    const renderer = createPreviewRenderer();
    const { html } = renderer.render('## Design', VIEW_PRESETS.raw);
    expect(html).toContain('id="design"');
    renderer.dispose();
  });
});

describe('headingIdPlugin — heading link wrapping', () => {
  it('wraps heading content in anchor tag with fragment href', () => {
    const md = makeInstance();
    const html = md.render('## Design');
    expect(html).toContain('<a href="#design" style="color: inherit; text-decoration: none" class="heading-anchor">');
    expect(html).toContain('</a></h2>');
  });

  it('uses custom linkHref from env', () => {
    const md = makeInstance();
    const html = md.render('## Design', { linkHref: (slug: string) => `/page/${slug}#${slug}` });
    expect(html).toContain('href="/page/design#design"');
  });

  it('default linkHref produces fragment-only href', () => {
    const md = makeInstance();
    const html = md.render('## Test');
    expect(html).toContain('href="#test"');
  });

  it('no anchor tag when heading has no id (empty after stripping)', () => {
    const md = makeInstance();
    const html = md.render('## ***');
    expect(html).not.toContain('heading-anchor');
  });
});

describe('parseHeadings', () => {
  it('extracts h1 and h2 headings with slugs', () => {
    const result = parseHeadings('# Title\n\nIntro paragraph.\n\n## Section\n\nSection text.');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ slug: 'title', text: 'Title', description: 'Intro paragraph.' });
    expect(result[1]).toEqual({ slug: 'section', text: 'Section', description: 'Section text.' });
  });

  it('skips h3 and deeper headings', () => {
    const result = parseHeadings('## Top\n\nText.\n\n### Sub\n\nMore text.');
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('top');
  });

  it('slugs match runtime heading IDs exactly', () => {
    const input = '## See [docs](url)\n\nParagraph.\n\n## What\'s New?\n\nAnother paragraph.';
    const parsed = parseHeadings(input);

    const md = makeInstance();
    const html = md.render(input);

    for (const heading of parsed) {
      expect(html).toContain(`id="${heading.slug}"`);
    }
  });

  it('applies stripMarkup to description text', () => {
    const strip = (t: string) => t.replace(/\{\+\+([^+]*)\+\+\}/g, '$1');
    const result = parseHeadings('## Heading\n\nSome {++added++} text.', strip);
    expect(result[0].description).toBe('Some added text.');
  });

  it('truncates long descriptions to 550 chars', () => {
    const long = 'A'.repeat(600);
    const result = parseHeadings(`## Heading\n\n${long}`);
    expect(result[0].description.length).toBe(550);
    expect(result[0].description).toMatch(/\.\.\.$/);
  });
});
