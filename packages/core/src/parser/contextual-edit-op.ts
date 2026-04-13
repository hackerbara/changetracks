/**
 * Contextual edit-op parser — extracted from footnote-native-parser.ts to
 * break the circular import between footnote-block-parser.ts and
 * footnote-native-parser.ts.
 *
 * Both modules import parseContextualEditOp; it now lives here so neither
 * needs to depend on the other for this function.
 */

// CriticMarkup opener → closer mapping
const CM_OPENERS: Record<string, string> = {
  '{++': '++}',
  '{--': '--}',
  '{~~': '~~}',
  '{==': '==}',
  '{>>': '<<}',  // optional closer for comments
};

/**
 * Detect and extract contextual edit-op format.
 *
 * Contextual format: `Protocol {++o++}verview` — surrounding text provides
 * the body-match anchor. This differs from the old "self-anchoring" format
 * where the op string starts directly with a CriticMarkup delimiter.
 *
 * Returns null if the opString is NOT contextual (i.e. starts directly with
 * a CriticMarkup opener with no non-whitespace prefix text).
 *
 * Returns `{ contextBefore, opString, contextAfter }` where `opString` is the
 * extracted CriticMarkup portion (suitable for passing to `parseOp`).
 */
export function parseContextualEditOp(
  opString: string,
): { contextBefore: string; opString: string; contextAfter: string } | null {
  // Find the first CriticMarkup opener in the string
  let opStart = -1;
  let opener = '';
  for (const o of Object.keys(CM_OPENERS)) {
    const idx = opString.indexOf(o);
    if (idx !== -1 && (opStart === -1 || idx < opStart)) {
      opStart = idx;
      opener = o;
    }
  }

  if (opStart === -1) return null; // No CriticMarkup op found at all

  const contextBefore = opString.slice(0, opStart);

  // Find the matching closer
  const expectedCloser = CM_OPENERS[opener];
  let opEnd = -1;

  if (opener === '{~~') {
    // Substitution: use the *last* ~~} so newText may contain a ~~} substring
    // before the true closer (indexOf would truncate early).
    const searchFrom = opStart + opener.length;
    const closerIdx = opString.lastIndexOf('~~}');
    opEnd = closerIdx >= searchFrom ? closerIdx + 3 : -1;
  } else if (opener === '{>>') {
    // Comment: closer is optional
    const searchFrom = opStart + opener.length;
    const closerIdx = opString.indexOf('<<}', searchFrom);
    if (closerIdx !== -1) {
      opEnd = closerIdx + 3;
    } else {
      // No closer — op extends to end of string
      opEnd = opString.length;
    }
  } else {
    const searchFrom = opStart + opener.length;
    const closerIdx = opString.indexOf(expectedCloser, searchFrom);
    opEnd = closerIdx !== -1 ? closerIdx + expectedCloser.length : -1;
  }

  if (opEnd === -1) return null; // Closer not found — malformed op, don't parse contextually

  const extractedOp = opString.slice(opStart, opEnd);
  const contextAfter = opString.slice(opEnd);

  // Contextual if EITHER contextBefore OR contextAfter has non-whitespace text.
  // A change at column 0 produces "{++c++}onversational" (empty before, trailing after).
  // A change at end of line produces "context{++c++}" (leading before, empty after).
  // No non-whitespace context on either side — not a contextual op.
  if (contextBefore.trim() === '' && contextAfter.trim() === '') return null;
  // Guard: old @ctx: format "{--text--} @ctx:..." is NOT contextual — it's legacy metadata.
  if (contextBefore.trim() === '' && contextAfter.trimStart().startsWith('@ctx:')) return null;
  // Guard: reasoning suffix "{==text==}{>>comment" is NOT contextual — {>> is reasoning.
  if (contextBefore.trim() === '' && contextAfter.trimStart().startsWith('{>>')) return null;

  return { contextBefore, opString: extractedOp, contextAfter };
}
