import type { HookInput } from '../shared.js';
export interface PreToolUseResult {
    hookSpecificOutput?: {
        hookEventName: string;
        permissionDecision: 'deny' | 'allow' | 'ask';
        permissionDecisionReason?: string;
        additionalContext?: string;
    };
}
export declare function handlePreToolUse(input: HookInput): Promise<PreToolUseResult>;
