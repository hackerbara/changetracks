#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wordAddIn = join(root, 'packages', 'word-add-in');
const wordDist = join(wordAddIn, 'dist');
const cliPane = join(root, 'packages', 'cli', 'word-pane');

if (!existsSync(wordDist)) {
  console.error(`Missing ${wordDist}. Run: cd packages/word-add-in && npm run build`);
  process.exit(1);
}

rmSync(cliPane, { recursive: true, force: true });
mkdirSync(cliPane, { recursive: true });

for (const entry of readdirSync(wordDist, { withFileTypes: true })) {
  if (entry.name === 'manifest.hosted.xml') continue;
  cpSync(join(wordDist, entry.name), join(cliPane, entry.name), { recursive: true });
}

await copyFile(join(wordAddIn, 'manifest.xml'), join(cliPane, 'manifest.xml'));

console.log(`Copied Word pane assets to ${cliPane}`);
