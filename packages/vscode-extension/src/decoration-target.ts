// packages/vscode-extension/src/decoration-target.ts
//
// VS Code platform adapter for the shared decoration pipeline.
// Wraps vscode.TextEditorDecorationType objects and translates offset-based
// decorations from applyPlan() into VS Code API calls.
//
// Key behaviors preserved from the original EditorDecorator:
//   - CSS injection for specificity over semantic tokens (D7)
//   - hiddenObj dispose/recreate lifecycle on empty-range transition
//   - Dynamic per-author types created on first encounter and cached
//   - Overview ruler calls are buffered and flushed in endPass() AFTER the 19
//     fixed types so SpyEditor indices 0-18 remain stable

import * as vscode from 'vscode';
import {
    DECORATION_STYLES,
    AuthorColorMap,
    type DecorationTarget,
    type DecorationStyleDef,
    type OffsetDecoration,
    type OffsetRange,
    type AuthorDecorationRole,
} from '@changedown/core/dist/host/index';
import type { EditorPort } from './view/EditorPort';
import { offsetToPosition } from './converters';

// ─── Type map keys ────────────────────────────────────────────────────────────

/** The 19 canonical fixed type IDs, in SpyEditor index order (0-18). */
const FIXED_TYPE_IDS = [
    'insertion',
    'deletion',
    'substitutionOriginal',
    'substitutionModified',
    'highlight',
    'comment',
    'hidden',
    'unfoldedDelimiter',
    'commentIcon',
    'activeHighlight',
    'moveFrom',
    'moveTo',
    'settledRef',
    'settledDim',
    'ghostDeletion',
    'consumed',
    'consumingAnnotation',
    'ghostDelimiter',
    'ghostRef',
] as const;

type FixedTypeId = typeof FIXED_TYPE_IDS[number];

// ─── Helper: build vscode.DecorationRenderOptions from a DecorationStyleDef ─

/**
 * Build VS Code decoration render options from a platform-agnostic style def.
 *
 * CSS injection technique (D7): VS Code's semantic tokens override regular
 * decoration colors. The workaround is embedding color/background-color INTO
 * the textDecoration CSS property string so the browser-layer specificity wins.
 *
 * For a style like { textDecoration: 'underline dotted #1E824C40', color: '#1E824C' }
 * we produce: textDecoration = 'underline dotted #1E824C40; color: #1E824C'
 */
function buildThemeStyle(
    styleDef: Pick<DecorationStyleDef['light'], 'color' | 'textDecoration' | 'backgroundColor' | 'opacity' | 'fontStyle' | 'border'>,
): vscode.ThemableDecorationRenderOptions {
    const opts: vscode.ThemableDecorationRenderOptions = {};

    // Build combined textDecoration string using CSS injection
    let tdParts: string[] = [];

    if (styleDef.textDecoration) {
        tdParts.push(styleDef.textDecoration);
    }
    if (styleDef.color) {
        tdParts.push(`color: ${styleDef.color}`);
    }
    if (styleDef.backgroundColor) {
        tdParts.push(`background-color: ${styleDef.backgroundColor}`);
    }

    if (tdParts.length > 0) {
        opts.textDecoration = tdParts.join('; ');
    }

    // These CSS properties can't be injected via textDecoration — apply normally
    if (styleDef.opacity) {
        opts.opacity = styleDef.opacity;
    }
    if (styleDef.fontStyle) {
        opts.fontStyle = styleDef.fontStyle;
    }
    if (styleDef.border) {
        opts.border = styleDef.border;
    }

    return opts;
}

/**
 * Build full vscode.DecorationRenderOptions from a DecorationStyleDef and
 * create a TextEditorDecorationType via vscode.window.
 */
