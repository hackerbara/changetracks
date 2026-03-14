// adapters/claude-code/post-tool-use.ts — Claude Code PostToolUse handler
//
// Thin adapter: delegates side effects and context injection to llm-jail augment().
import * as fs from 'node:fs/promises';
import { nowTimestamp } from '@changetracks/core';
import { augment } from 'llm-jail';
import { loadConfig } from '../../config.js';
import { isFileInScope } from '../../scope.js';
import { buildChangeTracksRule } from '../../changetracks-rules.js';
export async function handlePostToolUse(input) {
    const { tool_name, tool_input, session_id, cwd } = input;
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
    const toolResult = {
        tool_response: input.tool_response,
    };
    // Creation tracking: handled before augment since it modifies the file
    if (tool_name.toLowerCase() === 'write' && config.policy.creation_tracking !== 'none') {
        const filePath = tool_input?.file_path ?? '';
        if (filePath && isFileInScope(filePath, config, projectDir)) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const TRACKING_HEADER = '<!-- ctrcks.com/v1: tracked -->';
                if (!content.startsWith(TRACKING_HEADER)) {
                    const author = process.env.CHANGETRACKS_AUTHOR ?? (config.author.default || 'unknown');
                    const ts = nowTimestamp();
                    let wrapped = TRACKING_HEADER + '\n' + content;
                    const footnote = `\n\n[^ct-1]: ${author} | ${ts.date} | creation | proposed\n    ${author} ${ts.raw}: File created`;
                    wrapped += footnote;
                    await fs.writeFile(filePath, wrapped, 'utf-8');
                }
            }
            catch (err) {
                process.stderr.write(`changetracks: creation tracking failed: ${err}\n`);
            }
        }
    }
    // Run augment phase (side effects + optional additionalContext)
    const rule = buildChangeTracksRule(config, projectDir, sessionId);
    const additionalContext = await augment(toolCall, toolResult, [rule]);
    if (additionalContext) {
        return {
            hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext,
            },
        };
    }
    return {};
}
//# sourceMappingURL=post-tool-use.js.map