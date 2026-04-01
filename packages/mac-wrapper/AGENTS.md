# AGENTS.md -- packages/mac-wrapper

## Purpose

Native macOS shell for the ChangeDown website-v2 SPA. Wraps the web app in a WKWebView with native file I/O and menus. Depends on website-v2 for all UI -- this package contains zero rendering logic.

## Key Files

| File | Role |
|------|------|
| `Package.swift` | Swift Package Manager manifest. Target: macOS 14+, Swift 5.9. Single executable target `ChangeDown` from `Sources/ChangeDownApp/`. |
| `Sources/ChangeDownApp/ChangeDownApp.swift` | App entry point, AppDelegate, window setup, native menus, CLI arg parsing, WKWebView config, JS bridge (WKScriptMessageHandler), file injection logic. |
| `Sources/ChangeDownApp/LocalServer.swift` | NWListener (Network.framework) HTTP server. Serves dist files on localhost with proper MIME types. Random port, falls back to `loadFileURL` if server fails. |
| `../../website-v2/vite.config.native.ts` | Vite config for the native build. Extends the base website config. Outputs to `packages/mac-wrapper/dist/`. |
| `../../website-v2/native.html` | Entry HTML for the native bundle (uses relative `./` paths, not `/app/`). |
| `dist/` | Build output (gitignored). Contains `native.html`, `main.js`, `lsp-worker.js`, `assets/`, `content/`. |
| `intro-fixture-changedown.md` | Test fixture file for manual testing with CLI arg. |

## Build Commands

```bash
# 1. Build native SPA bundle (from repo root or website-v2/)
cd website-v2 && npx vite build --config vite.config.native.ts

# 2. Build Swift binary
cd packages/mac-wrapper && swift build -c release
# Binary: .build/release/ChangeDown

# Debug build (faster, includes symbols)
swift build
# Binary: .build/debug/ChangeDown
```

Both steps are required. The Swift binary serves the dist directory -- without it, the app shows a "Build not found" error page.

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

A `WKUserScript` injected at `atDocumentStart` captures `error`, `unhandledrejection`, `console.log`, `console.warn`, and fetch responses. All are forwarded to NSLog via the bridge. This means JS errors appear in the terminal when running the binary.

## File Injection Flow

1. CLI arg or File > Open provides a file path
2. `injectFile(atPath:)` reads the file, escapes for JS template literal
3. Polls `globalThis.__changedown_openFile` every 100ms (up to 10s) -- this global is exposed by the web app's App.tsx once VFS initializes
4. Calls `__changedown_openFile(fileName, content)` which writes to the in-memory VFS and sets it as active

## Dist directory resolution

`distCandidates()` searches in order:
1. `CHANGEDOWN_DIST` env var
2. Relative to executable (for both `packages/mac-wrapper/dist` and `website-v2/dist`)
3. Relative to CWD
4. Hardcoded development paths

The first candidate containing `native.html` or `index.html` wins.
