// packages/core/src/host/decorations/plan-builder.ts
/**
 * Platform-agnostic decoration plan builder.
 *
 * Moved from packages/preview/src/decoration-logic.ts.
 * Pure function: no side effects, no VS Code API, no DOM.
 * Consumers convert the returned offset-based plan into their platform's
 * decoration API (VS Code DecorationOptions, Monaco deltaDecorations, etc.).
 */

import type { ChangeNode } from '../../model/types.js';
import { ChangeStatus, ChangeType, isGhostNode } from '../../model/types.js';
import { findFootnoteBlockStart } from '../../footnote-utils.js';
import type { View } from '../types.js';
import type { DecorationPlan, OffsetDecoration, AuthorDecorationRole } from './types.js';
import {
  computeLineStarts, offsetToLine, isOffsetInRange,
  hideDelimiters, revealDelimiters, createEmptyPlan, getCharLevelRanges,
  hideOrGhostDelimiters, injectGhostDelimiters,
} from './helpers.js';

/**
 * Build a platform-agnostic decoration plan from parsed CriticMarkup changes.
 *
 * This is a pure function: no side effects, no VS Code API, no DOM.
 * Consumers convert the returned offset-based plan into their platform's
 * decoration API (VS Code DecorationOptions, Monaco deltaDecorations, etc.).
 */
