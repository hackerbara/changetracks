import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  initHashline,
  CriticMarkupParser,
  buildViewDocument,
  formatPlainText,
  parseForFormat,
  type ThreeZoneDocument,
  type ThreeZoneLine,
} from '@changedown/core';
import type { BuiltinView } from '@changedown/core/host';
import { resolveView, CANONICAL_VIEWS } from '../../view-alias.js';
import { errorResult } from '../shared/error-result.js';
import { optionalStrArg } from '../args.js';
import { ConfigResolver } from '../config-resolver.js';
import { resolveProtocolMode } from '../config.js';
import type { ChangeDownConfig } from '../../config/index.js';
import { resolveTrackingStatus } from '../scope.js';
import { SessionState } from '../state.js';
import { composeGuide } from '../guide-composer.js';

/** Default number of lines returned when no limit is specified. */
const DEFAULT_LIMIT = 500;
/** Hard ceiling — even explicit requests are capped at this. */
const MAX_LIMIT = 2000;

const HASHLINE_DISABLED_TIP_DEFAULT =
  '## tip: Hashline addressing is disabled. Edits use text matching; re-read for current content if propose_change fails.';

const HASHLINE_DISABLED_TIP_COMPACT =
  '## tip: Hashline addressing is disabled but compact mode requires it. Enable in .changedown/config.toml: [hashline] enabled = true';

/**
 * Tool definition for the read_tracked_file MCP tool.
 * Raw JSON Schema — used when registering the tool with the MCP server.
 */
export const readTrackedFileTool = {
  name: 'read_tracked_file',
  description:
    'Read a tracked document: file path, file:// URI, or word:// session from resources/list. Default working view shows inline metadata plus LINE:HASH coordinates usable by propose_change. Other views: simple, decided, raw. Response carries diagnostics[] for coordinate failures.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      file: {
        type: 'string',
        description: 'Path, file:// URI, or active Word session URI (word://sess-...). Use resources/list to discover Word sessions.',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-indexed, default: 1)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to return (default: 500, max: 2000). Use with offset for pagination.',
      },
      view: {
        type: 'string',
        enum: ['working', 'simple', 'decided', 'raw'],
        description:
          'working (default, agent-optimized with inline annotations), simple (current projection with P/A flags), ' +
          'decided (clean text with only decided changes applied), raw (literal file bytes).',
      },
      include_meta: {
        type: 'boolean',
        description: 'If true, include change levels line and full tip. Default: false (compact).',
      },
      include_guide: {
        type: 'boolean',
        description: 'If true, include the editing guide regardless of whether it was already shown this session. Use when spawning subagents that need protocol context.',
      },
    },
    required: ['file'],
  },
};

import type { Diagnostic } from '@changedown/core';

export interface ReadTrackedFileResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** Diagnostics emitted during parsing (e.g., coordinate_failed for zombie changes).
   *  Present on success responses only; absent (undefined) on error returns.
   *  Agents can use this to detect unresolvable changes before attempting mutations. */
  diagnostics?: readonly Diagnostic[];
}

/**
 * Build a "## change levels:" line from parsed changes (participation level 0, 1, or 2 per change).
 */
function formatChangeLevelsLine(content: string): string | null {
  const parser = new CriticMarkupParser();
  const doc = parser.parse(content);
  const changes = doc.getChanges();
  if (changes.length === 0) return null;
  const parts = changes.map((c) => `${c.id}=${c.level}`);
  return `## change levels: ${parts.join(', ')}`;
}

/**
 * Returns the first-contact guide text if this is the first read for the
 * current protocol mode, or empty string if the guide was already shown.
 */
function maybeComposeGuide(
  state: SessionState,
  config: ChangeDownConfig,
  explicit = false,
): string {
  if (!explicit && state.isGuideSuppressed()) return '';
  const mode = resolveProtocolMode(config.protocol.mode);
  if (!explicit && state.getGuideShownForMode() === mode) return '';
  state.setGuideShown(mode);
  return '\n\n' + composeGuide(config);
}

/**
 * Compute effective pagination range from offset/limit params.
 * Returns [effectiveStart, effectiveEnd] as 1-indexed inclusive range.
 */
