import { EventEmitter, type Event, type Disposable, type FormatAdapter, type Format } from './types.js';
import { UriKeyedStore } from './uri-keyed-store.js';
import { isL3Format } from '../footnote-patterns.js';
import { normalizeUri } from './uri.js';
import type { L2Document, L3Document } from '../model/document.js';
import type { Footnote, EditOp, FootnoteLine } from '../model/footnote.js';
import {
  parseL2 as parseL2Standalone,
  parseL3 as parseL3Standalone,
  serializeL2 as serializeL2Standalone,
  serializeL3 as serializeL3Standalone,
} from '../operations/parse-document.js';

/** Matches top-level footnote IDs like `cn-1`, `cn-42`. Ignores dotted sub-IDs like `cn-1.2`. */
const CN_TOP_LEVEL_ID = /^cn-(\d+)$/;

/**
 * Context passed to level-1 structural promote/demote operations.
 *
 * `existingFootnotes` is used for snippet promotion: when promoting a fragment
 * to merge into an existing L3 document, pass the target's footnotes so the
 * promoted snippet receives non-colliding IDs starting from max(existing) + 1.
 *
 * `lineNumberOffset` shifts the edit-op line numbers by a fixed amount, so a
 * snippet promoted in isolation can have its anchors match the target document
 * after splicing.
 *
 * `uri` is used only for event firing (`onDidCompleteTransition`) so subscribers
 * know which document the transition is for. It does not affect the conversion.
 */
export interface PromoteContext {
  existingFootnotes?: readonly Footnote[];
  lineNumberOffset?: number;
  uri?: string;
}

export interface DemoteContext {
  existingFootnotes?: readonly Footnote[];
  uri?: string;
}

/**
 * FormatService — typed format conversion primitives.
 *
 * Three levels of abstraction:
 *
 *  Level 1 (structural): `promote(doc, context?)` / `demote(doc, context?)` —
 *    typed in, typed out. For consumers holding typed Documents; the cleanest
 *    primitive and the one snippet merging uses.
 *
 *  Level 2 (text convenience): `promoteText(text, context?)` / `demoteText` —
 *    pure parse→convert→serialize round-trip for consumers that want strings.
 *    Internally: `parseL2(text) → promote(doc, context) → serializeL3(doc)`.
 *
 *  Delegates: `parseL2` / `parseL3` / `serializeL2` / `serializeL3` are thin
 *    wrappers around the standalone functions from operations/parse-document.
 *    They exist on the class so consumers holding a FormatService instance can
 *    call them without a separate import. The standalone functions in
 *    operations/parse-document.ts are the real implementation.
 */
export class FormatService implements Disposable {
  private readonly preferences = new UriKeyedStore<{ format: Format }>();
  private readonly _onDidChangePreferredFormat = new EventEmitter<{ uri: string; format: Format }>();
  private readonly _onDidCompleteTransition = new EventEmitter<{ uri: string; from: Format; to: Format }>();

  readonly onDidChangePreferredFormat: Event<{ uri: string; format: Format }> = (listener) =>
    this._onDidChangePreferredFormat.event(listener);
  readonly onDidCompleteTransition: Event<{ uri: string; from: Format; to: Format }> = (listener) =>
    this._onDidCompleteTransition.event(listener);

  constructor(private readonly adapter: FormatAdapter) {}

  // ── Detection + preference ──────────────────────────────────────────

  getDetectedFormat(_uri: string, text: string): Format {
    return isL3Format(text) ? 'L3' : 'L2';
  }

  getPreferredFormat(uri: string): Format | undefined {
    return this.preferences.get(normalizeUri(uri))?.format;
  }

  setPreferredFormat(uri: string, format: Format): void {
    const normalized = normalizeUri(uri);
    this.preferences.set(normalized, { format });
    this._onDidChangePreferredFormat.fire({ uri: normalized, format });
  }

  // ── Level 1: structural primitives ─────────────────────────────────

  /**
   * Promote an L2Document to L3Document.
   *
   * Typed in, typed out. For snippet promotion, pass
   * `context.existingFootnotes` to ensure the promoted snippet receives IDs
   * that don't collide with the target document's footnotes.
   */
  async promote(doc: L2Document, context?: PromoteContext): Promise<L3Document> {
    let result = await this.adapter.promote(doc);

    if (context?.existingFootnotes && context.existingFootnotes.length > 0) {
      result = this.reassignNonCollidingIds(result, context.existingFootnotes);
    }
    if (context?.lineNumberOffset !== undefined && context.lineNumberOffset !== 0) {
      result = this.shiftEditOpLineNumbers(result, context.lineNumberOffset);
    }

    if (context?.uri) {
      this._onDidCompleteTransition.fire({ uri: normalizeUri(context.uri), from: 'L2', to: 'L3' });
    }
    return result;
  }

  /**
   * Demote an L3Document to L2Document.
   *
   * Typed in, typed out.
   */
  async demote(doc: L3Document, context?: DemoteContext): Promise<L2Document> {
    let result = await this.adapter.demote(doc);

    if (context?.existingFootnotes && context.existingFootnotes.length > 0) {
      result = this.reassignNonCollidingIdsL2(result, context.existingFootnotes);
    }

    if (context?.uri) {
      this._onDidCompleteTransition.fire({ uri: normalizeUri(context.uri), from: 'L3', to: 'L2' });
    }
    return result;
  }

