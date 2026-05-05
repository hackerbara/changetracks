import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, DEFAULT_CONFIG, DEFAULT_UNCONFIGURED_CONFIG } from '@changedown/cli/config';
import { ConfigResolver } from '@changedown/cli/engine';

describe('uninitialized ChangeDown defaults', () => {
  it('exports explicit inert defaults for projects without .changedown/config.toml', () => {
    expect(DEFAULT_UNCONFIGURED_CONFIG.tracking.include).toEqual([]);
    expect(DEFAULT_UNCONFIGURED_CONFIG.tracking.include_absolute).toEqual([]);
    expect(DEFAULT_UNCONFIGURED_CONFIG.tracking.default).toBe('untracked');
    expect(DEFAULT_UNCONFIGURED_CONFIG.tracking.auto_header).toBe(false);
    expect(DEFAULT_UNCONFIGURED_CONFIG.policy.creation_tracking).toBe('none');
    expect(DEFAULT_UNCONFIGURED_CONFIG.hooks.intercept_tools).toBe(false);
    expect(DEFAULT_UNCONFIGURED_CONFIG.hooks.intercept_bash).toBe(false);
    expect(DEFAULT_UNCONFIGURED_CONFIG.hooks.patch_wrap_experimental).toBe(false);
  });

  it('keeps initialized defaults active for generated project config semantics', () => {
    expect(DEFAULT_CONFIG.tracking.default).toBe('tracked');
    expect(DEFAULT_CONFIG.hooks.intercept_tools).toBe(true);
  });

  it('loadConfig returns inert defaults when no config exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changedown-no-config-'));
    const config = await loadConfig(dir);
    expect(config.tracking.include).toEqual([]);
    expect(config.tracking.default).toBe('untracked');
    expect(config.tracking.auto_header).toBe(false);
    expect(config.policy.creation_tracking).toBe('none');
    expect(config.hooks.intercept_tools).toBe(false);
  });

  it('ConfigResolver.forFile returns inert defaults when no config exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changedown-resolver-no-config-'));
    const file = path.join(dir, 'example.md');
    fs.writeFileSync(file, '# Example\n');

    const resolver = new ConfigResolver(dir);
    const { config } = await resolver.forFile(file);

    expect(config.tracking.include).toEqual([]);
    expect(config.tracking.default).toBe('untracked');
    expect(config.tracking.auto_header).toBe(false);
    expect(config.policy.creation_tracking).toBe('none');
    expect(config.hooks.intercept_tools).toBe(false);
  });

  it('ConfigResolver.lastConfig returns inert defaults when no config exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changedown-last-config-no-config-'));
    const resolver = new ConfigResolver(dir);

    const config = await resolver.lastConfig();

    expect(config.tracking.include).toEqual([]);
    expect(config.tracking.default).toBe('untracked');
    expect(config.tracking.auto_header).toBe(false);
    expect(config.policy.creation_tracking).toBe('none');
    expect(config.hooks.intercept_tools).toBe(false);
  });
});
