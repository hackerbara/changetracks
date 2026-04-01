import { describe, it, expect, beforeAll } from 'vitest';
import { Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal markdown grammar stub — just enough for our injection grammar to
// attach to. Content gets the base scope; CriticMarkup patterns overlay via injection.
let registry: Registry;
let mdGrammar: IGrammar;

/**
 * Tokenize a line and merge adjacent tokens with identical scopes.
 * The real markdown grammar can split content into fine-grained tokens
 * (e.g., per-character), so merging gives us the logical token spans.
 */
function tokenizeLine(grammar: IGrammar, line: string) {
  const result = grammar.tokenizeLine(line, null);
  const raw = result.tokens.map(t => ({
    text: line.substring(t.startIndex, t.endIndex),
    scopes: t.scopes,
  }));
  // Merge adjacent tokens with identical scope arrays
  const merged: typeof raw = [];
  for (const tok of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.scopes.length === tok.scopes.length && prev.scopes.every((s, i) => s === tok.scopes[i])) {
      prev.text += tok.text;
    } else {
      merged.push({ ...tok });
    }
  }
  return merged;
}

/**
 * Find any token whose text contains the given substring and whose scopes
 * include the given scope. Works regardless of how the grammar splits content.
 */
function findTokenWithScope(tokens: { text: string; scopes: string[] }[], textMatch: string, scope: string) {
  return tokens.find(t => t.text.includes(textMatch) && t.scopes.includes(scope));
}

beforeAll(async () => {
  const wasmPath = resolve(__dirname, '../../../node_modules/vscode-oniguruma/release/onig.wasm');
  const wasmBin = readFileSync(wasmPath).buffer;
  await loadWASM(wasmBin);

  const grammarPath = resolve(__dirname, '../../core/syntaxes/changedown.tmLanguage.json');
  const grammarJson = readFileSync(grammarPath, 'utf8');

  // Use the real VS Code markdown grammar (canonical location in core/syntaxes)
  const mdGrammarPath = resolve(__dirname, '../../core/syntaxes/markdown.tmLanguage.json');
  const mdGrammarJson = readFileSync(mdGrammarPath, 'utf8');

  registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
      createOnigString: (s: string) => new OnigString(s),
    }),
    loadGrammar: async (scopeName: string) => {
      if (scopeName === 'text.changedown.criticmarkup') {
        return parseRawGrammar(grammarJson, 'changedown.tmLanguage.json');
      }
      if (scopeName === 'text.html.markdown') {
        return parseRawGrammar(mdGrammarJson, 'markdown.tmLanguage.json');
      }
      return null;
    },
    getInjections: (scopeName: string) => {
      if (scopeName === 'text.html.markdown') {
        return ['text.changedown.criticmarkup'];
      }
      return undefined;
    },
  });

  // Load through the real markdown grammar — injection applies automatically
  mdGrammar = (await registry.loadGrammar('text.html.markdown'))!;
});

describe('CriticMarkup TextMate grammar scopes', () => {
  it('tokenizes insertion delimiters and content', () => {
    const tokens = tokenizeLine(mdGrammar, 'Some {++added++} end');
    expect(findTokenWithScope(tokens, '{++', 'punctuation.definition.inserted.begin.critic')).toBeTruthy();
    expect(findTokenWithScope(tokens, 'added', 'markup.inserted.critic')).toBeTruthy();
    expect(findTokenWithScope(tokens, '++}', 'punctuation.definition.inserted.end.critic')).toBeTruthy();
  });

  it('tokenizes deletion delimiters and content', () => {
    const tokens = tokenizeLine(mdGrammar, 'Some {--removed--} end');
    expect(findTokenWithScope(tokens, '{--', 'punctuation.definition.deleted.begin.critic')).toBeTruthy();
    expect(findTokenWithScope(tokens, 'removed', 'markup.deleted.critic')).toBeTruthy();
    expect(findTokenWithScope(tokens, '--}', 'punctuation.definition.deleted.end.critic')).toBeTruthy();
  });

  it('tokenizes substitution with separator', () => {
    const tokens = tokenizeLine(mdGrammar, 'The {~~old~>new~~} word');
    expect(findTokenWithScope(tokens, '~>', 'punctuation.separator.changed.critic')).toBeTruthy();
  });

  it('tokenizes highlight', () => {
    const tokens = tokenizeLine(mdGrammar, 'See {==this==} here');
    expect(findTokenWithScope(tokens, 'this', 'markup.highlight.critic')).toBeTruthy();
  });

  it('tokenizes comment', () => {
    const tokens = tokenizeLine(mdGrammar, 'Text {>>note<<} end');
    expect(findTokenWithScope(tokens, 'note', 'comment.block.critic')).toBeTruthy();
  });

  it('tokenizes footnote reference', () => {
    const tokens = tokenizeLine(mdGrammar, 'Text [^cn-1] end');
    expect(findTokenWithScope(tokens, 'cn-1', 'entity.name.footnote.changedown')).toBeTruthy();
  });

  it('tokenizes grouped footnote ref like cn-2.3', () => {
    const tokens = tokenizeLine(mdGrammar, 'Text [^cn-2.3] end');
    expect(findTokenWithScope(tokens, 'cn-2.3', 'entity.name.footnote.changedown')).toBeTruthy();
  });
});
