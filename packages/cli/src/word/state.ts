import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WordSessionState } from './types.js';

export const WORD_STATE_DIR = path.join(os.homedir(), '.changedown', 'word');
export const WORD_SESSION_PATH = path.join(WORD_STATE_DIR, 'session.json');
export const WORD_MANIFEST_CACHE_PATH = path.join(WORD_STATE_DIR, 'manifest.hosted.xml');

export async function ensureWordStateDir(): Promise<void> {
  await fs.mkdir(WORD_STATE_DIR, { recursive: true });
}

export async function writeWordSession(state: WordSessionState): Promise<void> {
  await ensureWordStateDir();
  await fs.writeFile(WORD_SESSION_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function readWordSession(): Promise<WordSessionState | undefined> {
  try {
    return JSON.parse(await fs.readFile(WORD_SESSION_PATH, 'utf8')) as WordSessionState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export async function clearWordSession(): Promise<void> {
  await fs.rm(WORD_SESSION_PATH, { force: true });
}
