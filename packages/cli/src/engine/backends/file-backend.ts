// packages/cli/src/engine/backends/file-backend.ts
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  DocumentBackend,
  DocumentRef,
  DocumentSnapshot,
  DocumentResourceDescriptor,
  ChangeOp,
  ChangeResult,
  ChangeSummary,
  BackendEvent,
  Unsubscribe,
} from '@changedown/core/backend';
import { ConfigResolver } from '../config-resolver.js';
import { SessionState } from '../state.js';
import {
  handleReadTrackedFile,
  handleProposeChange,
  handleReviewChanges,
  handleAmendChange,
  handleSupersedeChange,
  handleListChanges,
  handleResolveThread,
  handleRespondToThread,
} from '../handlers/index.js';

/** Debounce delay for `fs.watch` events, in milliseconds. */
const WATCH_DEBOUNCE_MS = 100;

/**
 * FileBackend — implements DocumentBackend for `file://` URIs.
 *
 * All read/write logic delegates unchanged to the existing handler functions.
 * This class adds no new business logic; it is purely a routing adapter.
 */
export class FileBackend implements DocumentBackend {
  readonly schemes = ['file'] as const;

  private readonly resolver: ConfigResolver;
  private readonly state: SessionState;

  /**
   * Construct a FileBackend rooted at `projectDir`.
   *
   * FileBackend owns its own ConfigResolver and SessionState. When this
   * backend is invoked through the MCP server, the server's `instanceof
   * FileBackend` fast-path calls the engine handlers directly with the
   * server's resolver and state, so FileBackend's internal pair is only
   * used when a consumer calls `read`/`applyChange`/`listChanges`
   * directly on the backend — for example, from tests, or from a future
   * consumer that doesn't know it's holding a FileBackend.
   *
   * If that pattern grows, refactor to accept the resolver and state as
   * constructor injections.
   */
  constructor(projectDir: string) {
    this.resolver = new ConfigResolver(projectDir);
    this.state = new SessionState();
    this.state.enableGuide();
  }

  // ─── list() ────────────────────────────────────────────────────────────────

  list(): DocumentResourceDescriptor[] {
    const paths = this.state.getAccessedPaths();
    return paths.map((absPath) => ({
      uri: `file://${absPath}`,
      name: absPath.split('/').pop() ?? absPath,
      mimeType: 'text/markdown' as const,
      // version intentionally omitted; per-path version tracking is a follow-up.
      // Adding this would require SessionState to expose a per-record version stamp.
      version: undefined,
    }));
  }

  // ─── URI → path ───────────────────────────────────────────────────────────

  private refToPath(ref: DocumentRef): string {
    const { uri } = ref;
    if (!uri.startsWith('file://')) {
      const scheme = uri.split(':')[0] ?? '(none)';
      throw new Error(`FileBackend: expected file:// URI, got scheme '${scheme}'`);
    }
    try {
      return fileURLToPath(uri);
    } catch (err) {
      throw new Error(
        `FileBackend: cannot resolve URI to path: ${uri} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── read() ────────────────────────────────────────────────────────────────

  async read(ref: DocumentRef): Promise<DocumentSnapshot> {
    const filePath = this.refToPath(ref);
    const result = await handleReadTrackedFile(
      { file: filePath },
      this.resolver,
      this.state,
    );
    if (result.isError) {
      throw new Error(result.content[0]?.text ?? 'FileBackend.read: unknown error');
    }
    const text = result.content.map((c) => c.text).join('');
    let version = '';
    try {
      const stat = await fs.promises.stat(filePath);
      version = stat.mtimeMs.toString();
    } catch {
      // Non-fatal; version used only for change detection.
    }
    return { text, format: 'L2', version };
  }

  // ─── listChanges() ─────────────────────────────────────────────────────────

  async listChanges(
    ref: DocumentRef,
    filter: Record<string, unknown> = {},
  ): Promise<ChangeSummary[]> {
    const filePath = this.refToPath(ref);
    const result = await handleListChanges(
      { file: filePath, ...filter },
      this.resolver,
      this.state,
    );
    if (result.isError) {
      throw new Error(result.content[0]?.text ?? 'FileBackend.listChanges: unknown error');
    }
    try {
      const raw = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
      const changes = raw.changes as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(changes)) return [];
      return changes.map((c) => ({
        changeId: String(c.change_id ?? c.changeId ?? ''),
        type: String(c.type ?? ''),
        status: String(c.status ?? ''),
        author: String(c.author ?? ''),
        line: Number(c.line ?? 0),
        preview: String(c.preview ?? ''),
      }));
    } catch (err) {
      console.warn(
        '[FileBackend.listChanges] handler returned non-JSON success response; returning []',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  // ─── applyChange() ─────────────────────────────────────────────────────────

  async applyChange(ref: DocumentRef, op: ChangeOp): Promise<ChangeResult> {
    const filePath = this.refToPath(ref);
    const args = { file: filePath, ...op.args };

    let rawResult: { content: Array<{ type: string; text: string }>; isError?: boolean };

    switch (op.kind) {
      case 'propose':
        rawResult = await handleProposeChange(args, this.resolver, this.state);
        break;
      case 'review':
        rawResult = await handleReviewChanges(args, this.resolver, this.state);
        break;
      case 'amend':
        rawResult = await handleAmendChange(args, this.resolver, this.state);
        break;
      case 'supersede':
        rawResult = await handleSupersedeChange(args, this.resolver, this.state);
        break;
      case 'resolve_thread':
        rawResult = await handleResolveThread(args, this.resolver, this.state);
        break;
      case 'respond':
        rawResult = await handleRespondToThread(args, this.resolver, this.state);
        break;
      default: {
        const _kind: never = op;
        throw new Error(`Unknown ChangeOp kind: ${(_kind as ChangeOp).kind}`);
      }
    }

    if (rawResult.isError) {
      return { applied: false, text: rawResult.content[0]?.text };
    }

    const text = rawResult.content[0]?.text ?? '';
    let changeId: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.change_id === 'string') changeId = parsed.change_id;
    } catch {
      // Non-JSON response — changeId stays undefined.
    }
    return { applied: true, changeId, text };
  }

  // ─── subscribe() ───────────────────────────────────────────────────────────

  subscribe(ref: DocumentRef, listener: (event: BackendEvent) => void): Unsubscribe {
    const filePath = this.refToPath(ref);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(filePath, () => {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          debounceTimer = null;
          let version = '';
          try {
            const stat = await fs.promises.stat(filePath);
            version = stat.mtimeMs.toString();
          } catch {
            listener({ kind: 'backend_disconnected' });
            return;
          }
          listener({ kind: 'document_changed', version });
        }, WATCH_DEBOUNCE_MS);
      });
    } catch {
      // File doesn't exist yet or platform doesn't support fs.watch; no-op.
    }

    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher?.close();
    };
  }
}