export function buildDecorationPlan(
  changes: ChangeNode[],
  text: string,
  view: View,
  format: 'L2' | 'L3',
  cursorOffset: number,
): DecorationPlan {
  const isL3 = format === 'L3';
  const plan = createEmptyPlan();
  const lineStarts = computeLineStarts(text);

  const d = view.display;
  const isDecidedProjection = view.projection === 'decided';
  const isOriginalProjection = view.projection === 'original';
  const isCurrentProjection = view.projection === 'current' || view.projection === 'none';

  // Display option reads with defaults
  const showDelimiters = (d.delimiters ?? 'show') === 'show';
  const hideDeletions = (d.deletions ?? 'inline') === 'hide';
  const hideComments = (d.comments ?? 'inline-marker') === 'hide';
  const hideHighlights = (d.highlights ?? 'inline') === 'hide';
  const hideFootnoteRefs = (d.footnoteRefs ?? 'show') === 'hide';
  const hideFootnotes = (d.footnotes ?? 'show') === 'hide';
  const cursorReveal = d.cursorReveal === true;
  const authorColorMode = d.authorColors ?? 'auto';

  // Derived flags
  // isFullInlineMode: true when all change types are shown inline (no hidden deletions, highlights,
  // or comments). In this mode delimiters are always visible in markup — no cursor-gated reveal.
  const isFullInlineMode = !hideDeletions && !hideHighlights && !hideComments;
  const showDelimitersInMarkup = showDelimiters && !isL3 && isFullInlineMode;
  // cursorRevealMode: active when either cursorReveal is explicitly set, or when showDelimiters is
  // requested in a non-full-inline mode (old "changes + showDelimiters=true" behavior).
  const cursorRevealMode = (cursorReveal || showDelimiters) && isCurrentProjection && !isFullInlineMode;
  const showGhostDelimiters = isL3 && showDelimiters && isCurrentProjection;
  const showGhostRefs = isL3 && !hideFootnoteRefs && isCurrentProjection;

  // Determine if per-author coloring is active
  let useAuthorColors = authorColorMode === 'always';
  if (authorColorMode === 'auto') {
    const authors = new Set<string>();
    for (const c of changes) {
      if (c.metadata?.author) authors.add(c.metadata.author);
      if (c.inlineMetadata?.author) authors.add(c.inlineMetadata.author);
      if (authors.size >= 2) break;
    }
    useAuthorColors = authors.size >= 2;
  }

  // Per-author decoration grouping: key = "author:role"
  const addAuthorDecoration = (author: string, role: AuthorDecorationRole, decoration: OffsetDecoration) => {
    const key = `${author}:${role}`;
    if (!plan.authorDecorations.has(key)) {
      plan.authorDecorations.set(key, { role, ranges: [] });
    }
    plan.authorDecorations.get(key)!.ranges.push(decoration);
  };

  // Pre-build consumed-by lookup for O(1) predecessor queries
  const consumedByMap = new Map<string, ChangeNode[]>();
  for (const c of changes) {
    if (c.consumedBy) {
      const list = consumedByMap.get(c.consumedBy) ?? [];
      list.push(c);
      consumedByMap.set(c.consumedBy, list);
    }
  }

  const cursorLine = cursorOffset > text.length
    ? lineStarts.length  // past-end cursor is never on any change's line
    : offsetToLine(lineStarts, cursorOffset);

  changes.forEach(change => {
    // Skip unresolved L3 nodes (anchored === false on level >= 2)
    if (isGhostNode(change)) return;

    // Consumed ops: dimmed + italic "consumed by" label
    if (change.consumedBy) {
      plan.consumedRanges.push({
        range: change.range,
        renderAfter: {
          contentText: ` consumed by ${change.consumedBy}`,
          fontStyle: 'italic',
        }
      });
      return;
    }

    const fullRange = change.range;
    const contentRange = change.contentRange;
    const isCursorInChange = isOffsetInRange(cursorOffset, contentRange);
    const changeStartLine = offsetToLine(lineStarts, fullRange.start);
    const changeEndLine = offsetToLine(lineStarts, fullRange.end);
    const isCursorOnChangeLine = changeStartLine <= cursorLine && cursorLine <= changeEndLine;
    const author = change.metadata?.author ?? change.inlineMetadata?.author;

    // Active highlight: cursor inside a change in review/changes mode
    if (isCursorInChange && isCurrentProjection) {
      if (change.type === ChangeType.Substitution && change.originalRange && change.modifiedRange) {
        plan.activeHighlights.push({ range: change.originalRange });
        plan.activeHighlights.push({ range: change.modifiedRange });
      } else {
        plan.activeHighlights.push({ range: fullRange });
      }
    }

    // Push helpers: route to default array or author-specific group
    const pushInsertion = (d: OffsetDecoration) => {
      if (author && useAuthorColors) addAuthorDecoration(author, 'insertion', d);
      else plan.insertions.push(d);
    };
    const pushDeletion = (d: OffsetDecoration) => {
      if (author && useAuthorColors) addAuthorDecoration(author, 'deletion', d);
      else plan.deletions.push(d);
    };
    const pushSubOriginal = (d: OffsetDecoration) => {
      if (author && useAuthorColors) addAuthorDecoration(author, 'substitution-original', d);
      else plan.substitutionOriginals.push(d);
    };
    const pushSubModified = (d: OffsetDecoration) => {
      if (author && useAuthorColors) addAuthorDecoration(author, 'substitution-modified', d);
      else plan.substitutionModifieds.push(d);
    };
    const pushHighlight = (d: OffsetDecoration) => { plan.highlights.push(d); };
    const pushComment = (d: OffsetDecoration) => { plan.comments.push(d); };
    const pushMoveFrom = (d: OffsetDecoration) => {
      if (author && useAuthorColors) addAuthorDecoration(author, 'move-from', d);
      else plan.moveFroms.push(d);
    };
    const pushMoveTo = (d: OffsetDecoration) => {
      if (author && useAuthorColors) addAuthorDecoration(author, 'move-to', d);
      else plan.moveTos.push(d);
    };

    // ─── Final / Original mode ───────────────────────────────────────
    if (isDecidedProjection || isOriginalProjection) {
      const effectiveType = change.moveRole === 'from' ? ChangeType.Deletion
        : change.moveRole === 'to' ? ChangeType.Insertion
        : change.type;

      if (effectiveType === ChangeType.Insertion) {
        if (isDecidedProjection) {
          hideDelimiters(fullRange, contentRange, plan.hiddens);
        } else {
          plan.hiddens.push({ range: fullRange });
        }
      } else if (effectiveType === ChangeType.Deletion) {
        if (change.range.start === change.range.end) {
          // L3 zero-width deletion
          if (isOriginalProjection) {
            const deletedText = change.originalText ?? '';
            if (deletedText) {
              plan.ghostDeletions.push({
                range: fullRange,
                renderBefore: { contentText: deletedText }
              });
            }
          }
        } else if (isDecidedProjection) {
          plan.hiddens.push({ range: fullRange });
        } else {
          hideDelimiters(fullRange, contentRange, plan.hiddens);
        }
      } else if (effectiveType === ChangeType.Substitution) {
        if (change.originalRange && change.modifiedRange) {
          const openDelimiterEnd = change.range.start + 3;
          const separatorStart = change.originalRange.end;
          const separatorEnd = change.modifiedRange.start;
          const closeDelimiterStart = change.modifiedRange.end;

          if (isDecidedProjection) {
            plan.hiddens.push({ range: { start: fullRange.start, end: openDelimiterEnd } });
            plan.hiddens.push({ range: { start: change.originalRange.start, end: separatorEnd } });
            plan.hiddens.push({ range: { start: closeDelimiterStart, end: fullRange.end } });
          } else {
            plan.hiddens.push({ range: { start: fullRange.start, end: openDelimiterEnd } });
            plan.hiddens.push({ range: { start: separatorStart, end: fullRange.end } });
          }
        }
      } else if (effectiveType === ChangeType.Highlight) {
        if (change.metadata?.comment) {
          if (fullRange.start < contentRange.start) {
            plan.hiddens.push({ range: { start: fullRange.start, end: contentRange.start } });
          }
          const highlightCloseEnd = contentRange.end + 3;
          plan.hiddens.push({ range: { start: contentRange.end, end: highlightCloseEnd } });
          plan.hiddens.push({ range: { start: highlightCloseEnd, end: fullRange.end } });
        } else {
          hideDelimiters(fullRange, contentRange, plan.hiddens);
        }
      } else if (effectiveType === ChangeType.Comment) {
        plan.hiddens.push({ range: fullRange });
      }
      return;
    }

    // ─── Settled refs ────────────────────────────────────────────────
    if (change.decided) {
      if (!showDelimiters) {
        plan.hiddens.push({ range: fullRange });
        return;
      }
      plan.decidedRefs.push({ range: contentRange });
      if (change.status === ChangeStatus.Accepted || change.status === ChangeStatus.Rejected) {
        plan.decidedDims.push({ range: contentRange });
      }
      return;
    }

    // ─── Review / Changes mode ──────────────────────────────────────

    // Move-first check
    if (change.moveRole === 'from') {
      if (showDelimitersInMarkup) {
        pushMoveFrom({ range: fullRange });
      } else if (isFullInlineMode) {
        // Full inline mode, delimiters hidden: still decorate content
        hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{--', '--}');
        pushMoveFrom({ range: contentRange });
      } else if (isCursorOnChangeLine) {
        if (cursorRevealMode && isCursorInChange) {
          revealDelimiters(fullRange, contentRange, plan.unfoldedDelimiters);
        } else {
          hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{--', '--}');
        }
        pushMoveFrom({ range: contentRange });
      } else {
        // Settled-base: entire move-from is hidden (moved text invisible when cursor away)
        plan.hiddens.push({ range: fullRange });
      }
    } else if (change.moveRole === 'to') {
      if (showDelimitersInMarkup) {
        pushMoveTo({ range: fullRange });
      } else if (isFullInlineMode) {
        // Full inline mode, delimiters hidden: still decorate content
        hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{++', '++}');
        pushMoveTo({ range: contentRange });
      } else if (isCursorOnChangeLine) {
        if (cursorRevealMode && isCursorInChange) {
          revealDelimiters(fullRange, contentRange, plan.unfoldedDelimiters);
        } else {
          hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{++', '++}');
        }
        pushMoveTo({ range: contentRange });
      } else {
        // Settled-base: delimiters hidden, move-to content plain (no decoration)
        hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{++', '++}');
      }
    } else if (change.type === ChangeType.Insertion) {
      const reasonHover = change.metadata?.comment
        ? `**Reason:** ${change.metadata.comment}`
        : undefined;
      if (showDelimitersInMarkup) {
        pushInsertion({ range: fullRange, hoverText: reasonHover });
      } else if (isFullInlineMode) {
        // Full inline mode, delimiters hidden: still decorate content
        hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{++', '++}');
        pushInsertion({ range: contentRange, hoverText: reasonHover });
      } else if (isCursorOnChangeLine) {
        if (cursorRevealMode && isCursorInChange) {
          revealDelimiters(fullRange, contentRange, plan.unfoldedDelimiters);
        } else {
          hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{++', '++}');
        }
        pushInsertion({ range: contentRange, hoverText: reasonHover });
      } else {
        // Settled-base: delimiters hidden, insertion content plain (no decoration)
        hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{++', '++}');
      }
    } else if (change.type === ChangeType.Deletion) {
      const reasonHover = change.metadata?.comment
        ? `**Reason:** ${change.metadata.comment}`
        : undefined;

      if (change.range.start === change.range.end) {
        // L3 zero-width deletion: ghost text
        const deletedText = change.originalText ?? '';
        if (deletedText && !isDecidedProjection) {
          if (!hideDeletions || isCursorOnChangeLine) {
            plan.ghostDeletions.push({
              range: fullRange,
              renderBefore: { contentText: deletedText },
              hoverText: reasonHover,
            });
          }
        }
      } else {
        // L2 deletion with content
        if (showDelimitersInMarkup) {
          pushDeletion({ range: fullRange, hoverText: reasonHover });
        } else if (hideDeletions && !isCursorOnChangeLine) {
          plan.hiddens.push({ range: fullRange });
        } else if (isCursorOnChangeLine) {
          if (cursorRevealMode && isCursorInChange) {
            revealDelimiters(fullRange, contentRange, plan.unfoldedDelimiters);
          } else {
            hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{--', '--}');
          }
          pushDeletion({ range: contentRange, hoverText: reasonHover });
        } else {
          hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{--', '--}');
          pushDeletion({ range: contentRange, hoverText: reasonHover });
        }
      }
    } else if (change.type === ChangeType.Substitution) {
      const reasonHover = change.metadata?.comment
        ? `**Reason:** ${change.metadata.comment}`
        : undefined;

      if (change.originalRange && change.modifiedRange) {
        // CriticMarkup substitution with delimiter ranges
        const openDelimiterEnd = change.range.start + 3;
        const separatorStart = change.originalRange.end;
        const separatorEnd = change.modifiedRange.start;
        const closeDelimiterStart = change.modifiedRange.end;

        if (showDelimitersInMarkup) {
          pushSubOriginal({ range: { start: fullRange.start, end: change.modifiedRange.start }, hoverText: reasonHover });
          pushSubModified({ range: { start: change.modifiedRange.start, end: fullRange.end }, hoverText: reasonHover });
        } else if (isFullInlineMode) {
          // Full inline mode, delimiters hidden: still decorate both original and modified content
          if (isL3 && showGhostDelimiters) {
            injectGhostDelimiters(fullRange, contentRange, plan.ghostDelimiters, '{~~', '~~}');
          } else if (!isL3) {
            plan.hiddens.push({ range: { start: fullRange.start, end: openDelimiterEnd } });
            plan.hiddens.push({ range: { start: separatorStart, end: separatorEnd } });
            plan.hiddens.push({ range: { start: closeDelimiterStart, end: fullRange.end } });
          }
          pushSubOriginal({ range: change.originalRange, hoverText: reasonHover });
          pushSubModified({ range: change.modifiedRange, hoverText: reasonHover });
        } else if (isCursorOnChangeLine) {
          if (cursorRevealMode && isCursorInChange) {
            plan.unfoldedDelimiters.push({ range: { start: fullRange.start, end: openDelimiterEnd } });
            plan.unfoldedDelimiters.push({ range: { start: separatorStart, end: separatorEnd } });
            plan.unfoldedDelimiters.push({ range: { start: closeDelimiterStart, end: fullRange.end } });
          } else if (isL3 && showGhostDelimiters) {
            injectGhostDelimiters(fullRange, contentRange, plan.ghostDelimiters, '{~~', '~~}');
          } else if (!isL3) {
            plan.hiddens.push({ range: { start: fullRange.start, end: openDelimiterEnd } });
            plan.hiddens.push({ range: { start: separatorStart, end: separatorEnd } });
            plan.hiddens.push({ range: { start: closeDelimiterStart, end: fullRange.end } });
          }
          pushSubOriginal({ range: change.originalRange, hoverText: reasonHover });
          pushSubModified({ range: change.modifiedRange, hoverText: reasonHover });
        } else {
          // Settled-base: show only new text, hide original + all delimiters, no decoration
          if (isL3 && showGhostDelimiters) {
            injectGhostDelimiters(fullRange, contentRange, plan.ghostDelimiters, '{~~', '~~}');
          } else if (!isL3) {
            plan.hiddens.push({ range: { start: fullRange.start, end: separatorEnd } });
            plan.hiddens.push({ range: { start: closeDelimiterStart, end: fullRange.end } });
          }
        }
      } else if (change.originalText || change.modifiedText) {
        // Sidecar substitution (L3)
        const charRanges = getCharLevelRanges(change);

        if (!hideDeletions || isCursorOnChangeLine) {
          if (charRanges.length > 0) {
            for (const r of charRanges) {
              pushSubModified({ range: r, hoverText: reasonHover });
            }
          } else {
            if (change.modifiedText) pushSubModified({ range: contentRange, hoverText: reasonHover });
            if (change.originalText) pushSubOriginal({ range: contentRange, hoverText: reasonHover });
          }
        }
        // else: settled-base, no styling
      }
    } else if (change.type === ChangeType.Highlight) {
      const hoverText = change.metadata?.comment
        ? `**Comment:** ${change.metadata.comment}`
        : undefined;

      if (showDelimitersInMarkup) {
        pushHighlight({ range: fullRange, hoverText });
      } else if (hideHighlights && !isCursorOnChangeLine) {
        plan.hiddens.push({ range: fullRange });
      } else if (isCursorOnChangeLine) {
        if (cursorRevealMode && isCursorInChange) {
          revealDelimiters(fullRange, contentRange, plan.unfoldedDelimiters);
        } else {
          hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{==', '==}');
        }
        pushHighlight({ range: contentRange, hoverText });
      } else {
        // Default: highlight stays visible, hide delimiters
        if (change.metadata?.comment) {
          if (fullRange.start < contentRange.start) {
            plan.hiddens.push({ range: { start: fullRange.start, end: contentRange.start } });
          }
          const highlightCloseEnd = contentRange.end + 3;
          plan.hiddens.push({ range: { start: contentRange.end, end: highlightCloseEnd } });
          plan.hiddens.push({ range: { start: highlightCloseEnd, end: fullRange.end } });
          plan.commentIcons.push({
            range: { start: contentRange.end, end: contentRange.end },
            hoverText,
          });
          pushHighlight({ range: contentRange, hoverText });
        } else {
          hideOrGhostDelimiters(fullRange, contentRange, plan, isL3, showGhostDelimiters, '{==', '==}');
          pushHighlight({ range: contentRange, hoverText });
        }
      }
    } else if (change.type === ChangeType.Comment) {
      const hoverText = change.metadata?.comment
        ? `**Comment:** ${change.metadata.comment}`
        : undefined;

      if (showDelimitersInMarkup) {
        pushComment({ range: fullRange, hoverText });
      } else if (hideComments && !isCursorOnChangeLine) {
        plan.hiddens.push({ range: fullRange });
        plan.commentIcons.push({
          range: { start: fullRange.start, end: fullRange.start },
          hoverText,
        });
      } else if (isCursorOnChangeLine) {
        if (cursorRevealMode && isCursorInChange) {
          revealDelimiters(fullRange, contentRange, plan.unfoldedDelimiters);
          pushComment({ range: contentRange, hoverText });
        } else {
          plan.hiddens.push({ range: fullRange });
          plan.commentIcons.push({
            range: { start: fullRange.start, end: fullRange.start },
            hoverText,
          });
        }
      } else {
        plan.hiddens.push({ range: fullRange });
        plan.commentIcons.push({
          range: { start: fullRange.start, end: fullRange.start },
          hoverText,
        });
      }
    }

    // Consuming op annotations
    const consumedPreds = consumedByMap.get(change.id) ?? [];
    if (consumedPreds.length > 0) {
      const ids = consumedPreds.map(c => c.id).join(', ');
      plan.consumingOpAnnotations.push({
        range: { start: fullRange.end, end: fullRange.end },
        renderAfter: {
          contentText: ` (consumed ${ids})`,
          fontStyle: 'italic',
        }
      });
    }

    // Ghost refs: inject footnote ref as ghost text for L3 documents
    if (showGhostRefs && change.id) {
      plan.ghostRefs.push({
        range: { start: contentRange.end, end: contentRange.end },
        renderAfter: { contentText: `[^${change.id}]`, fontStyle: 'italic' },
      });
    }
  });

  // ─── L3 footnote edit-op dimming ─────────────────────────────────
  const hasL3Changes = changes.some(c => c.level >= 2);
  if (isCurrentProjection && hasL3Changes && !hideFootnotes) {
    const lines = text.split('\n');
    const blockStart = findFootnoteBlockStart(lines);
    if (blockStart < lines.length) {
      const lastLine = lines.length - 1;
      const dimStart = lineStarts[blockStart];
      const dimEnd = lineStarts[lastLine] + lines[lastLine].length;
      plan.decidedDims.push({ range: { start: dimStart, end: dimEnd } });
    }
  }

  // ─── Footnote ref splitting (post-processing) ────────────────────
  if (!hideFootnoteRefs && text) {
    const searchArrays: OffsetDecoration[][] = [
      plan.insertions, plan.deletions, plan.substitutionOriginals,
      plan.substitutionModifieds, plan.highlights, plan.comments,
      plan.moveFroms, plan.moveTos,
    ];
    for (const [, entry] of plan.authorDecorations) {
      searchArrays.push(entry.ranges);
    }

    for (const change of changes) {
      if (!change.footnoteRefStart || change.decided) continue;
      const refStart = change.footnoteRefStart;
      const refEnd = change.range.end;

      for (const arr of searchArrays) {
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i];
          if (entry.range.end === refEnd && entry.range.start < refStart) {
            arr[i] = { ...entry, range: { start: entry.range.start, end: refStart } };
            plan.decidedRefs.push({ range: { start: refStart, end: refEnd } });
            break;
          }
        }
      }
    }
  }

  // ─── Compute hiddenOffsets from plan.hiddens ─────────────────────
  plan.hiddenOffsets = plan.hiddens.map(h => ({ start: h.range.start, end: h.range.end }));

  return plan;
}
