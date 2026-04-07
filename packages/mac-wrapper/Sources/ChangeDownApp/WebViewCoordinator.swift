import AppKit
import WebKit
import UniformTypeIdentifiers

// MARK: - WebView Coordinator (Navigation + JS Bridge)

class WebViewCoordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    let filePath: String?
    let workspaceRoot: String?
    weak var webView: WKWebView?
    private var currentFilePath: String?
    var onReady: (() -> Void)?

    init(filePath: String?, workspaceRoot: String?) {
        self.filePath = filePath
        self.workspaceRoot = workspaceRoot
        super.init()
    }

    private func escapeForJSTemplateLiteral(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "`", with: "\\`")
         .replacingOccurrences(of: "$", with: "\\$")
    }

    /// Create a WKUserScript that pre-loads file content into a global variable.
    /// Must be added to the WKUserContentController BEFORE page load.
    func makePreloadScript() -> WKUserScript? {
        guard let path = filePath,
              let data = FileManager.default.contents(atPath: path),
              let content = String(data: data, encoding: .utf8) else {
            return nil
        }

        // Compute workspace-relative path (e.g. "/readme.md")
        var relativePath: String
        if let root = workspaceRoot {
            let fullResolved = (path as NSString).standardizingPath
            let rootResolved = (root as NSString).standardizingPath
            if fullResolved.hasPrefix(rootResolved) {
                relativePath = String(fullResolved.dropFirst(rootResolved.count))
                if !relativePath.hasPrefix("/") { relativePath = "/" + relativePath }
            } else {
                relativePath = "/" + (path as NSString).lastPathComponent
            }
        } else {
            relativePath = "/" + (path as NSString).lastPathComponent
        }

        let escaped = escapeForJSTemplateLiteral(content)

        // Mark file as loaded so injectFile() in didFinish doesn't re-read it
        currentFilePath = path

        return WKUserScript(source: """
        window.__changedown_preload = {
            path: '\(relativePath.replacingOccurrences(of: "'", with: "\\'"))',
            content: `\(escaped)`
        };
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("[ChangeDown] Page finished loading")

        let wsRoot = workspaceRoot.map { "'\($0.replacingOccurrences(of: "'", with: "\\'"))'" } ?? "null"

        // Patch the existing __changedown_native object with real save/log functions.
        // The marker object was created at atDocumentStart (before modules evaluated),
        // and createNativeFS() captured a reference to it. We MUST update the same
        // object — replacing it would orphan the reference the FS already holds.
        let bridgeScript = """
        (function() {
            var n = window.__changedown_native || {};
            n.workspaceRoot = \(wsRoot);
            n.save = function(content, path) {
                window.webkit.messageHandlers.changedown.postMessage({
                    action: 'saveFile',
                    content: content,
                    path: path || ''
                });
            };
            n.log = function(text) {
                window.webkit.messageHandlers.changedown.postMessage({
                    action: 'log',
                    text: text
                });
            };
            window.__changedown_native = n;
            // Capture all JS errors and unhandled rejections
            window.addEventListener('error', function(e) {
                window.webkit.messageHandlers.changedown.postMessage({
                    action: 'log',
                    text: 'JS ERROR: ' + e.message + ' at ' + (e.filename || '') + ':' + (e.lineno || '')
                });
            });
            window.addEventListener('unhandledrejection', function(e) {
                window.webkit.messageHandlers.changedown.postMessage({
                    action: 'log',
                    text: 'UNHANDLED REJECTION: ' + (e.reason?.message || e.reason || String(e))
                });
            });
            // Capture console.error
            var origError = console.error;
            console.error = function() {
                var msg = Array.from(arguments).map(function(a) {
                    return typeof a === 'object' ? JSON.stringify(a) : String(a);
                }).join(' ');
                window.webkit.messageHandlers.changedown.postMessage({
                    action: 'log', text: 'console.error: ' + msg
                });
                origError.apply(console, arguments);
            };
            window.webkit.messageHandlers.changedown.postMessage({
                action: 'log', text: 'Bridge installed, workspaceRoot=' + \(wsRoot)
            });
        })();
        """
        webView.evaluateJavaScript(bridgeScript)

        // If a file was provided via CLI, inject it immediately.
        // injectFile() polls for __changedown_openFile every 100ms (up to 10s).
        if let path = filePath, currentFilePath == nil {
            injectFile(atPath: path)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("[ChangeDown] Navigation failed: %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("[ChangeDown] Provisional navigation failed: %@", error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           (url.scheme == "https" || url.scheme == "http"),
           url.host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        NSLog("[ChangeDown] [JS alert] %@", message)
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = makeDocxOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection

        if panel.runModal() == .OK {
            completionHandler(panel.urls)
        } else {
            completionHandler(nil)
        }
    }

    // MARK: WKScriptMessageHandler (JS -> Swift)

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            NSLog("[ChangeDown] Invalid message from JS: %@", String(describing: message.body))
            return
        }

        switch action {
        case "saveFile":
            handleSaveFile(body)
        case "deleteFile":
            handleDeleteFile(body)
        case "log":
            let text = body["text"] as? String ?? ""
            NSLog("[ChangeDown] [JS] %@", text)
        case "ready":
            NSLog("[ChangeDown] [JS] SPA ready — showing window")
            onReady?()
            onReady = nil
        case "importDocx":
            handleImportDocx()
        default:
            NSLog("[ChangeDown] Unknown action: %@", action)
        }
    }

    // MARK: - File Injection

    /// Read a local file and inject its content into the web app's VFS via __changedown_openFile.
    /// The web app exposes this global function once the SPA mounts and VFS initializes.
    /// It writes the file to the VFS, sets it as active, and updates the sidebar.
    func injectFile(atPath path: String) {
        guard let webView = webView else { return }

        guard let data = FileManager.default.contents(atPath: path),
              let content = String(data: data, encoding: .utf8) else {
            NSLog("[ChangeDown] Failed to read file: %@", path)
            return
        }

        let fileName = (path as NSString).lastPathComponent
        let escaped = escapeForJSTemplateLiteral(content)

        // Poll for __changedown_openFile (exposed by App.tsx once VFS is ready).
        // This function writes to the VFS, sets activeFilePath, and marks userHasContent.
        // The file appears in the sidebar and opens as the active document.
        let js = """
        (function retry(attempt) {
            attempt = attempt || 0;
            if (typeof globalThis.__changedown_openFile === 'function') {
                var content = `\(escaped)`;
                globalThis.__changedown_openFile('\(fileName.replacingOccurrences(of: "'", with: "\\'"))', content)
                    .then(function() {
                        window.webkit?.messageHandlers?.changedown?.postMessage({
                            action: 'log',
                            text: 'File injected via VFS (' + content.length + ' chars)'
                        });
                    })
                    .catch(function(err) {
                        window.webkit?.messageHandlers?.changedown?.postMessage({
                            action: 'log',
                            text: 'VFS injection error: ' + err
                        });
                    });
                return;
            }
            if (attempt < 100) {
                setTimeout(function() { retry(attempt + 1); }, 100);
            } else {
                window.webkit?.messageHandlers?.changedown?.postMessage({
                    action: 'log',
                    text: 'Inject: Timed out waiting for __changedown_openFile (10s)'
                });
            }
        })();
        """

        webView.evaluateJavaScript(js) { [weak self] _, error in
            if let error = error {
                NSLog("[ChangeDown] JS injection error: %@", error.localizedDescription)
            } else {
                NSLog("[ChangeDown] Injected file eval started: %@", path)
                self?.currentFilePath = path
            }
        }
    }

    /// Ask the web app for current editor content and save it.
    /// Tries Monaco first (has unsaved edits), then falls back to VFS.
    func requestSaveFromJS() {
        guard let webView = webView else { return }

        let js = """
        (function() {
            // Try Monaco editor first -- it has the latest in-memory content
            var editors = globalThis.__monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                var model = editors[0].getModel();
                if (model) {
                    return model.getValue();
                }
            }
            return null;
        })();
        """

        webView.evaluateJavaScript(js) { [weak self] result, error in
            guard let self = self else { return }
            if let content = result as? String {
                self.handleSaveFile(["content": content, "path": self.currentFilePath ?? ""])
            } else {
                NSLog("[ChangeDown] Could not get editor content: %@", String(describing: error))
            }
        }
    }

    // MARK: - Import DOCX

    private func makeDocxOpenPanel() -> NSOpenPanel {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [
            UTType(filenameExtension: "docx") ?? .data,
        ]
        return panel
    }

    private func handleImportDocx() {
        guard let webView = webView else { return }

        let panel = makeDocxOpenPanel()
        guard panel.runModal() == .OK, let url = panel.url else { return }

        guard let data = try? Data(contentsOf: url) else {
            NSLog("[ChangeDown] Failed to read DOCX file: %@", url.path)
            return
        }

        let base64 = data.base64EncodedString()
        let filename = url.lastPathComponent

        // Send base64 data back to JS where it will be decoded and imported
        let js = """
        (function() {
            var binary = atob('\(base64)');
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            var file = new File([bytes], '\(filename.replacingOccurrences(of: "'", with: "\\'"))', {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            });
            if (typeof globalThis.__changedown_importDocxFile === 'function') {
                globalThis.__changedown_importDocxFile(file);
            }
        })();
        """

        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                NSLog("[ChangeDown] Import DOCX JS error: %@", error.localizedDescription)
            } else {
                NSLog("[ChangeDown] Import DOCX: injected %@ (%d bytes)", filename, data.count)
            }
        }
    }

    // MARK: - Delete File

    private func handleDeleteFile(_ body: [String: Any]) {
        guard let p = body["path"] as? String, !p.isEmpty else {
            NSLog("[ChangeDown] deleteFile: missing path")
            return
        }

        let path: String
        if p.hasPrefix("/") && !FileManager.default.fileExists(atPath: p), let root = workspaceRoot {
            path = (root as NSString).appendingPathComponent(p)
        } else {
            path = p
        }

        do {
            try FileManager.default.removeItem(atPath: path)
            NSLog("[ChangeDown] Deleted: %@", path)
        } catch {
            NSLog("[ChangeDown] Delete failed: %@", error.localizedDescription)
        }
    }

    // MARK: - Save File

    private func handleSaveFile(_ body: [String: Any]) {
        guard let content = body["content"] as? String else {
            NSLog("[ChangeDown] saveFile: missing content")
            return
        }

        let path: String
        if let p = body["path"] as? String, !p.isEmpty {
            // Resolve VFS-relative paths (e.g. "/docs/readme.md") against workspaceRoot
            if !p.hasPrefix("/Users") && !p.hasPrefix("/tmp") && !p.hasPrefix("/var"),
               p.hasPrefix("/"),
               let root = workspaceRoot {
                path = (root as NSString).appendingPathComponent(p)
            } else {
                path = p
            }
        } else if let current = currentFilePath {
            path = current
        } else {
            let panel = NSSavePanel()
            panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
            panel.nameFieldStringValue = "untitled.md"
            guard panel.runModal() == .OK, let url = panel.url else { return }
            path = url.path
        }

        do {
            // Ensure parent directory exists (e.g. /user/ for imported DOCX files)
            let parentDir = (path as NSString).deletingLastPathComponent
            if !FileManager.default.fileExists(atPath: parentDir) {
                try FileManager.default.createDirectory(atPath: parentDir, withIntermediateDirectories: true)
            }
            try content.write(toFile: path, atomically: true, encoding: .utf8)
            currentFilePath = path
            NSLog("[ChangeDown] Saved to: %@", path)
        } catch {
            NSLog("[ChangeDown] Save failed: %@", error.localizedDescription)
        }
    }
}
