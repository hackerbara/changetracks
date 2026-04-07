// packages/core/src/host/decorations/styles.ts
import type { DecorationTypeId, DecorationStyleDef } from './types.js';
import type { ViewMode } from '../types.js';
import { ChangeType } from '../../model/types.js';

export const DECORATION_STYLES: Record<DecorationTypeId, DecorationStyleDef> = {
  insertion: {
    light: { color: '#1E824C', textDecoration: 'underline dotted #1E824C40' },
    dark: { color: '#66BB6A', textDecoration: 'underline dotted #66BB6A40' },
    overviewRuler: { color: '#66BB6A80', lane: 'left' },
  },
  deletion: {
    light: { color: '#C0392B', textDecoration: 'line-through' },
    dark: { color: '#EF5350', textDecoration: 'line-through' },
    overviewRuler: { color: '#EF535080', lane: 'left' },
  },
  substitutionOriginal: {
    light: { color: '#C0392B', textDecoration: 'line-through' },
    dark: { color: '#EF5350', textDecoration: 'line-through' },
    overviewRuler: { color: '#FFB74D80', lane: 'left' },
  },
  substitutionModified: {
    light: { color: '#1E824C', textDecoration: 'none' },
    dark: { color: '#66BB6A', textDecoration: 'none' },
    overviewRuler: { color: '#FFB74D80', lane: 'left' },
  },
  highlight: {
    light: { textDecoration: 'none', backgroundColor: 'rgba(255,255,0,0.3)' },
    dark: { textDecoration: 'none', backgroundColor: 'rgba(255,255,0,0.3)' },
    overviewRuler: { color: '#FFFF0080', lane: 'left' },
  },
  comment: {
    light: { textDecoration: 'none', backgroundColor: 'rgba(173,216,230,0.2)', border: '1px solid rgba(100,149,237,0.5)' },
    dark: { textDecoration: 'none', backgroundColor: 'rgba(173,216,230,0.2)', border: '1px solid rgba(100,149,237,0.5)' },
  },
  hidden: {
    light: { textDecoration: 'none; display: none' },
    dark: { textDecoration: 'none; display: none' },
  },
  unfoldedDelimiter: {
    light: { color: 'rgba(100, 100, 100, 0.85)', fontStyle: 'italic' },
    dark: { color: 'rgba(180, 180, 180, 0.7)', fontStyle: 'italic' },
  },
  commentIcon: {
    light: {},
    dark: {},
    after: { contentText: '\ud83d\udcac', color: { light: 'rgba(100, 149, 237, 0.8)', dark: 'rgba(100, 149, 237, 0.8)' }, margin: '0 0 0 4px' },
  },
  activeHighlight: {
    light: { backgroundColor: 'rgba(100, 149, 237, 0.18)' },
    dark: { backgroundColor: 'rgba(100, 149, 237, 0.18)' },
  },
  moveFrom: {
    light: { color: '#6C3483', textDecoration: 'line-through' },
    dark: { color: '#CE93D8', textDecoration: 'line-through' },
    after: { contentText: ' \u2934', color: { light: 'rgba(108, 52, 131, 0.6)', dark: 'rgba(108, 52, 131, 0.6)' } },
    overviewRuler: { color: '#CE93D880', lane: 'left' },
  },
  moveTo: {
    light: { color: '#6C3483', textDecoration: 'underline' },
    dark: { color: '#CE93D8', textDecoration: 'underline' },
    after: { contentText: ' \u2935', color: { light: 'rgba(108, 52, 131, 0.6)', dark: 'rgba(108, 52, 131, 0.6)' } },
    overviewRuler: { color: '#CE93D880', lane: 'left' },
  },
  moveLabel: {
    light: { color: '#6C3483' },
    dark: { color: '#CE93D8' },
  },
  anchorMeta: {
    light: { color: '#888888' },
    dark: { color: '#888888' },
  },
  decidedRef: {
    light: { textDecoration: 'none', color: 'rgba(128, 128, 128, 0.6)', fontStyle: 'italic' },
    dark: { textDecoration: 'none', color: 'rgba(160, 160, 160, 0.5)', fontStyle: 'italic' },
  },
  decidedDim: {
    light: { opacity: '0.5', fontStyle: 'italic' },
    dark: { opacity: '0.5', fontStyle: 'italic' },
  },
  footnoteBlock: {
    light: { color: '#888888' },
    dark: { color: '#888888' },
  },
  ghostDeletion: {
    light: {},
    dark: {},
    before: {
      color: { light: '#C0392B', dark: '#EF5350' },
      fontStyle: 'italic',
      textDecoration: 'line-through',
    },
  },
  consumed: {
    light: { opacity: '0.45', fontStyle: 'italic' },
    dark: { opacity: '0.45', fontStyle: 'italic' },
  },
  consumingAnnotation: {
    light: {},
    dark: {},
  },
  ghostDelimiter: {
    light: { color: 'rgba(120, 120, 120, 0.6)', fontStyle: 'italic' },
    dark: { color: 'rgba(160, 160, 160, 0.5)', fontStyle: 'italic' },
  },
  ghostRef: {
    light: { color: 'rgba(100, 149, 237, 0.5)', fontStyle: 'italic' },
    dark: { color: 'rgba(100, 149, 237, 0.4)', fontStyle: 'italic' },
  },
};

