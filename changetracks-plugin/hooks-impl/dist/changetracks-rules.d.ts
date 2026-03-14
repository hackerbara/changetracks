import type { Rule } from 'llm-jail';
import type { ChangeTracksConfig } from './config.js';
/**
 * Build the ChangeTracks rule for a given config and project directory.
 * This replaces core/policy-engine.ts.
 */
export declare function buildChangeTracksRule(config: ChangeTracksConfig, projectDir: string, sessionId: string): Rule;
