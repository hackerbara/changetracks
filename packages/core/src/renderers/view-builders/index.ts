/**
 * View builder index — dispatcher that routes to the correct view builder
 * based on the requested BuiltinView.
 */

import { buildReviewDocument, type ReviewBuildOptions } from './working.js';
import { buildSimpleDocument, type SimpleBuildOptions } from './simple.js';
import { buildDecidedDocument, type DecidedBuildOptions } from './decided.js';
import { buildRawDocument, type RawViewOptions } from './raw.js';
import type { ThreeZoneDocument } from '../three-zone-types.js';
import type { BuiltinView } from '../../host/types.js';

export { buildReviewDocument, buildSimpleDocument, buildDecidedDocument, buildRawDocument };
export type { ReviewBuildOptions, SimpleBuildOptions, DecidedBuildOptions, RawViewOptions };

/**
 * Union of all view-specific option types.
 * Since all four share the same base fields (filePath, trackingStatus,
 * protocolMode, defaultView, viewPolicy), the intersection collapses
 * to a single shared shape. This lets callers pass one options object
 * to buildViewDocument without caring which view is selected.
 */
export type ViewOptions = ReviewBuildOptions & SimpleBuildOptions & DecidedBuildOptions & RawViewOptions;

/**
 * Dispatch to the correct view builder based on the BuiltinView name.
 */
export function buildViewDocument(
  rawContent: string,
  view: BuiltinView,
  options: ViewOptions,
): ThreeZoneDocument {
  switch (view) {
    case 'working':  return buildReviewDocument(rawContent, options);
    case 'simple':   return buildSimpleDocument(rawContent, options);
    case 'decided':  return buildDecidedDocument(rawContent, options);
    case 'raw':      return buildRawDocument(rawContent, options);
    case 'original':
      // Host-only view; not dispatchable via buildViewDocument. Hosts call
      // computeOriginalText directly.
      throw new Error(
        "View 'original' is not supported by buildViewDocument. Host-side " +
        "consumers should call computeOriginalText directly. MCP agents " +
        "should not receive this view name (rejected by resolveView enum)."
      );
    default:
      // TypeScript exhaustiveness guard — should be unreachable.
      throw new Error(`Unknown view: ${String(view)}`);
  }
}
