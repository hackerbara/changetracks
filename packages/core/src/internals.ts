/**
 * Internal exports for test consumption.
 *
 * This barrel re-exports symbols that tests need but that aren't
 * necessarily part of the stable public API (index.ts).  Today
 * everything happens to also appear in index.ts — but as the
 * public API gets trimmed, test-only symbols will migrate here.
 *
 * Import with:  import { ... } from '@changedown/core/internals';
 */

// Re-export everything from the public surface so test files
// can use a single import specifier for both public and internal symbols.
export * from './index.js';

// Re-export deprecated functions for test consumption only.
// These are removed from the public API (index.ts) per ADR-C §2
// but tests still verify the deprecated function's behavior.
export { neutralizeEditOpLines, neutralizeEditOpLine } from './format-aware-parse.js';

// Re-export decoration helpers and types for test consumption.
// Tests for injectGhostDelimiters live in packages/tests/core/parser-bug-fixes.test.ts.
export { injectGhostDelimiters } from './host/decorations/helpers.js';
export type { OffsetDecoration } from './host/decorations/types.js';

// Re-export ParsedFootnote for test consumption.
// Allows parser-bug-fixes.test.ts to assert on unknownBodyLines directly via
// FootnoteNativeParser._testScanFootnotes().
export type { ParsedFootnote } from './parser/footnote-native-parser.js';
// Re-export FootnoteNativeParser for test consumption.
// Used by the contextual-deletion fixture test to assert on ChangeNode.deletionSeamOffset.
export { FootnoteNativeParser } from './parser/footnote-native-parser.js';

// Re-export parseFootnoteBlock for test consumption.
export { parseFootnoteBlock } from './parser/footnote-block-parser.js';
// Re-export typed Footnote types for test consumption.
export type { Footnote, FootnoteLine, FootnoteHeader, EditOp, DiscussionReply, ReviewAction } from './model/footnote.js';

// Re-export typed document union for test consumption.
export type { Document, L2Document, L3Document } from './model/document.js';

// Re-export parse/serialize primitives for test consumption.
export { parseL2, parseL3, serializeL2, serializeL3 } from './operations/parse-document.js';

export { buildSessionHashes } from './renderers/view-builders/session-hashes.js';
export type { SessionHashes, SessionHashesResult } from './renderers/view-builders/session-hashes.js';
export { buildLineMetadataFromFootnotes } from './renderers/view-builders/line-metadata.js';
export { buildSimpleDocument } from './renderers/view-builders/simple.js';
export type { SimpleBuildOptions } from './renderers/view-builders/simple.js';
export { buildDecidedDocument } from './renderers/view-builders/decided.js';
export type { DecidedBuildOptions } from './renderers/view-builders/decided.js';

export { formatMetadata } from './renderers/formatters/plain-text.js';

export { verifyAcceptedHistoryCoherence } from './operations/change-record-coherence.js';
export type {
  AcceptedHistoryCoherenceInput,
  AcceptedHistoryCoherenceRecord,
  AcceptedHistoryCoherenceResult,
} from './operations/change-record-coherence.js';