function createType(
    styleDef: DecorationStyleDef,
): vscode.TextEditorDecorationType {
    const opts: vscode.DecorationRenderOptions = {};

    const lightOpts = buildThemeStyle(styleDef.light);
    const darkOpts = buildThemeStyle(styleDef.dark);

    // Only add light/dark if there's something there
    if (Object.keys(lightOpts).length > 0) {
        opts.light = lightOpts;
    }
    if (Object.keys(darkOpts).length > 0) {
        opts.dark = darkOpts;
    }

    if (styleDef.before) {
        const before: vscode.ThemableDecorationAttachmentRenderOptions = {};
        if (styleDef.before.fontStyle) { before.fontStyle = styleDef.before.fontStyle; }
        if (styleDef.before.textDecoration) { before.textDecoration = styleDef.before.textDecoration; }
        if (styleDef.before.color) {
            opts.light = { ...opts.light, before: { ...before, color: styleDef.before.color.light } };
            opts.dark = { ...opts.dark, before: { ...before, color: styleDef.before.color.dark } };
        } else {
            opts.light = { ...opts.light, before };
            opts.dark = { ...opts.dark, before };
        }
    }

    if (styleDef.after) {
        const afterBase: vscode.ThemableDecorationAttachmentRenderOptions = {};
        if (styleDef.after.contentText) { afterBase.contentText = styleDef.after.contentText; }
        if (styleDef.after.fontStyle) { afterBase.fontStyle = styleDef.after.fontStyle; }
        if (styleDef.after.margin) { afterBase.margin = styleDef.after.margin; }
        if (styleDef.after.color) {
            opts.light = { ...opts.light, after: { ...afterBase, color: styleDef.after.color.light } };
            opts.dark = { ...opts.dark, after: { ...afterBase, color: styleDef.after.color.dark } };
        } else {
            opts.light = { ...opts.light, after: afterBase };
            opts.dark = { ...opts.dark, after: afterBase };
        }
    }

    if (styleDef.overviewRuler) {
        opts.overviewRulerColor = styleDef.overviewRuler.color;
        opts.overviewRulerLane = styleDef.overviewRuler.lane === 'left'
            ? vscode.OverviewRulerLane.Left
            : vscode.OverviewRulerLane.Right;
    }

    return vscode.window.createTextEditorDecorationType(opts);
}

// ─── Helper: convert OffsetDecoration to vscode.DecorationOptions ─────────

function offsetToDecoration(d: OffsetDecoration, text: string): vscode.DecorationOptions {
    const range = new vscode.Range(
        offsetToPosition(text, d.range.start),
        offsetToPosition(text, d.range.end),
    );
    const result: vscode.DecorationOptions = { range };
    if (d.hoverText) {
        result.hoverMessage = new vscode.MarkdownString(d.hoverText);
    }
    if (d.renderBefore) {
        result.renderOptions = { before: { contentText: d.renderBefore.contentText } };
    }
    if (d.renderAfter) {
        result.renderOptions = {
            ...(result.renderOptions ?? {}),
            after: {
                contentText: d.renderAfter.contentText,
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: d.renderAfter.fontStyle,
            }
        };
    }
    return result;
}

// ─── VSCodeDecorationTarget ───────────────────────────────────────────────────

/**
 * VS Code implementation of DecorationTarget.
 *
 * Manages a set of vscode.TextEditorDecorationType objects and applies
 * offset-based decoration plans from applyPlan() to the active editor.
 *
 * The class is bound to an editor via setEditor() and can be rebound when
 * VS Code switches the visible editor for the same document.
 */
export class VSCodeDecorationTarget implements DecorationTarget {
    private editor: EditorPort;

    // Fixed decoration types in canonical order (indices 0-18 for SpyEditor)
    private fixedTypes: Map<FixedTypeId, vscode.TextEditorDecorationType> = new Map();

    // The hidden type is special: it needs dispose/recreate lifecycle
    private hiddenType: vscode.TextEditorDecorationType;
    private hadHiddenRanges = false;

    // Per-author dynamic types, cached by "author:role:style"
    private authorColorMap: AuthorColorMap = new AuthorColorMap();
    private authorTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

    // Overview ruler types (right lane, ThemeColor)
    private rulerInsertionType: vscode.TextEditorDecorationType;
    private rulerDeletionType: vscode.TextEditorDecorationType;
    private rulerSubstitutionType: vscode.TextEditorDecorationType;
    private rulerHighlightType: vscode.TextEditorDecorationType;
    private rulerCommentType: vscode.TextEditorDecorationType;

    // Buffered ruler data — accumulated during setOverviewRuler(), flushed in endPass()
    private rulerBuffer: Map<string, vscode.DecorationOptions[]> = new Map();

    // Author cache keys active in the current pass — used to clear unused types in endPass()
    private activeAuthorKeys: Set<string> = new Set();

    // Hidden offsets from the most recent pass — exposed for cursor snapping
    private lastHiddenOffsets: Array<{ start: number; end: number }> = [];

    // The style mode ('foreground' | 'background') and author color preference
    // are not needed in the new target — the shared pipeline has already baked
    // them into the plan. We keep the style parameter only for author type creation.
    private readonly style: 'foreground' | 'background';

