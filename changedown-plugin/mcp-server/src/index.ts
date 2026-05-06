#!/usr/bin/env node

import type { Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  RootsListChangedNotificationSchema,
  McpError,
  ErrorCode,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import {
  initHashline,
  computeLineHash,
  buildViewDocument,
  formatPlainText,
  parseForFormat,
  findFootnoteBlock,
  parseFootnoteHeader,
  type ChangeNode,
  type VirtualDocument,
} from '@changedown/core';
import { resolveView } from '@changedown/core/host';
import {
  ConfigResolver,
  SessionState,
  handleProposeChange,
  handleBeginChangeGroup,
  handleEndChangeGroup,
  handleReviewChange,
  handleReviewChanges,
  handleRespondToThread,
  handleListOpenThreads,
  handleRawEdit,
  handleGetTrackingStatus,
  handleReadTrackedFile,
  handleGetChange,
  handleAmendChange,
  handleListChanges,
  handleSupersedeChange,
  handleProposeBatch,
  handleResolveThread,
  prepareCompactProposeChange,
  rerecordState,
  getListedToolsWithConfig,
  resolveProtocolMode,
  makeDefaultRegistry,
  FileBackend,
  errorResult,
  TYPE_MAP,
  offsetToLineNumber,
} from '@changedown/cli/engine';
import type { DocumentBackend, DocumentSnapshot, ChangeOp } from '@changedown/core/backend';

import { bindOrForward } from './transport/fixed-port-leader.js';
import {
  attachStreamableHttp,
  subManager,
  sendNotificationToSession,
  getSessionClientInfo,
  getAllSessionClientInfos,
} from './transport/streamable-http.js';
import { synthesizeAuthorFromClientInfo } from './author.js';
import { startClientProxy } from './transport/client-proxy.js';
import { attachPaneEndpoints } from './transport/pane-endpoint.js';
import { createPaneRegistrationCallbacks } from './pane-registration.js';
import { ResourceLister } from './resources/resource-lister.js';
import { ResourceReader } from './resources/resource-reader.js';
import { version } from './version.js';
import { applyWordReviewChanges } from './word-review.js';
import { normalizeDocumentTarget } from './document-target.js';

type WordListChangeSummary = {
  change_id: string;
  type: string;
  status: string;
  author: string;
  line: number;
  preview: string;
  level: 0 | 1 | 2;
  anchored: boolean;
  resolved: boolean;
  consumed_by?: string;
};

type WordListChangeContext = WordListChangeSummary & {
  markup: string;
  original_text: string | null;
  modified_text: string | null;
  context_before: string[];
  context_after: string[];
};

type WordListChangeFullDetail = WordListChangeContext & {
  footnote: {
    author: string;
    date: string;
    reasoning: string | null;
    discussion_count: number;
    approvals: string[];
    rejections: string[];
    request_changes: string[];
  };
  participants: string[];
  group: {
    parent_id: string;
    description: string | null;
    siblings: string[];
  } | null;
};

const MAX_WORD_LIST_PREVIEW_LENGTH = 80;

function paneRequestTimeoutMs(): number {
  const raw = process.env.CHANGEDOWN_PANE_REQUEST_TIMEOUT_MS;
  if (!raw) return 600_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
}

function buildWordListPreview(change: ChangeNode): string {
  let preview = '';
  switch (change.type) {
    case 'Substitution':
      preview = `${change.originalText ?? ''}~>${change.modifiedText ?? ''}`;
      break;
    case 'Insertion':
      preview = change.modifiedText ?? '';
      break;
    case 'Deletion':
      preview = change.originalText ?? '';
      break;
    default:
      preview = change.originalText ?? change.modifiedText ?? '';
      break;
  }
  if (preview.length > MAX_WORD_LIST_PREVIEW_LENGTH) {
    return preview.slice(0, MAX_WORD_LIST_PREVIEW_LENGTH - 3) + '...';
  }
  return preview;
}

function effectiveChangeStatus(change: ChangeNode): string {
  return (change.metadata?.status ?? change.inlineMetadata?.status ?? change.status).toString().toLowerCase();
}

function buildWordSummaryEntry(change: ChangeNode, text: string): WordListChangeSummary {
  return {
    change_id: change.id,
    type: TYPE_MAP[change.type],
    status: effectiveChangeStatus(change),
    author: change.metadata?.author ?? change.inlineMetadata?.author ?? '',
    line: offsetToLineNumber(text, change.range.start),
    preview: buildWordListPreview(change),
    level: change.level,
    anchored: change.anchored,
    resolved: change.resolved ?? true,
    ...(change.consumedBy ? { consumed_by: change.consumedBy } : {}),
  };
}

function buildWordContextEntry(
  change: ChangeNode,
  text: string,
  lines: string[],
  summary: WordListChangeSummary,
  contextN: number,
): WordListChangeContext {
  const startLine = offsetToLineNumber(text, change.range.start);
  const endLine = offsetToLineNumber(text, change.range.end);
  return {
    ...summary,
    markup: text.slice(change.range.start, change.range.end),
    original_text: change.type === 'Insertion' ? null : (change.originalText ?? null),
    modified_text: change.type === 'Deletion' ? null : (change.modifiedText ?? null),
    context_before: lines.slice(Math.max(0, startLine - 1 - contextN), startLine - 1),
    context_after: lines.slice(endLine, Math.min(lines.length, endLine + contextN)),
  };
}

function buildWordFullDetailEntry(
  change: ChangeNode,
  text: string,
  lines: string[],
  doc: VirtualDocument,
  summary: WordListChangeSummary,
  contextN: number,
): WordListChangeFullDetail {
  const ctx = buildWordContextEntry(change, text, lines, summary, contextN);
  const meta = change.metadata;
  const participants = new Set<string>();
  if (meta?.author) participants.add(meta.author);
  meta?.discussion?.forEach((d) => participants.add(d.author));
  meta?.approvals?.forEach((a) => participants.add(a.author));
  meta?.rejections?.forEach((a) => participants.add(a.author));
  meta?.requestChanges?.forEach((a) => participants.add(a.author));

  let group: WordListChangeFullDetail['group'] = null;
  const dotIndex = change.id.lastIndexOf('.');
  if (dotIndex > 0) {
    const parentId = change.id.slice(0, dotIndex);
    const parentBlock = findFootnoteBlock(lines, parentId);
    let description: string | null = null;
    if (parentBlock) {
      for (let i = parentBlock.headerLine + 1; i <= parentBlock.blockEnd; i++) {
        const trimmed = lines[i]?.trim() ?? '';
        if (trimmed.startsWith('reason:') || trimmed.startsWith('context:')) continue;
        if (trimmed && !trimmed.startsWith('approved:') && !trimmed.startsWith('rejected:') && !trimmed.startsWith('request-changes:')) {
          description = trimmed;
          break;
        }
      }
    }
    const siblings = doc
      .getChanges()
      .filter((c) => (c.groupId === parentId || c.id.startsWith(parentId + '.')) && c.id !== parentId)
      .map((c) => c.id);
    group = { parent_id: parentId, description, siblings };
  }

  return {
    ...ctx,
    footnote: {
      author: meta?.author ?? '',
      date: meta?.date ?? '',
      reasoning: meta?.discussion?.[0]?.text ?? null,
      discussion_count: meta?.discussion?.length ?? 0,
      approvals: (meta?.approvals ?? []).map((a) => a.author),
      rejections: (meta?.rejections ?? []).map((a) => a.author),
      request_changes: (meta?.requestChanges ?? []).map((a) => a.author),
    },
    participants: [...participants],
    group,
  };
}

function buildWordDetailForLevel(
  detail: string,
  change: ChangeNode,
  text: string,
  lines: string[],
  doc: VirtualDocument,
  summary: WordListChangeSummary,
  contextN: number,
): WordListChangeSummary | WordListChangeContext | WordListChangeFullDetail {
  switch (detail) {
    case 'context':
      return buildWordContextEntry(change, text, lines, summary, contextN);
    case 'full':
      return buildWordFullDetailEntry(change, text, lines, doc, summary, contextN);
    default:
      return summary;
  }
}

async function buildWordListChangesResponse(
  backend: DocumentBackend,
  uri: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshot = await backend.read({ uri });
  const text = snapshot.text;
  const doc = parseForFormat(text);
  const allChanges = doc.getChanges();
  const lines = text.split('\n');
  const statusFilter = typeof args.status === 'string' ? args.status : undefined;
  const changeIdArg = typeof args.change_id === 'string' ? args.change_id : undefined;
  const changeIdsArg = Array.isArray(args.change_ids) ? args.change_ids.filter((id): id is string => typeof id === 'string') : undefined;
  const hasIds = !!(changeIdArg || (changeIdsArg && changeIdsArg.length > 0));
  const detail = typeof args.detail === 'string' ? args.detail : (hasIds ? 'full' : 'summary');
  const contextN = Math.max(0, typeof args.context_lines === 'number' ? args.context_lines : 3);
  const includeNativeDiagnostics = args.debug === true || args.diagnostics === true || args.native === true;
  const nativeChanges = includeNativeDiagnostics
    ? await backend.listChanges({ uri }, args).catch(() => undefined)
    : undefined;

  if (hasIds) {
    const targetIds = new Set<string>();
    if (changeIdArg) targetIds.add(changeIdArg);
    changeIdsArg?.forEach((id) => targetIds.add(id));

    const changeMap = new Map(allChanges.map((change) => [change.id, change]));
    const results: Array<WordListChangeSummary | WordListChangeContext | WordListChangeFullDetail | { change_id: string; error: string }> = [];
    for (const id of targetIds) {
      const change = changeMap.get(id);
      if (!change) {
        const settledBlock = findFootnoteBlock(lines, id);
        if (settledBlock) {
          const header = parseFootnoteHeader(settledBlock.headerContent);
          results.push({ change_id: id, error: `Change settled (status: ${header?.status ?? 'unknown'})` });
        } else {
          results.push({ change_id: id, error: 'Change not found' });
        }
        continue;
      }
      const summary = buildWordSummaryEntry(change, text);
      results.push(buildWordDetailForLevel(detail, change, text, lines, doc, summary, contextN));
    }

    return {
      file: uri,
      total_count: allChanges.length,
      filtered_count: results.length,
      changes: results,
      ...(nativeChanges ? { native_changes: nativeChanges } : {}),
      diagnostics: doc.getDiagnostics(),
    };
  }

  const entries = allChanges.map((change) => {
    const summary = buildWordSummaryEntry(change, text);
    return buildWordDetailForLevel(detail, change, text, lines, doc, summary, contextN);
  });
  const filtered = statusFilter
    ? entries.filter((entry) => 'status' in entry && entry.status === statusFilter)
    : entries;

  return {
    file: uri,
    total_count: entries.length,
    filtered_count: filtered.length,
    changes: filtered,
    ...(nativeChanges ? { native_changes: nativeChanges } : {}),
    diagnostics: doc.getDiagnostics(),
  };
}

/**
 * Decode MCP root URIs (file://) to filesystem paths for the current platform.
 */
function rootUrisToPaths(roots: { uri: string }[]): string[] {
  const paths: string[] = [];
  for (const r of roots) {
    if (!r?.uri || !r.uri.startsWith('file://')) continue;
    try {
      paths.push(fileURLToPath(r.uri));
    } catch {
      // Skip malformed or unsupported URIs
    }
  }
  return paths;
}

/**
 * Host mode: wires up the registry, tool handlers, HTTP transports, and stdio.
 * Takes the already-bound http.Server from bindOrForward so index.ts doesn't
 * need to import the http module directly.
 */
async function startHostMode(port: number, httpServer: HttpServer): Promise<void> {
  // Register signal handlers immediately — before any awaits — so SIGINT/SIGTERM
  // during cold-start (e.g. the 2 s bridge connect timeout) still shuts down cleanly.
  let httpHandle: Awaited<ReturnType<typeof attachStreamableHttp>> | undefined;
  let paneHandle: ReturnType<typeof attachPaneEndpoints> | undefined;
  // resolver is assigned synchronously before any request handler fires.
  // The shutdown closure guards with (resolver as ConfigResolver | undefined)?.dispose()
  // in case SIGINT arrives before the synchronous assignment.
  let resolver: ConfigResolver | undefined;

  let shutdownCalled = false;
  function shutdown(signal: string): void {
    if (shutdownCalled) return;
    shutdownCalled = true;
    console.error(`[changedown] ${signal} received — draining 250 ms then exiting`);
    httpHandle?.detach();
    paneHandle?.detach();
    resolver?.dispose();
    setTimeout(() => {
      httpServer.close(() => process.exit(0));
      // SSE streams can keep sockets open after detach while the browser tears
      // down. Do not let a test or parent process leave the fixed port pinned.
      setTimeout(() => process.exit(0), 1000).unref();
    }, 250);
  }
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  const fallbackDir =
    process.env['CHANGEDOWN_PROJECT_DIR'] ||
    process.env['PWD'] ||
    process.cwd();
  resolver = new ConfigResolver(fallbackDir);
  const state = new SessionState();
  state.enableGuide();

  // Create MCP server
  const server = new Server(
    { name: 'changedown', version },
    { capabilities: { tools: {}, resources: { subscribe: true } } }
  );

  // When the client sends initialized, fetch workspace roots if the host supports MCP roots.
  server.oninitialized = async () => {
    if (!server.getClientCapabilities()?.roots) return;
    try {
      const response = await server.listRoots();
      if (response?.roots?.length) {
        const paths = rootUrisToPaths(response.roots);
        if (paths.length) {
          resolver.setSessionRoots(paths);
          console.error(`changedown: using ${paths.length} workspace root(s) from host`);
        }
      }
    } catch (err) {
      console.error('changedown: failed to fetch MCP roots:', err instanceof Error ? err.message : String(err));
    }
  };

  // When the host notifies that roots changed (e.g. user switched workspace), refresh.
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    if (!server.getClientCapabilities()?.roots) return;
    try {
      const response = await server.listRoots();
      if (response?.roots?.length) {
        const paths = rootUrisToPaths(response.roots);
        resolver.setSessionRoots(paths);
        console.error(`changedown: refreshed ${paths.length} workspace root(s)`);
      }
    } catch (err) {
      console.error('changedown: failed to refresh MCP roots:', err instanceof Error ? err.message : String(err));
    }
  });

  // Handle tools/list — enrich tool descriptions from project config so agent sees
  // e.g. "In this project author is required" before first write
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const config = await resolver.lastConfig();
    const mode = resolveProtocolMode(config.protocol.mode);
    return { tools: getListedToolsWithConfig(config, mode) };
  });

  // ── Tool dispatch ──────────────────────────────────────────────────

  type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  /**
   * Dispatch a tool call to the appropriate handler and coerce the result
   * to CallToolResult. This eliminates `as Promise<CallToolResult>` casts
   * on every handler call.
   */
  async function dispatchTool(handler: ToolHandler, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = await handler(args);
    return result as CallToolResult;
  }

  // ── Build backend registry ─────────────────────────────────────────────────
  // The registry resolves URIs to the correct backend implementation.
  // file:// → FileBackend; word:// → RemoteBackend (registered at pane connect).
  const registry = makeDefaultRegistry(fallbackDir);

  // ── Backward-compat alias handlers (not in tools/list) ─────────────────────
  // These 9 handlers are file-only (no word:// support in the legacy path).
  // They bypass the registry and call handlers directly.
  const compatHandlers: Record<string, ToolHandler> = {
    get_change:          (a) => handleGetChange(a, resolver),
    propose_batch:       (a) => handleProposeBatch(a, resolver, state),
    begin_change_group:  (a) => handleBeginChangeGroup(a, resolver, state),
    end_change_group:    (a) => handleEndChangeGroup(a, resolver, state),
    review_change:       (a) => handleReviewChange(a, resolver, state),
    respond_to_thread:   (a) => handleRespondToThread(a, resolver, state),
    list_open_threads:   (a) => handleListOpenThreads(a, resolver, state),
    raw_edit:            (a) => handleRawEdit(a, resolver),
    get_tracking_status: (a) => handleGetTrackingStatus(a, resolver, state),
  };

  // ── File-backend write handlers (for the registry-routed file:// path) ─────
  // When the backend resolves to FileBackend, dispatch writes directly to the
  // engine handlers to preserve their full argument surface.
  const kindMap: Record<string, ChangeOp['kind']> = {
    propose_change:   'propose',
    review_changes:   'review',
    amend_change:     'amend',
    supersede_change: 'supersede',
    resolve_thread:   'resolve_thread',
  };

  const fileWriteHandlers: Record<string, ToolHandler> = {
    propose_change:   (a) => handleProposeChange(a, resolver, state),
    review_changes:   (a) => handleReviewChanges(a, resolver, state),
    amend_change:     (a) => handleAmendChange(a, resolver, state),
    supersede_change: (a) => handleSupersedeChange(a, resolver, state),
    resolve_thread:   (a) => handleResolveThread(a, resolver, state),
  };

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    // Inject a synthesized author from MCP clientInfo when the caller omits one.
    // Explicit args.author always wins — we only fill the gap when it is absent.
    // The synthesized value is derived from the clientInfo captured at initialize
    // time for this session.
    const mutableArgs: Record<string, unknown> = { ...(args ?? {}) };
    if (!mutableArgs.author) {
      const sessionId = extra?.sessionId;
      if (sessionId) {
        const clientInfo = getSessionClientInfo(sessionId);
        const synthesized = synthesizeAuthorFromClientInfo(clientInfo);
        if (synthesized !== undefined) {
          mutableArgs.author = synthesized;
        }
      }
    }

    const fileArg = mutableArgs.file as string | undefined;

    // Helper: increment the edit counter for this session if all preconditions hold.
    // The success predicate (isError vs applied) is specific to each call site.
    const maybeIncrementEditCount = (sid: string | undefined): void => {
      if (!sid || !paneHandle) return;
      paneHandle.incrementEditCount(sid, getAllSessionClientInfos());
    };

    // ── Registry-routed tools (listed tools that operate on a document) ──────
    // When a file argument is present, resolve the backend via URI scheme and
    // dispatch. Collapses the old isWordTarget() branch: file:// and word://
    // share the same routing path now.
    if (fileArg !== undefined) {
      const target = normalizeDocumentTarget(fileArg, fallbackDir);
      const uri = target.uri;

      let backend: DocumentBackend;
      try {
        backend = registry.resolve(uri);
      } catch (resolveErr) {
        return errorResult(resolveErr instanceof Error ? resolveErr.message : String(resolveErr)) as CallToolResult;
      }
      const fileArgs = backend instanceof FileBackend && uri.startsWith('file://')
        ? { ...mutableArgs, file: target.filePath }
        : mutableArgs;

      switch (name) {
        case 'read_tracked_file': {
          // For file backends, call the handler directly to preserve all the
          // view/offset/limit options. The registry is used only for routing.
          if (backend instanceof FileBackend) {
            return dispatchTool((a) => handleReadTrackedFile(a, resolver, state), fileArgs);
          }
          // word:// path: read from backend, then run the same buildViewDocument →
          // pagination → formatPlainText pipeline as the file:// path so that
          // agents get LINE:HASH coordinates they can use with propose_change.
          try {
            const snapshot = await backend.read({ uri });

            // Parse view/offset/limit from args (same defaults as read-tracked-file.ts).
            const DEFAULT_LIMIT = 500;
            const MAX_LIMIT = 2000;
            const requestedView = typeof mutableArgs.view === 'string' ? mutableArgs.view : undefined;
            const offset = typeof mutableArgs.offset === 'number' ? mutableArgs.offset : 1;
            const requestedLimit = typeof mutableArgs.limit === 'number' ? mutableArgs.limit : undefined;

            const resolvedView = requestedView !== undefined ? resolveView(requestedView) : null;
            if (requestedView !== undefined && resolvedView === null) {
              return errorResult(
                `Unknown view '${requestedView}'. Valid views: working, simple, decided, original, raw`,
              ) as CallToolResult;
            }

            // Config for view-policy and protocol-mode. No project dir for word://,
            // so use resolver.lastConfig() which returns config for the current session.
            const config = await resolver.lastConfig();
            const defaultView = resolveView(config.policy.default_view ?? 'working') ?? 'working';
            const viewPolicy = config.policy.view_policy ?? 'suggest';
            const canonicalView = requestedView === undefined
              ? defaultView
              : resolvedView!;

            if (viewPolicy === 'require' && canonicalView !== defaultView) {
              return errorResult(
                `This project requires view "${config.policy.default_view}" (view_policy = "require"). ` +
                `Requested view "${requestedView}" is not allowed.`,
              ) as CallToolResult;
            }

            const protocolMode = resolveProtocolMode(config.protocol.mode);

            // Build the view document (same pipeline as file:// path).
            // Word documents are always actively tracked when the add-in is connected.
            const doc = buildViewDocument(snapshot.text, canonicalView, {
              filePath: uri,            // e.g. "word://sess-abc" — no filesystem path
              trackingStatus: 'tracked',
              protocolMode,
              defaultView,
              viewPolicy,
            });

            // Record session hashes so subsequent propose_change at: "LINE:HASH" works.
            let sessionHashes = doc.lines.map((l) => ({
              line: l.margin.lineNumber,
              raw: l.sessionHashes.raw,
              committed: l.sessionHashes.committed,
              currentView: l.sessionHashes.currentView,
              rawLineNum: l.rawLineNumber,
            }));
            let syntheticBlankAnchor: string | null = null;
            if (doc.lines.length === 0 && (canonicalView === 'working' || canonicalView === 'simple')) {
              // A new Word document may materialize as an empty ChangeDown source.
              // Cold-start reconciliation can also record that emptiness as an
              // accepted initial-word-body footnote, leaving no visible current
              // lines even though the raw L2 has a patchable blank body line.
              // Compact public editing still needs one coordinate to attach the
              // first proposal. Treat this as a patchable empty line in the wire
              // protocol; it is not extra document content.
              const rawLines = snapshot.text.split('\n');
              const rawLineIndex = rawLines.findIndex((line) => line.trim() === '');
              const rawLineNum = rawLineIndex >= 0 ? rawLineIndex + 1 : 1;
              const rawLine = rawLines[rawLineNum - 1] ?? '';
              const hash = computeLineHash(rawLineNum - 1, rawLine, rawLines);
              syntheticBlankAnchor = ` 1:${hash}  | `;
              sessionHashes = [{
                line: 1,
                raw: hash,
                committed: hash,
                currentView: hash,
                rawLineNum,
              }];
            }
            state.recordAfterRead(uri, canonicalView, sessionHashes, snapshot.text);

            // Pagination.
            const totalLines = doc.lines.length;
            const effectiveStart = Math.max(1, offset);
            const limit = Math.min(requestedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);
            const effectiveEnd = Math.min(effectiveStart + limit - 1, totalLines);

            // Safe pagination: don't truncate mid-CriticMarkup block.
            let adjustedEnd = effectiveEnd;
            while (adjustedEnd < doc.lines.length && doc.lines[adjustedEnd]?.continuesChange) {
              adjustedEnd++;
            }

            const paginatedDoc = {
              ...doc,
              lines: doc.lines.slice(effectiveStart - 1, adjustedEnd),
              header: {
                ...doc.header,
                lineRange: { start: effectiveStart, end: adjustedEnd, total: totalLines },
              },
            };

            let output = formatPlainText(paginatedDoc);
            if (syntheticBlankAnchor !== null) {
              output = output.endsWith('---')
                ? `${output}\n${syntheticBlankAnchor}`
                : `${output}\n${syntheticBlankAnchor}`;
            }

            // Truncation hint.
            if (adjustedEnd < totalLines) {
              output += `\n\n--- showing lines ${effectiveStart}-${adjustedEnd} of ${totalLines} | use offset/limit to paginate ---`;
            }

            return { content: [{ type: 'text' as const, text: output }] } as CallToolResult;
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err)) as CallToolResult;
          }
        }
        case 'list_changes': {
          if (backend instanceof FileBackend) {
            return dispatchTool((a) => handleListChanges(a, resolver, state), fileArgs);
          }
          try {
            const response = await buildWordListChangesResponse(backend, uri, mutableArgs);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response) }],
            } as CallToolResult;
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err)) as CallToolResult;
          }
        }
        case 'propose_change':
        case 'review_changes':
        case 'amend_change':
        case 'supersede_change':
        case 'resolve_thread': {
          if (backend instanceof FileBackend) {
            const h = fileWriteHandlers[name];
            if (h) {
              const toolResult = await dispatchTool(h, fileArgs);
              // Increment edit count for document-write tools (not read-only tools).
              // propose_change, amend_change, supersede_change are edits; review_changes
              // is a status update that could go either way — treated as an edit here
              // because it changes the document's review state. resolve_thread resolves
              // a comment thread and is also counted as a document write.
              if (!toolResult.isError) maybeIncrementEditCount(extra?.sessionId);
              return toolResult;
            }
          }
          // word:// propose_change baseline: run the normal ChangeDown compact
          // proposal machinery against the materialized L2 snapshot first, then
          // send Word only the old/new L2 document pair to apply natively.
          if (name === 'propose_change') {
            try {
              if (Object.prototype.hasOwnProperty.call(mutableArgs, 'word_spike_direct') || Object.prototype.hasOwnProperty.call(mutableArgs, 'word_author_spike') || Object.prototype.hasOwnProperty.call(mutableArgs, 'spike')) {
                return errorResult('word_spike_direct/word_author_spike/spike are diagnostic-only and are not supported by public word:// propose_change') as CallToolResult;
              }


              const snapshot = await backend.read({ uri });
              const config = await resolver.lastConfig();
              const prepared = await prepareCompactProposeChange({
                args: mutableArgs,
                filePath: uri,
                relativePath: uri,
                fileContent: snapshot.text,
                config,
                state,
              });
              if (!prepared.ok) return prepared.toolResult as CallToolResult;

              const result = prepared.threadReply
                ? await backend.applyChange(
                  { uri },
                  {
                    kind: 'respond',
                    args: {
                      cnId: prepared.threadReply.changeId,
                      text: prepared.threadReply.text,
                      author: prepared.threadReply.author,
                    },
                  },
                )
                : await backend.applyChange(
                  { uri },
                  {
                    kind: 'propose',
                    args: {
                      oldL2: prepared.oldL2,
                      newL2: prepared.newL2,
                    },
                  },
                );
              if (result.applied === false) {
                return errorResult(result.text ?? 'Word adapter did not apply prepared proposal') as CallToolResult;
              }

              // The prepared L2 is useful for the core response, but the native
              // Word document is source of truth after Office.js mutation. Try to
              // re-read and record the reconciled snapshot; fall back to the
              // prepared L2 only if readback is unavailable.
              try {
                const after = await backend.read({ uri });
                await rerecordState(state, uri, after.text, config);
              } catch {
                await rerecordState(state, uri, prepared.newL2, config);
              }

              maybeIncrementEditCount(extra?.sessionId);
              return prepared.toolResult as CallToolResult;
            } catch (err) {
              return errorResult(err instanceof Error ? err.message : String(err)) as CallToolResult;
            }
          }

          if (name === 'review_changes') {
            try {
              const config = await resolver.lastConfig();
              const response = await applyWordReviewChanges(mutableArgs, backend, uri);
              try {
                const after = await backend.read({ uri });
                await rerecordState(state, uri, after.text, config);
              } catch {
                // Review already completed; state can recover on the next read.
              }
              const anyUpdated = Array.isArray(response.results) && response.results.some((r) => {
                return typeof r === 'object' && r !== null && (r as { status_updated?: unknown }).status_updated === true;
              });
              if (anyUpdated) maybeIncrementEditCount(extra?.sessionId);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response) }] } as CallToolResult;
            } catch (err) {
              return errorResult(err instanceof Error ? err.message : String(err)) as CallToolResult;
            }
          }

          // Other word:// writes still route through applyChange until their
          // own core-first adapter tranches are designed. Keep the public MCP
          // snake_case surface compatible with the pane's internal command
          // shape while those tranches are still backend-routed.
          if (name === 'amend_change') {
            mutableArgs.cnId = mutableArgs.cnId ?? mutableArgs.change_id ?? mutableArgs.changeId;
            mutableArgs.newText = mutableArgs.newText ?? mutableArgs.new_text;
          }
          const kind = kindMap[name];
          if (!kind) break;
          try {
            const result = await backend.applyChange({ uri }, { kind, args: mutableArgs });
            // Same edit-count policy for word:// path: only increment on success.
            // ChangeResult.applied is false when the operation did not take effect.
            if (result.applied !== false) maybeIncrementEditCount(extra?.sessionId);
            return {
              content: [{ type: 'text' as const, text: result.text ?? JSON.stringify(result) }],
            } as CallToolResult;
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err)) as CallToolResult;
          }
        }
      }
    }

    // ── Backward-compat aliases (no file arg, or name not registry-routed) ───
    const compatHandler = compatHandlers[name];
    if (compatHandler) {
      return dispatchTool(compatHandler, mutableArgs);
    }

    return errorResult(`Unknown tool: ${name}`) as CallToolResult;
  });

  // ── Resource handlers ──────────────────────────────────────────────────────
  const resourceLister = new ResourceLister(registry);
  const formatSnapshotForAgentRead = async (uri: string, snapshot: DocumentSnapshot): Promise<string> => {
    const config = await resolver.lastConfig();
    const defaultView = resolveView(config.policy.default_view ?? 'working') ?? 'working';
    const protocolMode = resolveProtocolMode(config.protocol.mode);
    const doc = buildViewDocument(snapshot.text, defaultView, {
      filePath: uri,
      trackingStatus: 'tracked',
      protocolMode,
      defaultView,
      viewPolicy: config.policy.view_policy ?? 'suggest',
    });

    // resources/read should be just as actionable as read_tracked_file: record
    // the returned LINE:HASH coordinates so subsequent propose_change calls
    // against the same word:// URI can validate staleness normally.
    state.recordAfterRead(
      uri,
      defaultView,
      doc.lines.map((l) => ({
        line: l.margin.lineNumber,
        raw: l.sessionHashes.raw,
        committed: l.sessionHashes.committed,
        currentView: l.sessionHashes.currentView,
        rawLineNum: l.rawLineNumber,
      })),
      snapshot.text,
    );

    return formatPlainText(doc);
  };
  const resourceReader = new ResourceReader(registry, formatSnapshotForAgentRead);

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resourceLister.list() };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<Record<string, unknown>> => {
    const { uri } = request.params;
    return resourceReader.read(uri) as unknown as Promise<Record<string, unknown>>;
  });

  // Singleton backend listeners: one per URI so N subscribed agent sessions
  // on the same URI do not trigger N² backend.subscribe() calls.
  // Each value is the Unsubscribe returned by backend.subscribe().
  const uriBackendSubscriptions = new Map<string, () => void>();

  server.setRequestHandler(SubscribeRequestSchema, async (request, extra) => {
    const { uri } = request.params;
    const sessionId = extra?.sessionId;
    if (!sessionId) {
      throw new McpError(ErrorCode.InvalidRequest, 'Session ID required for subscriptions');
    }
    subManager.subscribe(sessionId, uri);

    // Wire a single backend listener for this URI if none exists yet.
    // This prevents N sessions on one URI from triggering N backend.subscribe() calls.
    if (!uriBackendSubscriptions.has(uri)) {
      let backend: import('@changedown/core/backend').DocumentBackend;
      try {
        backend = registry.resolve(uri);
      } catch {
        return {};
      }
      const unsubscribe = backend.subscribe({ uri }, (event) => {
        subManager.fanOut(uri, (sid, notification) => {
          sendNotificationToSession(sid, notification);
        }, event.kind === 'document_changed' ? event.version : undefined);
      });
      uriBackendSubscriptions.set(uri, unsubscribe);
    }
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request, extra) => {
    const { uri } = request.params;
    const sessionId = extra?.sessionId;
    if (sessionId) {
      subManager.unsubscribe(sessionId, uri);
      // Tear down the singleton backend listener when no sessions remain subscribed.
      if (subManager.subscribersFor(uri).length === 0) {
        const unsubscribe = uriBackendSubscriptions.get(uri);
        unsubscribe?.();
        uriBackendSubscriptions.delete(uri);
      }
    }
    return {};
  });

  // Attach pane endpoints (health + backend registration + SSE) to the HTTP
  // server. Callbacks live in pane-registration.ts so the wiring tests
  // exercise the same code path as production.
  paneHandle = attachPaneEndpoints(
    httpServer,
    {
      ...createPaneRegistrationCallbacks(() => paneHandle!, registry),
      requestTimeoutMs: paneRequestTimeoutMs(),
    },
  );

  // Attach MCP Streamable HTTP transport — one Server instance per HTTP session,
  // handlers copied from the template `server` at session creation time.
  httpHandle = await attachStreamableHttp(server, httpServer);

  // Composed dispatcher: routes /mcp* requests to the streamable-http handler
  // and everything else to the pane-endpoint handler. This is the canonical
  // request path in production; the two self-registered listeners on paneHandle
  // and httpHandle also remain attached and act as a fallback for standalone
  // test callers. The headersSent/writableEnded guard at the top of each
  // transport's requestListener makes those self-registered listeners no-ops
  // when the composed dispatcher has already responded.
  //
  // Listener fire order (FIFO): pane self-listener → streamable self-listener →
  // composed dispatcher. The guard ensures only the composed dispatcher writes
  // the response; the earlier self-listeners bail immediately on headersSent.
  //
  // Rationale: without this dispatcher, a GET /health request falls through
  // the streamable-http self-listener without a response (no /mcp* match),
  // leaving the socket open and causing curl to report "Empty reply from server".
  httpServer.on('request', (req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/mcp')) {
      httpHandle!.handleHttpRequest(req, res);
    } else {
      paneHandle!.handleHttpRequest(req, res);
    }
  });

  // When an MCP session's initialize/initialized handshake completes, broadcast
  // the updated agent list to all connected panes.
  httpHandle.onSessionReady(() => {
    const infos = getAllSessionClientInfos();
    paneHandle?.pruneEditCounts(infos);
    paneHandle?.broadcastAgentsUpdated(infos);
  });

  // When an MCP session disconnects, remove its subscriptions, tear down
  // any singleton backend listeners whose subscriber count drops to zero,
  // and broadcast the updated agent list to all panes.
  httpHandle.onSessionClose((sessionId) => {
    subManager.removeSession(sessionId);
    for (const [uri, unsubscribe] of uriBackendSubscriptions) {
      if (subManager.subscribersFor(uri).length === 0) {
        unsubscribe();
        uriBackendSubscriptions.delete(uri);
      }
    }
    const infos = getAllSessionClientInfos();
    paneHandle?.pruneEditCounts(infos);
    paneHandle?.broadcastAgentsUpdated(infos);
  });

  // Connect via stdio transport (parent harness / Claude Code)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up on stdio transport close (parent harness disconnects)
  server.onclose = () => {
    shutdown('stdio-close');
    // Registry has no subscribers in this tranche. Once MCP resources/list
    // or any other consumer calls registry.onDidChange, its disposers must
    // also be invoked here to avoid orphaned listeners.
  };

  // Log to stderr (stdout is reserved for JSON-RPC)
  console.error(`changedown MCP server running — host on 127.0.0.1:${port}, stdio active`);
}

