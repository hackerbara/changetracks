/**
 * Edit Boundary State Machine — Core Logic
 *
 * Pure function that processes edit events and produces new state + effects.
 * No I/O, no timers, no async — timer scheduling is emitted as an effect
 * for the host adapter to execute.
 *
 * This replaces 738 LOC in the VS Code extension and 455 LOC in the LSP
 * server with a single, testable, editor-agnostic state machine.
 */

import type {
  EditEvent,
  EditBoundaryState,
  Effect,
  EditPendingOverlay,
  PendingBuffer,
} from './types.js';
import { classifySignal } from './signal-classifier.js';
import {
  createBuffer,
  extend,
  prependOriginal,
  appendOriginal,
  spliceInsert,
  spliceDelete,
} from './pending-buffer.js';

// ── Public API ──────────────────────────────────────────────────────────

export interface ProcessEventContext {
  /** Current timestamp (ms). Injected by host for deterministic replay. */
  now: number;
  /** Allocate a new change ID (e.g., "ct-7"). Called once per buffer creation. */
  allocateScId?: () => string;
}

export interface ProcessEventResult {
  newState: EditBoundaryState;
  effects: Effect[];
}

export function processEvent(
  state: EditBoundaryState,
  event: EditEvent,
  context: ProcessEventContext,
): ProcessEventResult {
  // Timestamp-based break: if pending buffer exists and time gap exceeded,
  // treat as break regardless of adjacency (LibreOffice deltaOneMinute pattern).
  if (
    state.pending !== null &&
    state.config.pauseThresholdMs > 0 &&
    (event.type === 'insertion' || event.type === 'deletion' || event.type === 'substitution') &&
    context.now - state.pending.lastEditTime > state.config.pauseThresholdMs
  ) {
    return handleBreak(state, event, context);
  }

  const signal = classifySignal(event, state);

  switch (signal) {
    case 'hard-break':
      return handleHardBreak(state);
    case 'break':
      return handleBreak(state, event, context);
    case 'extend':
      return handleExtend(state, event, context);
    case 'splice':
      return handleSplice(state, event, context);
    case 'ignore':
      return { newState: state, effects: [] };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────

/** Convert a PendingBuffer to the overlay data the host renders. */
function createOverlay(buf: PendingBuffer): EditPendingOverlay {
  return {
    anchorOffset: buf.anchorOffset,
    currentLength: buf.currentText.length,
    currentText: buf.currentText,
    originalText: buf.originalText,
    cursorOffset: buf.cursorOffset,
  };
}

/** Flush the pending buffer: crystallize + clear overlay + merge adjacent. */
function flush(state: EditBoundaryState): { effects: Effect[]; clearedState: EditBoundaryState } {
  const buf = state.pending;
  if (buf === null) {
    return { effects: [], clearedState: state };
  }

  const effects: Effect[] = [];

  const hasOriginal = buf.originalText.length > 0;
  const hasCurrent = buf.currentText.length > 0;

  if (!hasOriginal && !hasCurrent) {
    // Self-cancellation: both empty → no crystallize, just clean up
  } else {
    let changeType: 'insertion' | 'deletion' | 'substitution';
    if (!hasOriginal && hasCurrent) {
      changeType = 'insertion';
    } else if (hasOriginal && !hasCurrent) {
      changeType = 'deletion';
    } else {
      changeType = 'substitution';
    }

    effects.push({
      type: 'crystallize',
      changeType,
      offset: buf.anchorOffset,
      length: changeType === 'insertion' ? buf.currentText.length :
              changeType === 'deletion' ? 0 :
              buf.currentText.length,
      currentText: buf.currentText,
      originalText: buf.originalText,
      scId: buf.scId,
    });
  }

  effects.push(
    { type: 'updatePendingOverlay', overlay: null },
    { type: 'mergeAdjacent', offset: buf.anchorOffset },
  );

  return { effects, clearedState: { ...state, pending: null } };
}

/**
 * hard-break: control events (save, editorSwitch, flush).
 * Flush pending buffer, no new buffer.
 */
function handleHardBreak(state: EditBoundaryState): ProcessEventResult {
  const { effects, clearedState } = flush(state);
  return { newState: clearedState, effects };
}

/**
 * break: edit outside buffer range, type switch, timestamp gap, newline, paste,
 * or first edit with no prior buffer.
 * Flush old buffer (if any), start new buffer for the triggering edit.
 */
function handleBreak(
  state: EditBoundaryState,
  event: EditEvent,
  context: ProcessEventContext,
): ProcessEventResult {
  const { effects: flushEffects, clearedState } = flush(state);

  if (event.type === 'insertion') {
    // Newline or paste → crystallize immediately (no pending buffer)
    if ((state.config.breakOnNewline && event.text.includes('\n')) ||
        event.text.length >= state.config.pasteMinChars) {
      return {
        newState: clearedState,
        effects: [...flushEffects, {
          type: 'crystallize',
          changeType: 'insertion',
          offset: event.offset,
          length: event.text.length,
          currentText: event.text,
          originalText: '',
        }],
      };
    }

    const scId = context.allocateScId?.();
    const buf = createBuffer(event.offset, event.text, '', context.now, scId);
    return {
      newState: { ...clearedState, pending: buf },
      effects: [...flushEffects, { type: 'updatePendingOverlay', overlay: createOverlay(buf) }],
    };
  }

  if (event.type === 'deletion') {
    const scId = context.allocateScId?.();
    const buf = createBuffer(event.offset, '', event.deletedText, context.now, scId);
    return {
      newState: { ...clearedState, pending: buf },
      effects: [...flushEffects, { type: 'updatePendingOverlay', overlay: createOverlay(buf) }],
    };
  }

  if (event.type === 'substitution') {
    const scId = context.allocateScId?.();
    const buf = createBuffer(event.offset, event.newText, event.oldText, context.now, scId);
    return {
      newState: { ...clearedState, pending: buf },
      effects: [...flushEffects, { type: 'updatePendingOverlay', overlay: createOverlay(buf) }],
    };
  }

  throw new Error(`Unreachable: unhandled event type in handleBreak: ${(event as EditEvent).type}`);
}

/**
 * extend: adjacent edit grows the buffer.
 * Handles insertion (append), backward deletion (prepend original),
 * and forward deletion (append original) — unified from three old handlers.
 */
function handleExtend(
  state: EditBoundaryState,
  event: EditEvent,
  context: ProcessEventContext,
): ProcessEventResult {
  const buf = state.pending!;
  const now = context.now;
  let newBuf: PendingBuffer;

  if (event.type === 'insertion') {
    newBuf = extend(buf, event.text, now);
  } else if (event.type === 'deletion') {
    if (event.offset + event.deletedText.length === buf.anchorOffset) {
      // Backward deletion (backspace before buffer start)
      newBuf = prependOriginal(buf, event.deletedText, now);
    } else {
      // Forward deletion (delete key at buffer end)
      newBuf = appendOriginal(buf, event.deletedText, now);
    }
  } else {
    throw new Error('Unreachable: extend signal only dispatched for insertion/deletion');
  }

  return {
    newState: { ...state, pending: newBuf },
    effects: [{ type: 'updatePendingOverlay', overlay: createOverlay(newBuf) }],
  };
}

/**
 * splice: edit within buffer range (user fixing a typo in recent typing).
 * Handles insertion, deletion, and substitution within buffer.
 */
function handleSplice(
  state: EditBoundaryState,
  event: EditEvent,
  context: ProcessEventContext,
): ProcessEventResult {
  const buf = state.pending!;
  const now = context.now;

  if (event.type === 'insertion') {
    const newBuf = spliceInsert(buf, event.offset, event.text, now);
    return {
      newState: { ...state, pending: newBuf },
      effects: [{ type: 'updatePendingOverlay', overlay: createOverlay(newBuf) }],
    };
  }

  if (event.type === 'deletion') {
    const newBuf = spliceDelete(buf, event.offset, event.deletedText.length, now);
    if (newBuf === null) {
      // Self-cancellation: both texts empty → discard silently
      return {
        newState: { ...state, pending: null },
        effects: [{ type: 'updatePendingOverlay', overlay: null }],
      };
    }
    return {
      newState: { ...state, pending: newBuf },
      effects: [{ type: 'updatePendingOverlay', overlay: createOverlay(newBuf) }],
    };
  }


  if (event.type === 'substitution') {
    // Substitution within buffer: splice-delete the old text, splice-insert the new text.
    // Treat as: delete old range, insert new text at same position.
    const afterDelete = spliceDelete(buf, event.offset, event.oldText.length, now);
    if (afterDelete === null) {
      // Deletion emptied the buffer, now insert the new text
      const newBuf = createBuffer(event.offset, event.newText, '', now, buf.scId);
      return {
        newState: { ...state, pending: newBuf },
        effects: [{ type: 'updatePendingOverlay', overlay: createOverlay(newBuf) }],
      };
    }
    const newBuf = spliceInsert(afterDelete, event.offset, event.newText, now);
    return {
      newState: { ...state, pending: newBuf },
      effects: [{ type: 'updatePendingOverlay', overlay: createOverlay(newBuf) }],
    };
  }

  throw new Error(`Unreachable: unhandled event type in handleSplice: ${(event as EditEvent).type}`);
}
