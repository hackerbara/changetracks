// packages/cli/src/engine/handlers/index.ts
// Barrel re-export so backends/file-backend.ts has a single import point.
// Does NOT replace the individual handler exports in engine/index.ts —
// the top-level engine barrel keeps exporting each handler directly.
export { handleProposeChange } from './propose-change.js';
export { handleReviewChanges } from './review-changes.js';
export { handleReadTrackedFile } from './read-tracked-file.js';
export { handleAmendChange } from './amend-change.js';
export { handleListChanges } from './list-changes.js';
export { handleSupersedeChange } from './supersede-change.js';
export { handleResolveThread } from './resolve-thread.js';
export { handleRespondToThread } from './respond-to-thread.js';
