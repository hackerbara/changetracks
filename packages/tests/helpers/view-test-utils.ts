import { VIEW_PRESETS } from '@changedown/core/host';
import type { View, DisplayOptions } from '@changedown/core/host';
import type { Projection } from '@changedown/core/host';

const LEGACY_MODE_TO_PRESET: Record<string, keyof typeof VIEW_PRESETS> = {
    review: 'review',
    changes: 'simple',
    settled: 'final',
    raw: 'original',
};

export function makeView(mode: string, overrides?: { projection?: Projection; display?: Partial<DisplayOptions> }): View {
    const presetName = LEGACY_MODE_TO_PRESET[mode] ?? mode;
    const base = VIEW_PRESETS[presetName as keyof typeof VIEW_PRESETS] ?? VIEW_PRESETS.review;
    return {
        ...base,
        ...(overrides?.projection ? { projection: overrides.projection } : {}),
        display: { ...base.display, ...overrides?.display },
    };
}
