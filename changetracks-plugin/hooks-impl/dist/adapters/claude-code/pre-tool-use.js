// adapters/claude-code/pre-tool-use.ts — Claude Code PreToolUse handler
//
// Thin adapter: delegates all policy decisions to llm-jail evaluate().
import { evaluate } from 'llm-jail';
import { loadConfig } from '../../config.js';
import { buildChangeTracksRule } from '../../changetracks-rules.js';
export async function handlePreToolUse(input) {
    const { tool_name, tool_input, cwd, session_id } = input;
    if (!tool_name || !cwd)
        return {};
    const projectDir = cwd;
    const sessionId = session_id ?? 'unknown';
    const config = await loadConfig(projectDir);
    const toolCall = {
        tool: tool_name.toLowerCase(),
        input: tool_input ?? {},
        cwd: projectDir,
    };
    const rule = buildChangeTracksRule(config, projectDir, sessionId);
    const verdict = await evaluate(toolCall, [rule]);
    return verdictToHookResult(verdict);
}
function verdictToHookResult(verdict) {
    if (verdict.action === 'deny') {
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: verdict.reason ?? verdict.agentHint ?? 'Blocked by LLM Jail',
            },
        };
    }
    if (verdict.action === 'warn' || verdict.agentHint) {
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                additionalContext: verdict.agentHint,
            },
        };
    }
    return {};
}
//# sourceMappingURL=pre-tool-use.js.map