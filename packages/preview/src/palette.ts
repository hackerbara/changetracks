/**
 * Shared visual-semantic mapping for ChangeDown rendering.
 *
 * Colors come from DECORATION_STYLES in @changedown/core/host —
 * the single source of truth. This module maps ChangeType → CSS
 * class names and HTML tags for preview rendering.
 */

import { ChangeType, ChangeStatus } from '@changedown/core';
import { DECORATION_STYLES } from '@changedown/core/host';
import type { DecorationStyleDef } from '@changedown/core/host';

// ---------------------------------------------------------------------------
// Color helpers — extract ThemeColor from DECORATION_STYLES
// ---------------------------------------------------------------------------

export interface ThemeColor {
    light: string;
    dark: string;
}

function colorOf(style: DecorationStyleDef): ThemeColor {
    return { light: style.light.color ?? '', dark: style.dark.color ?? '' };
}

// ---------------------------------------------------------------------------
// Style mapping
// ---------------------------------------------------------------------------

export interface ChangeStyleInfo {
    cssClass: string;
    htmlTag: string;
    foreground?: ThemeColor;
    strikethrough: boolean;
}

export function getChangeStyle(
    type: ChangeType,
    status: ChangeStatus,
    moveRole?: 'from' | 'to',
): ChangeStyleInfo {
    const statusClass = status.toLowerCase();

    if (moveRole === 'from') {
        return {
            cssClass: `cn-move-from cn-${statusClass}`,
            htmlTag: 'del',
            foreground: colorOf(DECORATION_STYLES.moveFrom),
            strikethrough: true,
        };
    }
    if (moveRole === 'to') {
        return {
            cssClass: `cn-move-to cn-${statusClass}`,
            htmlTag: 'ins',
            foreground: colorOf(DECORATION_STYLES.moveTo),
            strikethrough: false,
        };
    }

    switch (type) {
        case ChangeType.Insertion:
            return {
                cssClass: `cn-ins cn-${statusClass}`,
                htmlTag: 'ins',
                foreground: colorOf(DECORATION_STYLES.insertion),
                strikethrough: false,
            };
        case ChangeType.Deletion:
            return {
                cssClass: `cn-del cn-${statusClass}`,
                htmlTag: 'del',
                foreground: colorOf(DECORATION_STYLES.deletion),
                strikethrough: true,
            };
        case ChangeType.Substitution:
            return {
                cssClass: `cn-sub cn-${statusClass}`,
                htmlTag: 'span',
                foreground: colorOf(DECORATION_STYLES.insertion),
                strikethrough: false,
            };
        case ChangeType.Highlight:
            return {
                cssClass: 'cn-hl',
                htmlTag: 'mark',
                strikethrough: false,
            };
        case ChangeType.Comment:
            return {
                cssClass: 'cn-comment',
                htmlTag: 'span',
                strikethrough: false,
            };
    }
}