/**
 * ChangeDown MCP Server
 *
 * Performs leader election on port 39990. If this process wins the port it
 * becomes the host: wires the full registry + tool dispatch, attaches MCP
 * Streamable HTTP and pane endpoints, and serves Claude Code over stdio.
 *
 * If the port is already held by another changedown-mcp process this process
 * becomes a client: it forwards all stdio traffic to the host via HTTP and
 * starts a heartbeat to promote itself if the host dies.
 */
async function main(): Promise<void> {
  await initHashline();

  const PORT = Number.parseInt(process.env.CHANGEDOWN_MCP_PORT ?? '39990', 10);
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    throw new Error(`Invalid CHANGEDOWN_MCP_PORT: ${process.env.CHANGEDOWN_MCP_PORT}`);
  }
  const leaderResult = await bindOrForward(PORT);

  if (leaderResult.mode === 'client') {
    console.error(`[changedown] client mode — forwarding to ${leaderResult.hostUrl}`);
    const proxy = await startClientProxy({ hostUrl: leaderResult.hostUrl });

    // Heartbeat + promotion: if host dies, try to become host ourselves.
    void leaderResult.startHeartbeat({ intervalMs: 1500, failThreshold: 3 }).then(async (promoted) => {
      console.error('[changedown] host died — promoted to host mode');
      proxy.stop();
      if (promoted.mode === 'host') {
        await startHostMode(PORT, promoted.server);
      }
    });

    proxy.onClose(() => process.exit(0));
    return;
  }

  await startHostMode(PORT, leaderResult.server);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
