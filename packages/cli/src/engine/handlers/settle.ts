import { applyAcceptedChanges as coreApplyAccepted, applyRejectedChanges as coreApplyRejected } from '@changedown/core';

/**
 * Thin wrapper around core's applyAcceptedChanges. Used by review handlers
 * for auto-settlement after approval; not exposed as a standalone MCP tool.
 */
export function applyAcceptedChanges(fileContent: string): {
  currentContent: string;
  appliedIds: string[];
} {
  return coreApplyAccepted(fileContent);
}

/**
 * Thin wrapper around core's applyRejectedChanges. Used by review handlers
 * for auto-settlement after rejection; not exposed as a standalone MCP tool.
 */
export function applyRejectedChanges(fileContent: string): {
  currentContent: string;
  appliedIds: string[];
} {
  return coreApplyRejected(fileContent);
}
