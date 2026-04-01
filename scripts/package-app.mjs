#!/usr/bin/env node
// ChangeDown — Package macOS .app bundle
// Usage: node scripts/package-app.mjs [--version=X.Y.Z]
//
// Assembles ChangeDown.app from:
//   - Swift binary: packages/mac-wrapper/.build/release/ChangeDown
//   - Web assets:   packages/mac-wrapper/dist/
//   - Info.plist:   packages/mac-wrapper/Info.plist
//
// Output: packages/mac-wrapper/ChangeDown.app + ChangeDown-arm64.zip + .sha256

import { existsSync, mkdirSync, cpSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { parseArgs } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const WRAPPER = join(ROOT, 'packages', 'mac-wrapper');

// --- Colors ---
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// --- Args ---
const { values } = parseArgs({
  options: {
    version: { type: 'string', default: '' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`
  ${bold('ChangeDown — Package .app')}

  Usage: node scripts/package-app.mjs [options]

  Options:
    --version=X.Y.Z   Version for the bundle (default: reads from package.json)
    -h, --help         Show this help
`);
  process.exit(0);
}

// --- Resolve version ---
const version = values.version ||
  JSON.parse(readFileSync(join(ROOT, 'packages', 'vscode-extension', 'package.json'), 'utf8')).version;

// --- Detect architecture ---
const arch = execSync('uname -m', { encoding: 'utf8' }).trim();  // arm64 or x86_64
const archLabel = arch === 'arm64' ? 'arm64' : 'x86_64';

// --- Verify inputs exist ---
const binary = join(WRAPPER, '.build', 'release', 'ChangeDown');
const dist = join(WRAPPER, 'dist');
const plist = join(WRAPPER, 'Info.plist');

const missing = [
  [binary, 'Swift binary — run: cd packages/mac-wrapper && swift build -c release'],
  [dist, 'Native SPA dist — run: cd website-v2 && npx vite build --config vite.config.native.ts'],
  [plist, 'Info.plist — expected at packages/mac-wrapper/Info.plist'],
].filter(([p]) => !existsSync(p));

if (missing.length > 0) {
  console.log(`\n  ${red(bold('Missing build inputs:'))}\n`);
  for (const [p, hint] of missing) {
    console.log(`    ${red('✗')} ${p}`);
    console.log(`      ${dim(hint)}`);
  }
  console.log('');
  process.exit(1);
}

// --- Assemble .app bundle ---
console.log(`\n  ${bold(`Packaging ChangeDown.app v${version} (${archLabel})`)}\n`);

const appDir = join(WRAPPER, 'ChangeDown.app');
const contentsDir = join(appDir, 'Contents');
const macosDir = join(contentsDir, 'MacOS');
const resourcesDir = join(contentsDir, 'Resources');

// Clean previous .app
execSync(`rm -rf "${appDir}"`, { stdio: 'pipe' });

// Create structure
mkdirSync(macosDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

// Copy binary
process.stdout.write(`  Binary...        `);
copyFileSync(binary, join(macosDir, 'ChangeDown'));
execSync(`chmod +x "${join(macosDir, 'ChangeDown')}"`, { stdio: 'pipe' });
console.log(green('ok'));

// Copy dist
process.stdout.write(`  Web assets...    `);
cpSync(dist, join(resourcesDir, 'dist'), { recursive: true });
console.log(green('ok'));

// Copy and patch Info.plist with version
process.stdout.write(`  Info.plist...    `);
let plistContent = readFileSync(plist, 'utf8');
plistContent = plistContent.replace(
  /<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/,
  `<key>CFBundleShortVersionString</key>\n    <string>${version}</string>`
);
plistContent = plistContent.replace(
  /<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/,
  `<key>CFBundleVersion</key>\n    <string>${version}</string>`
);
writeFileSync(join(contentsDir, 'Info.plist'), plistContent);
console.log(green('ok'));

// Ad-hoc sign (required for WKWebView on macOS)
process.stdout.write(`  Code sign...     `);
try {
  execSync(`codesign --force --deep --sign - "${appDir}"`, { stdio: 'pipe' });
  console.log(green('ok') + dim(' (ad-hoc)'));
} catch (e) {
  console.log(red('FAIL') + dim(' — codesign not available, skipping'));
}

// --- Create ZIP ---
const zipName = `ChangeDown-${archLabel}.zip`;
const zipPath = join(WRAPPER, zipName);
process.stdout.write(`  ZIP...           `);
execSync(`cd "${WRAPPER}" && zip -qr "${zipName}" ChangeDown.app`, { stdio: 'pipe' });
console.log(green('ok'));

// --- SHA-256 ---
const zipData = readFileSync(zipPath);
const sha256 = createHash('sha256').update(zipData).digest('hex');
const shaFile = `${zipPath}.sha256`;
writeFileSync(shaFile, `${sha256}  ${zipName}\n`);

const sizeMB = (zipData.length / 1024 / 1024).toFixed(1);

console.log(`
  ${green(bold('Done!'))}

  ${bold('App:')}  ${dim(appDir)}
  ${bold('ZIP:')}  ${dim(zipPath)} (${sizeMB} MB)
  ${bold('SHA:')}  ${dim(sha256)}

  Attach to GitHub Release:
    ${bold(zipName)}
    ${bold(zipName + '.sha256')}
`);