  // ── Level 2: text convenience ──────────────────────────────────────

  /**
   * Promote raw L2 text to raw L3 text. Pure parse→convert→serialize.
   *
   * For consumers that don't want to hold typed Documents. Internally:
   * `parseL2(text) → promote(doc, context) → serializeL3(doc)`.
   */
  async promoteText(text: string, context?: PromoteContext): Promise<string> {
    const doc = parseL2Standalone(text);
    const result = await this.promote(doc, context);
    return serializeL3Standalone(result);
  }

  async demoteText(text: string, context?: DemoteContext): Promise<string> {
    const doc = parseL3Standalone(text);
    const result = await this.demote(doc, context);
    return serializeL2Standalone(result);
  }

  // ── Parse/serialize delegates ──────────────────────────────────────

  parseL2(text: string): L2Document {
    return parseL2Standalone(text);
  }

  parseL3(text: string): L3Document {
    return parseL3Standalone(text);
  }

  serializeL2(doc: L2Document): string {
    return serializeL2Standalone(doc);
  }

  serializeL3(doc: L3Document): string {
    return serializeL3Standalone(doc);
  }

  // ── Snippet ID/line-number post-processing ─────────────────────────

  /**
   * Reassign footnote IDs in a freshly-promoted L3Document to avoid colliding
   * with IDs in an existing document. IDs are assigned as max(existing) + 1,
   * max + 2, etc., preserving source order. Dotted sub-IDs (cn-N.M) are
   * preserved as-is — max calculation is over top-level integer IDs only.
   */
  private reassignNonCollidingIds(doc: L3Document, existing: readonly Footnote[]): L3Document {
    const maxExisting = this.maxTopLevelId(existing);
    if (doc.footnotes.length === 0) return doc;
    let nextId = maxExisting + 1;
    // Precondition: adapter-produced footnotes have no cross-footnote references
    // in `bodyLines` — only the footnote's own metadata and edit-op line. If that
    // invariant changes, we must rewrite bodyLine text here too.
    const remapped: Footnote[] = doc.footnotes.map(f => {
      if (!CN_TOP_LEVEL_ID.test(f.id)) return f;  // preserve dotted sub-IDs as-is
      const newId = `cn-${nextId++}`;
      return { ...f, id: newId };
    });
    return { ...doc, footnotes: remapped };
  }

  private reassignNonCollidingIdsL2(doc: L2Document, existing: readonly Footnote[]): L2Document {
    const maxExisting = this.maxTopLevelId(existing);
    if (doc.footnotes.length === 0) return doc;
    // L2 has inline refs in the body that reference footnote IDs. Rewriting
    // requires text substitution.
    let nextId = maxExisting + 1;
    let text = doc.text;
    const remapped: Footnote[] = doc.footnotes.map(f => {
      const oldId = f.id;
      if (!CN_TOP_LEVEL_ID.test(oldId)) return f;
      const newId = `cn-${nextId++}`;
      // Replace [^oldId] → [^newId] in body text.
      text = text.split(`[^${oldId}]`).join(`[^${newId}]`);
      return { ...f, id: newId };
    });
    return { ...doc, text, footnotes: remapped };
  }

  /**
   * Find the highest top-level footnote ID (cn-N where N is integer) in an
   * array of existing footnotes. Ignores dotted sub-IDs (cn-N.M) per the
   * spec: max calculation is over top-level parents only.
   */
  private maxTopLevelId(footnotes: readonly Footnote[]): number {
    let max = 0;
    for (const f of footnotes) {
      const m = f.id.match(CN_TOP_LEVEL_ID);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  }

  /**
   * Shift edit-op line numbers in an L3Document by a fixed offset. Used when a
   * snippet promoted in isolation will be spliced at a non-zero line position
   * in a parent document.
   */
  private shiftEditOpLineNumbers(doc: L3Document, offset: number): L3Document {
    const remapped: Footnote[] = doc.footnotes.map(f => {
      if (!f.editOp) return f;
      // Shift each edit-op bodyLine independently from its own lineNumber, so a
      // footnote with multiple edit-op bodyLines at different original line numbers
      // each gets the correct shifted value (not all stamped with the same value).
      const shiftedBodyLines: FootnoteLine[] = f.bodyLines.map(bl => {
        if (bl.kind !== 'edit-op') return bl;
        const blShiftedEditOp: EditOp = { ...bl.editOp, lineNumber: bl.editOp.lineNumber + offset };
        const newRaw = bl.raw.replace(
          /^(\s*)(\d+):/,
          (_match, indent) => `${indent}${blShiftedEditOp.lineNumber}:`
        );
        return { ...bl, editOp: blShiftedEditOp, raw: newRaw };
      });
      // Also shift the top-level editOp for consistency with the bodyLine shifts.
      const shiftedEditOp: EditOp = { ...f.editOp, lineNumber: f.editOp.lineNumber + offset };
      return { ...f, editOp: shiftedEditOp, bodyLines: shiftedBodyLines };
    });
    return { ...doc, footnotes: remapped };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  remove(uri: string): void {
    this.preferences.delete(normalizeUri(uri));
  }

  dispose(): void {
    this.preferences.clear();
    this._onDidChangePreferredFormat.dispose();
    this._onDidCompleteTransition.dispose();
  }
}
