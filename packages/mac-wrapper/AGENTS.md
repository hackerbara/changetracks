# AGENTS.md -- packages/mac-wrapper

## Purpose

Native macOS shell for the ChangeDown website-v2 SPA. Wraps the web app in a WKWebView with native file I/O and menus. Depends on website-v2 for all UI -- this package contains zero rendering logic.

## Key Files

| File | Role |
|------|------|
| `Package.swift` | Swift Package Manager manifest. Target: macOS 14+, Swift 5.9. Single executable target `ChangeDown` from `Sources/ChangeDownApp/`. |
| `Sources/ChangeDownApp/ChangeDownApp.swift` | App entry point, AppDelegate, window setup, native menus, CLI arg parsing, WKWebView config, JS bridge (WKScriptMessageHandler), file injection logic. Terminal launches hand off to Launch Services via `NSWorkspace.openApplication` so the shell returns immediately. |
| `Sources/ChangeDownApp/LocalServer.swift` | NWListener (Network.framework) HTTP server. Serves dist files on localhost with proper MIME types. Random port, falls back to `loadFileURL` if server fails. |
| `../../website-v2/vite.config.native.ts` | Vite config for the native build. Extends the base website config. Outputs to `packages/mac-wrapper/dist/`. |
| `../../website-v2/native.html` | Entry HTML for the native bundle (uses relative `./` paths, not `/app/`). |
| `dist/` | Build output (gitignored). Contains `native.html`, `main.js`, `lsp-worker.js`, `assets/`, `content/`. |
| `ChangeDown.app/` | Produced by **`node scripts/package-app.mjs`** after Swift + `dist/` exist. **This is the canonical shipped layout** (Contents/MacOS + Resources/dist). |
| `intro-fixture-changedown.md` | Test fixture file for manual testing with CLI arg. |

## Build Commands (single bundle lifecycle)

From **repo root**, a full viewer build is included in the same paths as the rest of the monorepo:

- **`./scripts/build-all.sh`** (default) runs **`node scripts/build.mjs`** then **`node scripts/install.mjs`**. **`build.mjs`** runs native SPA → **`swift build -c release`** → **`node scripts/package-app.mjs`** → **`ChangeDown.app`**. On macOS, if the Swift binary exists, packaging **must** succeed (no silent skip).
- **`./scripts/build-all.sh --old`** runs the legacy bash pipeline; on macOS it also runs **`package-app.mjs`** after Swift when the binary exists (parity with **`build.mjs`**).
- **`npm run build:package-app`** runs only **`node scripts/package-app.mjs`** (expects native **`dist/`** + Swift binary already built).

Or run **`node scripts/build.mjs`** alone if you do not want **`install.mjs`**.

Manual steps (equivalent):

```bash
cd website-v2 && npx vite build --config vite.config.native.ts
cd packages/mac-wrapper && swift build -c release
cd ../.. && node scripts/package-app.mjs
```

**`cdviewer`** (from `node scripts/install.mjs`) symlinks to **`ChangeDown.app/Contents/MacOS/ChangeDown`**, not to `.build/release/ChangeDown`.

## Critical: base path difference

The native build uses `base: './'` (relative paths). The website build uses `base: '/app/'` (absolute paths). This affects all asset URLs in the HTML and JS output. The native config achieves this by merging with the base config and overriding `base`:

```ts
// vite.config.native.ts
export default mergeConfig(baseConfig, defineConfig({
  base: './',
  build: {
    outDir: resolve(__dirname, '../packages/mac-wrapper/dist'),
    ...
  },
}));
```

If you add new assets or change import paths in website-v2, verify the native build still works.

## JS Bridge: Swift <-> JS Communication

### JS to Swift

JS calls `window.webkit.messageHandlers.changedown.postMessage({action, ...})`. The coordinator's `userContentController(_:didReceive:)` dispatches on the `action` field:

- `saveFile` -- writes content to disk (uses `currentFilePath` or shows NSSavePanel)
- `log` -- passes message to NSLog

### Swift to JS

Swift calls `webView.evaluateJavaScript(script)`. Used for:

- Installing the bridge object (`window.__changedown_native`)
- Injecting console.log/error/warn capture (atDocumentStart user script)
- File injection via `injectFile(atPath:)`
- Reading editor content for save (`requestSaveFromJS()` reads from Monaco)

### Error capture

A `WKUserScript` injected at `atDocumentStart` captures `error`, `unhandledrejection`, `console.log`, `console.warn`, and fetch responses. All are forwarded to NSLog via the bridge.

## File Injection Flow

1. CLI arg or File > Open provides a file path
2. `injectFile(atPath:)` reads the file, escapes for JS template literal
3. Polls `globalThis.__changedown_openFile` every 100ms (up to 10s) -- this global is exposed by the web app's App.tsx once VFS initializes
4. Calls `__changedown_openFile(fileName, content)` which writes to the in-memory VFS and sets it as active

## Dist directory resolution

`distCandidates()` searches in order:
1. `CHANGEDOWN_DIST` env var
2. Inside `.app` bundle (`Bundle.main` → `Contents/Resources/dist/`)
3. Relative to executable (for both `packages/mac-wrapper/dist` and `website-v2/dist`)
4. Relative to CWD
5. Hardcoded development paths

The first candidate containing `native.html` or `index.html` wins.
