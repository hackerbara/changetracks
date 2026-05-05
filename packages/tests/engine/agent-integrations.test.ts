import { afterEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectAgents,
  setupAgentIntegrations,
  type AgentIntegrationResult,
} from '@changedown/cli/agents';

const tempHomes: string[] = [];

function tmpHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changedown-agents-'));
  tempHomes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function resultFor(results: AgentIntegrationResult[], agent: string): AgentIntegrationResult {
  const result = results.find((r) => r.agent === agent);
  if (!result) throw new Error(`missing result for ${agent}`);
  return result;
}

describe('agent integrations setup', () => {
  it('detectAgents includes codex in the stable result shape', () => {
    const agents = detectAgents({ commandExists: () => false, homeDir: tmpHome() });
    expect(agents.map((a) => a.name).sort()).toEqual(['claude', 'codex', 'cursor', 'opencode']);
    for (const agent of agents) {
      expect(typeof agent.detected).toBe('boolean');
      expect(typeof agent.configured).toBe('boolean');
    }
  });

  it('dry-run Claude setup reports the exact settings file without writing it', async () => {
    const home = tmpHome();
    const results = await setupAgentIntegrations({
      cwd: home,
      homeDir: home,
      include: ['claude'],
      mode: 'word',
      dryRun: true,
      commandExists: (cmd) => cmd === 'claude',
      log: () => {},
    });

    expect(resultFor(results, 'claude')).toMatchObject({
      agent: 'claude',
      status: 'skipped',
    });
    expect(resultFor(results, 'claude').message).toContain(path.join(home, '.claude', 'settings.json'));
    expect(resultFor(results, 'claude').message).toContain('Would configure');
    expect(resultFor(results, 'claude').touchedFiles).toEqual([]);
    expect(fs.existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
  });

  it('Claude configured detection recognizes enabledPlugins written by setup', async () => {
    const home = tmpHome();
    await setupAgentIntegrations({
      cwd: home,
      homeDir: home,
      include: ['claude'],
      mode: 'word',
      dryRun: false,
      commandExists: (cmd) => cmd === 'claude',
      log: () => {},
    });

    const agents = detectAgents({ commandExists: (cmd) => cmd === 'claude', homeDir: home });
    const claude = agents.find((a) => a.name === 'claude');
    expect(claude).toMatchObject({ detected: true, configured: true });
  });

  it('Codex setup returns manual-action when plugin install cannot be verified', async () => {
    const home = tmpHome();
    const results = await setupAgentIntegrations({
      cwd: home,
      homeDir: home,
      include: ['codex'],
      mode: 'word',
      dryRun: false,
      commandExists: (cmd) => cmd === 'codex',
      log: () => {},
    });

    expect(resultFor(results, 'codex')).toMatchObject({
      agent: 'codex',
      status: 'manual-action',
    });
    expect(resultFor(results, 'codex').repairCommand).toBeUndefined();
    expect(resultFor(results, 'codex').message).toContain('Install or enable the ChangeDown Codex plugin');
    expect(resultFor(results, 'codex').message).toContain('restart Codex');
    expect(resultFor(results, 'codex').message).not.toContain('changedown agents setup --codex');
  });

  it('targeted JSON writes create a backup before mutating an existing file', async () => {
    const home = tmpHome();
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ existing: { keep: true } }, null, 2) + '\n');

    await setupAgentIntegrations({
      cwd: home,
      homeDir: home,
      include: ['claude'],
      mode: 'word',
      dryRun: false,
      commandExists: (cmd) => cmd === 'claude',
      log: () => {},
    });

    const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
    expect(after.existing).toEqual({ keep: true });
    expect(after.enabledPlugins['changedown@changedown']).toBe(true);
    const backups = fs.readdirSync(path.dirname(settings)).filter((name) => name.includes('.changedown-backup-'));
    expect(backups.length).toBe(1);
  });

  it('does not replace an existing settings file that is invalid JSON', async () => {
    const home = tmpHome();
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, '{ invalid json', 'utf8');

    const results = await setupAgentIntegrations({
      cwd: home,
      homeDir: home,
      include: ['claude'],
      mode: 'word',
      dryRun: false,
      commandExists: (cmd) => cmd === 'claude',
      log: () => {},
    });

    expect(resultFor(results, 'claude')).toMatchObject({
      agent: 'claude',
      status: 'failed',
    });
    expect(resultFor(results, 'claude').message).toContain('is not valid JSON');
    expect(fs.readFileSync(settings, 'utf8')).toBe('{ invalid json');
    const backups = fs.readdirSync(path.dirname(settings)).filter((name) => name.includes('.changedown-backup-'));
    expect(backups.length).toBe(0);
  });
});
