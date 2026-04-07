import type {
  ProjectionSelector, DisplayOptions, ProjectionResult,
  ProjectionRequest, ProjectionSource, Disposable,
} from './types.js';
import { ChangeStatus, type ChangeNode } from '../model/types.js';
import { computeCurrentText, computeOriginalText } from '../operations/current-text.js';
import { computeDecidedView } from '../decided-text.js';
import { buildDecorationPlan } from './decorations/plan-builder.js';
import { VIEW_MODE_PRESETS } from './types.js';
import type { View } from './types.js';
import { normalizeUri } from './uri.js';

type CacheKey = string;

function makeCacheKey(uri: string, version: number, selector: ProjectionSelector, display: DisplayOptions): CacheKey {
  return `${uri}:${version}:${selector.projection}:${selector.format}:${JSON.stringify(display)}`;
}

export class ProjectionService implements Disposable {
  private readonly cache = new Map<CacheKey, ProjectionResult>();

  /**
   * Compute a projection with full control over selector and display.
   */
  get(request: ProjectionRequest): ProjectionResult {
    const key = makeCacheKey(normalizeUri(request.source.uri), request.source.sourceVersion, request.selector, request.display);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = this.compute(request);
    this.cache.set(key, result);
    return result;
  }

  /**
   * Convenience: compute a named preset (current/decided/original).
   */
  getPreset(source: ProjectionSource, preset: 'current' | 'decided' | 'original'): ProjectionResult {
    const viewMode = preset === 'current' ? 'review' : preset === 'decided' ? 'settled' : 'raw';
    const presetConfig = VIEW_MODE_PRESETS[viewMode];
    const selector: ProjectionSelector = { format: source.sourceFormat, projection: presetConfig.projection };
    const display: DisplayOptions = presetConfig.display;
    return this.get({ source, selector, display });
  }

  /**
   * Evict all cached results for a URI.
   */
  invalidate(uri: string): void {
    const normalized = normalizeUri(uri);
    for (const key of this.cache.keys()) {
      if (key.startsWith(normalized + ':')) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Pre-warm cache for upcoming projections.
   */
  warm(_uri: string, _selectors: readonly ProjectionSelector[], _display?: DisplayOptions): void {
    // No-op in v1 — cache is populated lazily via get().
  }

  dispose(): void {
    this.cache.clear();
  }

  private compute(request: ProjectionRequest): ProjectionResult {
    const { source, selector, display } = request;
    const { text, changes, sourceVersion } = source;

    let projectedText: string;
    let visibleChanges: readonly ChangeNode[] = changes;

    switch (selector.projection) {
      case 'current':
        projectedText = computeCurrentText(text);
        break;
      case 'decided': {
        const decidedResult = computeDecidedView(text, changes as ChangeNode[]);
        projectedText = decidedResult.lines.map(l => l.text).join('\n');
        visibleChanges = changes.filter(c => c.status === ChangeStatus.Accepted);
        break;
      }
      case 'original':
        projectedText = computeOriginalText(text);
        visibleChanges = [];
        break;
      default:
        projectedText = text;
    }

    const view: View = {
      name: 'projection-service',
      projection: selector.projection,
      display,
    };

    const decorationPlan = buildDecorationPlan(
      [...changes] as ChangeNode[],
      text,
      view,
      selector.format,
      0, // cursorOffset — callers update via snapshot
    );

    return {
      request,
      sourceVersion,
      text: projectedText,
      visibleChanges,
      decorationPlan,
    };
  }
}
