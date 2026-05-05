import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mergeJsonFile } from './json.js';
import type {
  AgentIntegrationResult,
  AgentName,
  AgentStatus,
  DetectAgentsOptions,
  SetupAgentIntegrationsOptions,
} from './types.js';

const ALL_AGENTS: AgentName[] = ['claude', 'cursor', 'opencode', 'codex'];

function defaultCommandExists(cmd: string): boolean {
  try {
    const whereCmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(whereCmd, [cmd], { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function readJson(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hasClaudeConfig(homeDir: string): boolean {
  const settings = readJson(path.join(homeDir, '.claude', 'settings.json'));
  const enabled = settings.enabledPlugins as Record<string, unknown> | undefined;
  const marketplaces = settings.extraKnownMarketplaces as Record<string, unknown> | undefined;
  return enabled?.['changedown@changedown'] === true || Boolean(marketplaces?.changedown);
}

function hasCodexConfig(homeDir: string): boolean {
  const marketplace = path.join(homeDir, '.codex', 'plugins', 'marketplace.json');
  const text = fs.existsSync(marketplace) ? fs.readFileSync(marketplace, 'utf8') : '';
  return text.includes('changedown') && !text.includes('${CLAUDE_PLUGIN_ROOT}');
}

export function detectAgents(options: DetectAgentsOptions = {}): AgentStatus[] {
  const homeDir = options.homeDir ?? os.homedir();
  const commandExists = options.commandExists ?? defaultCommandExists;
  return [
    { name: 'claude', detected: commandExists('claude'), configured: hasClaudeConfig(homeDir) },
    { name: 'cursor', detected: commandExists('cursor'), configured: false },
    { name: 'opencode', detected: commandExists('opencode'), configured: false },
    { name: 'codex', detected: commandExists('codex') || fs.existsSync(path.join(homeDir, '.codex')), configured: hasCodexConfig(homeDir) },
  ];
}

function targetAgents(options: SetupAgentIntegrationsOptions): AgentName[] {
  if (options.include === 'detected') {
    return detectAgents(options).filter((agent) => agent.detected).map((agent) => agent.name);
  }
  return options.include;
}

function setupClaude(homeDir: string, dryRun: boolean, log: (message: string) => void): AgentIntegrationResult {
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  const patch = {
    extraKnownMarketplaces: {
      changedown: { source: { source: 'github', repo: 'hackerbara/changedown' } },
    },
    enabledPlugins: { 'changedown@changedown': true },
  };
  const result = mergeJsonFile(settingsPath, patch, { dryRun, log });
  if (dryRun && result.touched) {
    return {
      agent: 'claude',
      status: 'skipped',
      message: `Would configure Claude Code ChangeDown plugin in ${settingsPath}`,
      touchedFiles: [],
    };
  }
  return {
    agent: 'claude',
    status: result.touched ? 'configured' : 'already-configured',
    message: result.touched
      ? `Configured Claude Code ChangeDown plugin in ${settingsPath}`
      : `Claude Code ChangeDown plugin is already configured in ${settingsPath}`,
    touchedFiles: result.touched ? [settingsPath] : [],
  };
}

function setupCodex(): AgentIntegrationResult {
  return {
    agent: 'codex',
    status: 'manual-action',
    message: 'Install or enable the ChangeDown Codex plugin, then restart Codex so the plugin MCP config is available to new agent sessions.',
  };
}

function manual(agent: AgentName, message: string): AgentIntegrationResult {
  return { agent, status: 'manual-action', message };
}

export async function setupAgentIntegrations(options: SetupAgentIntegrationsOptions): Promise<AgentIntegrationResult[]> {
  const homeDir = options.homeDir ?? os.homedir();
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? console.log;
  const targets = targetAgents(options);
  const results: AgentIntegrationResult[] = [];

  for (const agent of ALL_AGENTS) {
    if (!targets.includes(agent)) continue;
    try {
      if (agent === 'claude') results.push(setupClaude(homeDir, dryRun, log));
      if (agent === 'codex') results.push(setupCodex());
      if (agent === 'cursor') results.push(manual('cursor', 'Cursor: install the ChangeDown extension and enable MCP in Settings → Features → MCP.'));
      if (agent === 'opencode') results.push(manual('opencode', 'OpenCode: add the ChangeDown plugin to opencode.json.'));
    } catch (err) {
      results.push({
        agent,
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
        repairCommand: `npx @changedown/cli agents setup --${agent} --verbose`,
      });
    }
  }
  return results;
}