function computeEffectiveRange(
  offset: number,
  requestedLimit: number | undefined,
  totalLines: number,
): { effectiveStart: number; effectiveEnd: number } {
  const effectiveStart = Math.max(1, offset);
  const limit = Math.min(requestedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const effectiveEnd = Math.min(effectiveStart + limit - 1, totalLines);
  return { effectiveStart, effectiveEnd };
}

/**
 * Build an actionable truncation message when output is truncated.
 */
function buildTruncationMessage(
  effectiveStart: number,
  effectiveEnd: number,
  totalLines: number,
): string | null {
  if (effectiveEnd >= totalLines) return null;
  return `\n\n--- showing lines ${effectiveStart}-${effectiveEnd} of ${totalLines} | use offset/limit to paginate ---`;
}

/**
 * Find a safe pagination end that doesn't truncate mid-CriticMarkup block.
 * Uses the `continuesChange` flag set by view builders, which is derived from
 * the parser (handles code blocks, ignores false-positive delimiters in strings).
 */
function findSafePaginationEnd(lines: ThreeZoneLine[], effectiveEnd: number): number {
  let end = effectiveEnd;
  // lines[end] (0-indexed) is the first line AFTER our slice.
  // If it continues a multi-line change, include it.
  while (end < lines.length && lines[end]?.continuesChange) {
    end++;
  }
  return end;
}

interface PipelineResult {
  output: string;
  paginatedDoc: ThreeZoneDocument;
  effectiveStart: number;
  adjustedEnd: number;
  totalLines: number;
}

/**
 * Shared pipeline: build view document, record session hashes, apply pagination,
 * and format plain text. Both hashline-enabled and hashline-disabled branches use this.
 */
function buildAndFormatPaginatedDoc(
  fileContent: string,
  canonicalView: BuiltinView,
  opts: { filePath: string; trackingStatus: 'tracked' | 'untracked'; protocolMode: string; defaultView: BuiltinView; viewPolicy: string },
  pagination: { offset: number; requestedLimit: number | undefined },
  state: SessionState,
  absolutePath: string,
): PipelineResult {
  const doc = buildViewDocument(fileContent, canonicalView, opts);

  const sessionHashes = doc.lines.map(l => ({
    line: l.margin.lineNumber,
    raw: l.sessionHashes.raw,
    committed: l.sessionHashes.committed,
    currentView: l.sessionHashes.currentView,
    rawLineNum: l.rawLineNumber,
  }));
  state.recordAfterRead(absolutePath, canonicalView, sessionHashes, fileContent);

  const totalLines = doc.lines.length;
  const { effectiveStart, effectiveEnd } = computeEffectiveRange(pagination.offset, pagination.requestedLimit, totalLines);
  const adjustedEnd = findSafePaginationEnd(doc.lines, effectiveEnd);

  const paginatedDoc: ThreeZoneDocument = {
    ...doc,
    lines: doc.lines.slice(effectiveStart - 1, adjustedEnd),
    header: {
      ...doc.header,
      lineRange: { start: effectiveStart, end: adjustedEnd, total: totalLines },
    },
  };

  return {
    output: formatPlainText(paginatedDoc),
    paginatedDoc,
    effectiveStart,
    adjustedEnd,
    totalLines,
  };
}

export async function handleReadTrackedFile(
  args: Record<string, unknown>,
  resolver: ConfigResolver,
  state: SessionState,
): Promise<ReadTrackedFileResult> {
  try {
    // Defensive: ensure hashline WASM is initialized (idempotent). Handles edge cases where
    // the tool is invoked before server startup has finished or from a context that skipped init.
    await initHashline();

    // 1. Extract and validate args (accept snake_case and camelCase)
    const file = optionalStrArg(args, 'file', 'file');
    if (!file) {
      return errorResult('Missing required argument: "file"');
    }

    const offset = (args.offset as number | undefined) ?? 1;
    const requestedLimit = args.limit as number | undefined;
    const requestedView = optionalStrArg(args, 'view', 'view');

    // Resolve view to canonical name (or null for unknown)
    const resolved = requestedView !== undefined ? resolveView(requestedView) : null;
    if (requestedView !== undefined && resolved === null) {
      return errorResult(
        `Unknown view '${requestedView}'. Valid views: ${CANONICAL_VIEWS.join(', ')}`,
      );
    }

    const includeMeta = args.include_meta === true;
    const includeGuide = args.include_guide === true;

    // 2. Resolve file path
    const filePath = resolver.resolveFilePath(file);
    const { config, projectDir } = await resolver.forFile(filePath);

    // 2b. Apply view policy: determine effective view from config defaults + agent request
    const defaultView = resolveView(config.policy.default_view ?? 'working') ?? 'working';
    const viewPolicy = config.policy.view_policy ?? 'suggest';
    let canonicalView: BuiltinView;

    if (requestedView === undefined) {
      // No view specified by agent → use project default
      canonicalView = defaultView;
    } else {
      // resolved is non-null here — the early return above guarantees it
      canonicalView = resolved!;
      if (viewPolicy === 'require' && canonicalView !== defaultView) {
        return errorResult(
          `This project requires view "${config.policy.default_view}" (view_policy = "require"). ` +
          `Requested view "${requestedView}" is not allowed. ` +
          `Change view_policy to "suggest" in .changedown/config.toml to allow view selection.`,
        );
      }
    }

    // 3. Read file from disk
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`File not found or unreadable: ${msg}`);
    }

    // 5. Resolve tracking status for the header
    const trackingStatus = await resolveTrackingStatus(filePath, config, projectDir);

    // 5a. Parse for diagnostics (zombie detection). Independent of view pipeline.
    const parsedDoc = parseForFormat(fileContent);
    const fileDiagnostics = parsedDoc.getDiagnostics();

    // 5b. When hashline is disabled, return full-file content with line numbers only (no hashes).
    const displayPath = path.relative(projectDir, filePath);
    if (!config.hashline.enabled) {
      // Simple view requires hashline for coordinate-based addressing
      if (canonicalView === 'simple') {
        return errorResult(
          'Simple view requires hashline mode. Enable hashline in .changedown/config.toml: [hashline] enabled = true'
        );
      }

      const protocolMode = resolveProtocolMode(config.protocol.mode);
      const { output: rawOutput, effectiveStart, adjustedEnd, totalLines } = buildAndFormatPaginatedDoc(
        fileContent, canonicalView,
        { filePath: displayPath, trackingStatus: trackingStatus.status, protocolMode, defaultView: 'working', viewPolicy: config.policy.view_policy ?? 'suggest' },
        { offset, requestedLimit },
        state, filePath,
      );

      let output = rawOutput;
      const truncation = buildTruncationMessage(effectiveStart, adjustedEnd, totalLines);
      if (truncation) output += truncation;

      const hashlineTip = protocolMode === 'compact' ? HASHLINE_DISABLED_TIP_COMPACT : HASHLINE_DISABLED_TIP_DEFAULT;
      output = output + '\n' + hashlineTip;

      const guide = maybeComposeGuide(state, config, includeGuide);
      const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: output }];
      if (guide) content.unshift({ type: 'text', text: guide });
      return { content, diagnostics: fileDiagnostics };
    }

    // 6. Build ThreeZoneDocument via the unified pipeline, apply pagination and format
    const protocolMode = resolveProtocolMode(config.protocol.mode);
    const { output: rawOutput, effectiveStart, adjustedEnd, totalLines } = buildAndFormatPaginatedDoc(
      fileContent, canonicalView,
      { filePath: displayPath, trackingStatus: trackingStatus.status, protocolMode, defaultView: 'working', viewPolicy: config.policy.view_policy ?? 'suggest' },
      { offset, requestedLimit },
      state, filePath,
    );

    // 7. Inject change levels line when include_meta is requested (before truncation message)
    let output = rawOutput;
    if (includeMeta) {
      const levelsLine = formatChangeLevelsLine(fileContent);
      if (levelsLine) {
        output = output.replace(/^---$/m, `${levelsLine}\n---`);
      }
    }

    const guide = maybeComposeGuide(state, config, includeGuide);
    const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: output }];
    const truncation = buildTruncationMessage(effectiveStart, adjustedEnd, totalLines);
    if (truncation) {
      content[content.length - 1].text += truncation;
    }
    if (guide) content.unshift({ type: 'text', text: guide });
    return { content, diagnostics: fileDiagnostics };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(msg);
  }
}