export const OVERVIEW_RULER_COLORS = {
  insertion: '#66BB6A80',
  deletion: '#EF535080',
  substitution: '#FFB74D80',
  highlight: '#FFFF0080',
  comment: '#64B5F680',
} as const;

export const AUTHOR_PALETTE = [
  { light: '#1E824C', dark: '#66BB6A' },
  { light: '#6C3483', dark: '#CE93D8' },
  { light: '#E67E22', dark: '#FFB74D' },
  { light: '#16A085', dark: '#4DB6AC' },
  { light: '#2980B9', dark: '#64B5F6' },
] as const;

export type VisibilityRule = 'visible' | 'hidden' | 'dimmed' | 'plain';

// Omission means 'visible' (the default). Only overrides are listed.
export const VIEW_MODE_VISIBILITY: Record<ViewMode, Partial<Record<DecorationTypeId, VisibilityRule>>> = {
  review: {},
  changes: {
    deletion: 'hidden',
    substitutionOriginal: 'hidden',
    moveFrom: 'hidden',
    moveLabel: 'hidden',
    comment: 'hidden',
    highlight: 'plain',
    hidden: 'hidden',
    unfoldedDelimiter: 'hidden',
    anchorMeta: 'hidden',
    decidedRef: 'hidden',
    footnoteBlock: 'hidden',
    consumingAnnotation: 'hidden',
    ghostDelimiter: 'hidden',
    ghostRef: 'hidden',
  },
  settled: {},
  raw: {},
};

/**
 * Whether a change of the given type has visible content in the given view mode.
 *
 * This is content visibility (is the change's text present in the rendered view?),
 * not decoration visibility (which CSS styles are applied?). The logic mirrors
 * the plan builder's settled/raw mode routing.
 *
 * - Settled: deletions removed, comments removed, everything else visible
 * - Raw: insertions removed, comments removed, everything else visible
 * - Review/changes: all types visible
 */
export function isTypeVisibleInMode(type: ChangeType, mode: ViewMode): boolean {
  switch (mode) {
    case 'settled':
      return type !== ChangeType.Deletion && type !== ChangeType.Comment;
    case 'raw':
      return type !== ChangeType.Insertion && type !== ChangeType.Comment;
    case 'review':
    case 'changes':
      return true;
  }
}

export interface DecorationThemeOverride {
  styles?: Partial<Record<DecorationTypeId, Partial<DecorationStyleDef>>>;
  visibility?: Partial<Record<ViewMode, Partial<Record<DecorationTypeId, VisibilityRule>>>>;
  authorPalette?: Array<{ light: string; dark: string }>;
}
