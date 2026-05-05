// packages/core/src/backend/index.ts
export {
  AGENTS_UPDATED_METHOD,
  parseUri,
  wordSessionResourceName,
  type ParsedUri,
  type DocumentRef,
  type DocumentSnapshot,
  type ChangeOp,
  type ChangeResult,
  type ChangeSummary,
  type BackendEvent,
  type Unsubscribe,
  type DocumentBackend,
  type DocumentResourceDescriptor,
} from './types.js';
export { BackendRegistry, type BackendEntry } from './registry.js';
