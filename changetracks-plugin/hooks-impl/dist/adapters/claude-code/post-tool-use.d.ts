import type { HookInput } from '../shared.js';
export interface PostToolUseResult {
    hookSpecificOutput?: {
        hookEventName: string;
        additionalContext?: string;
    };
}
export declare function handlePostToolUse(input: HookInput): Promise<PostToolUseResult>;
