# packages/mac-wrapper

Native macOS wrapper for the ChangeDown website-v2 SPA. Embeds a WKWebView that loads the single-bundle vite build via a local NWListener HTTP server. The result is a lightweight native app (144KB binary + web assets) with native menus, file open/save, and a JS bridge.

## Prerequisites

- Swift 5.9+
- macOS 14+ (Sonoma)
- website-v2 must be built first (the native vite config outputs to `packages/mac-wrapper/dist/`)

## Build

Build the native SPA bundle (from repo root):

```bash
cd website-v2 && npx vite build --config vite.config.native.ts
```

Build the Swift app:

```bash
cd packages/mac-wrapper && swift build -c release
```

The binary is at `.build/release/ChangeDown`.

## Run

No arguments (loads bundled demo content):

```bash
.build/release/ChangeDown
```

Open a file:

```bash
.build/release/ChangeDown /path/to/file.md
```

Override the dist directory (useful if the binary is relocated):

```bash
CHANGEDOWN_DIST=/path/to/dist .build/release/ChangeDown
```

## Architecture

- **LocalServer.swift** -- NWListener-based HTTP server that serves the dist directory on a random localhost port. This is needed because WKWebView's `loadFileURL` does not handle SPA routing or worker scripts well.
- **ChangeDownApp.swift** -- AppKit window setup, WKWebView configuration, native menus (File > Open, File > Save, Edit, View > Reload), CLI argument parsing, and the JS bridge.
- **vite.config.native.ts** (in website-v2/) -- Merges the base vite config but overrides `base: './'` (relative paths instead of `/app/`) and outputs a single-bundle build to `packages/mac-wrapper/dist/`. Uses `inlineDynamicImports: true` to collapse 244 chunks into one `main.js`.
- **native.html** (in website-v2/) -- Standalone entry point for the native build, references `./src/main.tsx` with relative paths.

### JS Bridge

Swift-to-JS communication uses `WKWebView.evaluateJavaScript()`. JS-to-Swift communication uses `WKScriptMessageHandler`:

```
JS:    window.webkit.messageHandlers.changedown.postMessage({action: 'saveFile', content, path})
Swift: userContentController(_:didReceive:) dispatches on action
```

The bridge installs two globals after page load:
- `window.__changedown_native.save(content, path)` -- save file to disk
- `window.__changedown_native.log(text)` -- log to NSLog

### File Injection

When a file path is passed via CLI or File > Open, the coordinator calls `injectFile(atPath:)` which polls for `globalThis.__changedown_openFile` (exposed by App.tsx once the VFS initializes) and passes the file content. The function writes to the in-memory VFS and sets it as the active document.

## Known Limitations (PoC stage)

- Web app does not call the save bridge yet -- Cmd+S works via the native menu (pulls content from Monaco, writes to disk)
- No accept/reject UI for tracked changes
- DOCX import requires network access (pandoc-wasm loaded from CDN)
- Mobile layout triggers at 768px window width (CSS breakpoint from the web app)
- Web Inspector is always enabled (`webView.isInspectable = true`)
