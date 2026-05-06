import * as fs from 'node:fs/promises';
import * as https from 'node:https';
import { pathToFileURL } from 'node:url';
import { ensureWordStateDir, WORD_MANIFEST_CACHE_PATH } from './state.js';
import { PACKAGED_LOCAL_MANIFEST_PATH } from './pane-server.js';

export const DEFAULT_HOSTED_MANIFEST_URL = 'https://changedown.com/word/manifest.hosted.xml';
const DEV_PANE_URL = '127.0.0.1:3000';
const HOSTED_TASKPANE_URL = 'https://changedown.com/word/taskpane.html';
const LOCAL_TASKPANE_URL = 'https://127.0.0.1:3000/taskpane.html';
const HTTPS_LOOPBACK_APP_DOMAIN = '<AppDomain>https://127.0.0.1:39990</AppDomain>';

interface ResolveManifestOptions {
  mcpScheme?: 'http' | 'https';
  paneMode?: 'local' | 'hosted';
}

function download(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
        reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

export function validateHostedManifestText(manifest: string): void {
  if (manifest.includes(DEV_PANE_URL)) {
    throw new Error(`Hosted manifest still references dev pane ${DEV_PANE_URL}`);
  }
  if (!manifest.includes(HOSTED_TASKPANE_URL)) {
    throw new Error(`Hosted manifest missing ${HOSTED_TASKPANE_URL}`);
  }
  if (!manifest.includes(HTTPS_LOOPBACK_APP_DOMAIN)) {
    throw new Error('Hosted manifest is missing the loopback MCP AppDomain for https://127.0.0.1:39990');
  }
}

export function validateLocalManifestText(manifest: string): void {
  if (!manifest.includes(LOCAL_TASKPANE_URL)) {
    throw new Error(`Local manifest missing ${LOCAL_TASKPANE_URL}`);
  }
  if (!manifest.includes(HTTPS_LOOPBACK_APP_DOMAIN)) {
    throw new Error('Local manifest is missing the loopback MCP AppDomain for https://127.0.0.1:39990');
  }
}

function validateManifestText(manifest: string): void {
  if (manifest.includes(HOSTED_TASKPANE_URL)) {
    validateHostedManifestText(manifest);
    return;
  }
  validateLocalManifestText(manifest);
}

function manifestWithMcpScheme(manifest: string, scheme: 'http' | 'https' = 'https'): string {
  if (scheme === 'http') return manifest;
  const withHttpsDomain = manifest.includes(HTTPS_LOOPBACK_APP_DOMAIN)
    ? manifest
    : manifest.replace('</AppDomains>', `    ${HTTPS_LOOPBACK_APP_DOMAIN}\n  </AppDomains>`);
  return withHttpsDomain.replace(
    /https:\/\/changedown\.com\/word\/taskpane\.html(?:\?[^"<]*)?/g,
    'https://changedown.com/word/taskpane.html?changedownMcpScheme=https',
  );
}

export async function resolveManifest(input: string | undefined, dryRun = false, options: ResolveManifestOptions = {}): Promise<string> {
  if (input) {
    if (/^https:\/\//.test(input)) {
      if (dryRun) return WORD_MANIFEST_CACHE_PATH;
      await ensureWordStateDir();
      const text = await download(input);
      validateManifestText(text);
      await fs.writeFile(WORD_MANIFEST_CACHE_PATH, manifestWithMcpScheme(text, options.mcpScheme), 'utf8');
      return WORD_MANIFEST_CACHE_PATH;
    }
    const text = await fs.readFile(input, 'utf8');
    validateManifestText(text);
    if (options.mcpScheme === 'https') {
      if (dryRun) return WORD_MANIFEST_CACHE_PATH;
      await ensureWordStateDir();
      await fs.writeFile(WORD_MANIFEST_CACHE_PATH, manifestWithMcpScheme(text, 'https'), 'utf8');
      return WORD_MANIFEST_CACHE_PATH;
    }
    return input;
  }

  if (options.paneMode === 'local') {
    if (!dryRun) {
      const text = await fs.readFile(PACKAGED_LOCAL_MANIFEST_PATH, 'utf8');
      validateLocalManifestText(text);
    }
    return PACKAGED_LOCAL_MANIFEST_PATH;
  }

  if (dryRun) return WORD_MANIFEST_CACHE_PATH;
  await ensureWordStateDir();
  const text = await download(DEFAULT_HOSTED_MANIFEST_URL);
  validateHostedManifestText(text);
  await fs.writeFile(WORD_MANIFEST_CACHE_PATH, manifestWithMcpScheme(text, options.mcpScheme), 'utf8');
  return WORD_MANIFEST_CACHE_PATH;
}

export async function resolveManifestForDoctor(input: string | undefined, noDownload = false): Promise<string> {
  if (input) {
    if (noDownload && /^https:\/\//.test(input)) {
      const err = new Error(`--no-download does not support HTTPS manifest input (${input}); pass a local manifest path or omit --no-download`);
      (err as NodeJS.ErrnoException).code = 'ERR_NO_DOWNLOAD_NETWORK_MANIFEST';
      throw err;
    }
    return resolveManifest(input, false);
  }
  if (noDownload) {
    const text = await fs.readFile(WORD_MANIFEST_CACHE_PATH, 'utf8');
    validateHostedManifestText(text);
    return WORD_MANIFEST_CACHE_PATH;
  }
  console.log(`Refreshing hosted manifest cache from ${DEFAULT_HOSTED_MANIFEST_URL}`);
  return resolveManifest(undefined, false);
}

export function manifestDisplayPath(manifestPath: string): string {
  return manifestPath.startsWith('/') ? manifestPath : pathToFileURL(manifestPath).toString();
}
