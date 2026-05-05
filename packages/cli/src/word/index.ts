import type { WordCommandContext, WordCommandOptions } from './types.js';
import { runWordStart } from './start.js';
import { runWordStop } from './stop.js';
import { runWordDoctor } from './doctor.js';

function printHelp(): void {
  console.log(`
  changedown word — run the hosted ChangeDown Word pane locally

  Usage:
    changedown word start [options]   Download/sideload the hosted manifest and configure agents
    changedown word stop [options]    Stop the sideload session
    changedown word doctor [options]  Check manifest, tool, and MCP readiness

  Options:
    --manifest PATH_OR_URL  Use a manifest path or HTTPS URL instead of changedown.com
    --dry-run               Print planned actions without launching Word
    --no-validate           Skip office-addin-manifest validation
    --no-sideload           Prepare without sideloading Word
    --no-agents            Do not configure detected agent integrations
    --require-agents       Fail if requested automatic agent setup fails or needs manual action
    --with-dev-certs       Default: install/use Office dev certs and probe HTTPS loopback MCP
    --use-dev-certs        Alias for --with-dev-certs
    --no-dev-certs         Diagnostic fallback: use HTTP loopback MCP without Office dev certs
    --no-download          Doctor only: do not download/refresh hosted manifest cache
  `);
}

function parseOptions(args: string[]): { command: string; options: WordCommandOptions } {
  const [command = 'help', ...rest] = args;
  const options: WordCommandOptions = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--manifest') options.manifest = rest[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-validate') options.noValidate = true;
    else if (arg === '--no-sideload') options.noSideload = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--no-agents') options.noAgents = true;
    else if (arg === '--require-agents') options.requireAgents = true;
    else if (arg === '--with-dev-certs' || arg === '--use-dev-certs') options.useDevCerts = true;
    else if (arg === '--no-dev-certs') options.noDevCerts = true;
    else if (arg === '--no-download') options.noDownload = true;
    else if (arg === '--help' || arg === '-h') return { command: 'help', options };
    else throw new Error(`Unknown changedown word option: ${arg}`);
  }
  return { command, options };
}

export async function runWordCommand(args: string[], ctx: WordCommandContext): Promise<void> {
  try {
    const { command, options } = parseOptions(args);
    let code = 0;
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp();
    } else if (command === 'start') {
      code = await runWordStart(ctx, options);
    } else if (command === 'stop') {
      code = await runWordStop(ctx, options);
    } else if (command === 'doctor') {
      code = await runWordDoctor(ctx, options);
    } else {
      console.error(`Unknown changedown word command: ${command}`);
      printHelp();
      code = 2;
    }
    process.exit(code);
  } catch (err) {
    console.error(`changedown word: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
