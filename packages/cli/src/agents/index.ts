import type { AgentIntegrationResult, AgentName } from './types.js';
import { setupAgentIntegrations } from './setup.js';

export { detectAgents, setupAgentIntegrations } from './setup.js';
export type {
  AgentIntegrationResult,
  AgentIntegrationStatus,
  AgentName,
  AgentStatus,
  DetectAgentsOptions,
  SetupAgentIntegrationsOptions,
} from './types.js';

function printHelp(): void {
  console.log(`
  changedown agents — configure ChangeDown integrations for installed agents

  Usage:
    changedown agents setup [options]

  Options:
    --detected             Configure detected agents (default)
    --claude               Configure Claude Code
    --cursor               Configure Cursor
    --opencode             Configure OpenCode
    --codex                Configure Codex
    --dry-run              Print intended writes without changing files
    --verbose              Print detailed setup output
    --json                 Print structured JSON results
    --require-configured   Exit 1 if any requested agent needs manual action
  `);
}

function parse(args: string[]): {
  command: string;
  agents: AgentName[] | 'detected';
  dryRun: boolean;
  verbose: boolean;
  json: boolean;
  requireConfigured: boolean;
} {
  const [command = 'help', ...rest] = args;
  if (command === '--help' || command === '-h') {
    return {
      command: 'help',
      agents: 'detected',
      dryRun: false,
      verbose: false,
      json: false,
      requireConfigured: false,
    };
  }
  let agents: AgentName[] = [];
  let dryRun = false;
  let verbose = false;
  let json = false;
  let requireConfigured = false;
  for (const arg of rest) {
    if (arg === '--detected') agents = [];
    else if (arg === '--claude') agents.push('claude');
    else if (arg === '--cursor') agents.push('cursor');
    else if (arg === '--opencode') agents.push('opencode');
    else if (arg === '--codex') agents.push('codex');
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--verbose') verbose = true;
    else if (arg === '--json') json = true;
    else if (arg === '--require-configured') requireConfigured = true;
    else if (arg === '--help' || arg === '-h') return { command: 'help', agents: 'detected', dryRun, verbose, json, requireConfigured };
    else throw new Error(`Unknown changedown agents option: ${arg}`);
  }
  return { command, agents: agents.length ? agents : 'detected', dryRun, verbose, json, requireConfigured };
}

function hasFailure(results: AgentIntegrationResult[], requireConfigured: boolean): boolean {
  return results.some((result) => result.status === 'failed' || (requireConfigured && result.status === 'manual-action'));
}

export async function runAgentsCommand(args: string[], ctx: { cwd: string }): Promise<void> {
  const parsed = parse(args);
  if (parsed.command === 'help') {
    printHelp();
    process.exit(0);
  }
  if (parsed.command !== 'setup') {
    console.error(`Unknown changedown agents command: ${parsed.command}`);
    printHelp();
    process.exit(2);
  }
  const results = await setupAgentIntegrations({
    cwd: ctx.cwd,
    mode: 'word',
    include: parsed.agents,
    dryRun: parsed.dryRun,
    verbose: parsed.verbose,
    requireConfigured: parsed.requireConfigured,
    log: parsed.verbose ? (parsed.json ? console.error : console.log) : () => {},
  });
  if (parsed.json) console.log(JSON.stringify(results, null, 2));
  else for (const result of results) console.log(`${result.status === 'failed' ? '✗' : result.status === 'manual-action' ? '○' : '✓'} ${result.message}`);
  process.exit(hasFailure(results, parsed.requireConfigured) ? 1 : 0);
}
