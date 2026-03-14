import type { PolicyDecision } from './types.js';
import type { ChangeTracksConfig } from '../config.js';
export interface RawEditOptions {
    /** When true, check if the file exists on disk. Non-existent files with
     *  creation_tracking enabled are allowed through for PostToolUse wrapping. */
    checkFileExists?: boolean;
}
/**
 * Evaluate whether a raw Edit/Write to a file should be allowed.
 * Used by: Cursor preToolUse (Claude Code now uses llm-jail evaluate())
 */
export declare function evaluateRawEdit(filePath: string, config: ChangeTracksConfig, projectDir: string, options?: RawEditOptions): PolicyDecision;
/**
 * Evaluate whether a raw file read should be allowed.
 * Used by: Cursor beforeReadFile (Claude Code now uses llm-jail evaluate())
 */
export declare function evaluateRawRead(filePath: string, config: ChangeTracksConfig, projectDir: string): PolicyDecision;
/**
 * Evaluate whether an MCP tool call should proceed.
 * Used by: Cursor beforeMCPExecution (Claude Code validates server-side)
 *
 * Read-only tools always allowed. Write tools validated for:
 * - Author presence (when enforcement = "required")
 */
export declare function evaluateMcpCall(toolName: string, toolInput: Record<string, unknown>, config: ChangeTracksConfig): PolicyDecision;