    constructor(
        editor: EditorPort,
        style: 'foreground' | 'background' = 'foreground',
    ) {
        this.editor = editor;
        this.style = style;

        // Create fixed types from DECORATION_STYLES — all except 'hidden' which
        // has its own lifecycle field
        for (const id of FIXED_TYPE_IDS) {
            if (id === 'hidden') { continue; } // created separately below
            const styleDef = DECORATION_STYLES[id as keyof typeof DECORATION_STYLES];
            if (styleDef) {
                this.fixedTypes.set(id, createType(styleDef));
            }
        }

        // Create the hidden type separately so we can track its lifecycle
        this.hiddenType = this.createHiddenType();

        // Overview ruler types: no inline styling, pure ruler marks using ThemeColor
        this.rulerInsertionType = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: new vscode.ThemeColor('changedown.insertionRulerColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
        this.rulerDeletionType = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: new vscode.ThemeColor('changedown.deletionRulerColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
        this.rulerSubstitutionType = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: new vscode.ThemeColor('changedown.substitutionRulerColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
        this.rulerHighlightType = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: new vscode.ThemeColor('changedown.highlightRulerColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
        this.rulerCommentType = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: new vscode.ThemeColor('changedown.commentRulerColor'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }

    private createHiddenType(): vscode.TextEditorDecorationType {
        // CSS injection: 'none; display: none' hides the decorated ranges.
        // Must use textDecoration for the CSS injection to work (same as original).
        return vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; display: none;',
        });
    }

    /**
     * Rebind to a different editor instance (e.g. when VS Code makes a new TextEditor
     * for the same document after a panel switch).
     */
    public setEditor(editor: EditorPort): void {
        this.editor = editor;
    }

    /** Returns the hidden offset ranges from the most recent pass (for cursor snapping). */
    public getHiddenOffsets(): ReadonlyArray<{ start: number; end: number }> {
        return this.lastHiddenOffsets;
    }

    /**
     * Force dispose and recreate the hidden decoration type.
     *
     * VS Code's renderer caches CSS `display: none` across setDecorations calls.
     * The existing dispose/recreate in setDecorations('hidden', ...) only fires on
     * had-ranges→zero-ranges transitions. But when view mode switches, hidden ranges
     * shift (e.g. delimiter-only → full-deletion) and the cached CSS from old ranges
     * can persist, causing stale visual state. Calling this before re-decorating
     * after a mode switch flushes the CSS cache.
     */
    public forceHiddenRecreate(): void {
        this.hiddenType.dispose();
        this.hiddenType = this.createHiddenType();
        this.hadHiddenRanges = false;
    }

    // ─── DecorationTarget interface ──────────────────────────────────────────

    /** Reset per-pass state: ruler buffer and active author key tracking. */
    beginPass(): void {
        this.rulerBuffer.clear();
        this.activeAuthorKeys.clear();
    }

    /**
     * Apply a set of offset-based decorations for the given type ID.
     *
     * For 'hidden': implements the dispose/recreate lifecycle to flush VS Code's
     * CSS renderer cache when transitioning from >0 ranges to 0 ranges.
     *
     * For 'author:*': creates dynamic types on first encounter, cached by key.
     */
    setDecorations(typeId: string, decorations: OffsetDecoration[], text: string): void {
        const options = decorations.map(d => offsetToDecoration(d, text));

        if (typeId === 'hidden') {
            // Track hidden offset ranges for getHiddenOffsets()
            this.lastHiddenOffsets = decorations.map(d => d.range);

            // Lifecycle: dispose/recreate when transitioning from had-ranges to no-ranges.
            // Guard: only do this when the document has changes (i.e. this is a main editor,
            // not a comment thread editor which has 0 changes AND 0 hiddens). We approximate
            // this via hadHiddenRanges: if we had hidden ranges before, there must have been
            // changes at some point, so it's safe to dispose.
            if (decorations.length === 0 && this.hadHiddenRanges) {
                this.hiddenType.dispose();
                this.hiddenType = this.createHiddenType();
                this.hadHiddenRanges = false;
            }

            this.editor.setDecorations(this.hiddenType, options);

            if (decorations.length > 0) {
                this.hadHiddenRanges = true;
            }
            return;
        }

        if (typeId.startsWith('author:')) {
            // Format: "author:<author>:<role>"
            const withoutPrefix = typeId.slice('author:'.length);
            const colonIdx = withoutPrefix.indexOf(':');
            const author = withoutPrefix.substring(0, colonIdx);
            const role = withoutPrefix.substring(colonIdx + 1) as AuthorDecorationRole;
            const cacheKey = `${author}:${role}:${this.style}`;
            this.activeAuthorKeys.add(cacheKey);
            const type = this.getAuthorType(author, role);
            this.editor.setDecorations(type, options);
            return;
        }

        const fixedId = typeId as FixedTypeId;
        const type = this.fixedTypes.get(fixedId);
        if (type) {
            this.editor.setDecorations(type, options);
        }
    }

    /**
     * Buffer overview ruler ranges for this type ID.
     * The actual setDecorations calls happen in endPass() AFTER the 19 fixed types,
     * preserving SpyEditor indices 0-18.
     */
    setOverviewRuler(typeId: string, ranges: OffsetRange[], text: string): void {
        const options: vscode.DecorationOptions[] = ranges.map(r => ({
            range: new vscode.Range(
                offsetToPosition(text, r.start),
                offsetToPosition(text, r.end),
            ),
        }));
        this.rulerBuffer.set(typeId, options);
    }

    /**
     * Flush buffered ruler marks. Called after all setDecorations() calls so
     * SpyEditor indices 0-18 remain stable.
     *
     * Also clears any per-author types that were not used in the current pass,
     * preventing stale decorations when switching view modes (e.g. from a mode
     * with author colors to one without).
     */
    endPass(): void {
        // Clear author types not used in this pass
        for (const [key, type] of this.authorTypes) {
            if (!this.activeAuthorKeys.has(key)) {
                this.editor.setDecorations(type, []);
            }
        }

        // Flush ruler buffer
        const flush = (type: vscode.TextEditorDecorationType, key: string) => {
            this.editor.setDecorations(type, this.rulerBuffer.get(key) ?? []);
        };
        flush(this.rulerInsertionType, 'insertion');
        flush(this.rulerDeletionType, 'deletion');
        flush(this.rulerSubstitutionType, 'substitution');
        flush(this.rulerHighlightType, 'highlight');
        flush(this.rulerCommentType, 'comment');
    }

    /**
     * Clear all decorations (used when the document has no text or when
     * the extension is toggled off).
     */
    clear(): void {
        this.lastHiddenOffsets = [];
        this.hadHiddenRanges = false;

        for (const type of this.fixedTypes.values()) {
            this.editor.setDecorations(type, []);
        }
        this.editor.setDecorations(this.hiddenType, []);
        this.editor.setDecorations(this.rulerInsertionType, []);
        this.editor.setDecorations(this.rulerDeletionType, []);
        this.editor.setDecorations(this.rulerSubstitutionType, []);
        this.editor.setDecorations(this.rulerHighlightType, []);
        this.editor.setDecorations(this.rulerCommentType, []);

        for (const type of this.authorTypes.values()) {
            this.editor.setDecorations(type, []);
        }
    }

    dispose(): void {
        for (const type of this.fixedTypes.values()) {
            type.dispose();
        }
        this.hiddenType.dispose();
        this.rulerInsertionType.dispose();
        this.rulerDeletionType.dispose();
        this.rulerSubstitutionType.dispose();
        this.rulerHighlightType.dispose();
        this.rulerCommentType.dispose();

        for (const type of this.authorTypes.values()) {
            type.dispose();
        }
        this.authorTypes.clear();
    }

    // ─── Author type management ───────────────────────────────────────────────

    /**
     * Get or create a decoration type for a specific author + visual role.
     * Cached by "author:role:style" key.
     *
     * Deletion-role authors always use fixed red (#EF5350 dark / #C0392B light)
     * rather than their palette color — strikethrough already signals removal,
     * and author-colored deletions send contradictory signals.
     */
    private getAuthorType(author: string, role: AuthorDecorationRole): vscode.TextEditorDecorationType {
        const cacheKey = `${author}:${role}:${this.style}`;
        if (this.authorTypes.has(cacheKey)) {
            return this.authorTypes.get(cacheKey)!;
        }

        const color = this.authorColorMap.getColor(author);
        const needsStrikethrough = role === 'deletion' || role === 'substitution-original' || role === 'move-from';
        const needsUnderline = role === 'move-to';
        const isDeletionRole = role === 'deletion' || role === 'substitution-original';

        let decorationOptions: vscode.DecorationRenderOptions;

        if (role === 'move-from' || role === 'move-to') {
            const base = needsStrikethrough ? 'line-through' : (needsUnderline ? 'underline' : 'none');
            decorationOptions = {
                light: { textDecoration: `${base}; color: #6C3483` },
                dark: { textDecoration: `${base}; color: #CE93D8` },
            };
        } else if (this.style === 'foreground') {
            const base = needsStrikethrough ? 'line-through' : 'none';
            if (isDeletionRole) {
                // Fixed red for deletions regardless of author
                decorationOptions = {
                    light: { textDecoration: `${base}; color: #C0392B` },
                    dark: { textDecoration: `${base}; color: #EF5350` },
                };
            } else {
                decorationOptions = {
                    light: { textDecoration: `${base}; color: ${color.light}` },
                    dark: { textDecoration: `${base}; color: ${color.dark}` },
                };
            }
        } else {
            // Background mode
            const base = needsStrikethrough ? 'line-through' : 'none';
            if (isDeletionRole) {
                decorationOptions = {
                    textDecoration: `${base}; background-color: rgba(255,0,0,0.15); color: rgba(255,50,50,1); opacity: 0.7`,
                };
            } else {
                decorationOptions = {
                    textDecoration: `${base}; background-color: ${color.light}20`,
                };
            }
        }

        const type = vscode.window.createTextEditorDecorationType(decorationOptions);
        this.authorTypes.set(cacheKey, type);
        return type;
    }
}
