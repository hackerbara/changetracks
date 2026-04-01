import AppKit
import WebKit
import UniformTypeIdentifiers

// Simple logging helper that always appears in log stream
private func log(_ message: String) {
    NSLog("[ChangeDown] %@", message)
}

// MARK: - App Entry Point

@main
enum ChangeDownMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var coordinator: WebViewCoordinator!
    private var distPath: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Parse CLI arguments for file path and workspace root
        let (filePath, workspaceRoot) = Self.parseArguments()
        log("Starting, filePath=\(filePath ?? "none"), workspaceRoot=\(workspaceRoot ?? "none")")

        // Create coordinator (handles navigation delegate + JS bridge)
        coordinator = WebViewCoordinator(filePath: filePath, workspaceRoot: workspaceRoot)

        // Create WKWebView with configuration
        let config = WKWebViewConfiguration()

        // Set up message handler for JS -> Swift communication
        let controller = WKUserContentController()
        controller.add(coordinator, name: "changedown")

        // Pre-load CLI file content so the SPA can render it before workspace:// fetch
        if let preloadScript = coordinator.makePreloadScript() {
            controller.addUserScript(preloadScript)
        }

        #if DEBUG
        // Inject error capture BEFORE page loads (atDocumentStart) so we catch
        // errors during SPA initialization, not just after didFinish fires.
        let earlyErrorScript = WKUserScript(source: """
        window.__nativeErrors = [];
        window.addEventListener('error', function(e) {
            window.__nativeErrors.push('ERROR: ' + e.message + ' at ' + (e.filename||'') + ':' + (e.lineno||''));
            try { window.webkit.messageHandlers.changedown.postMessage({action:'log',text:'JS ERROR: '+e.message+' at '+(e.filename||'')+':'+(e.lineno||'')}); } catch(x) {}
        });
        window.addEventListener('unhandledrejection', function(e) {
            var msg = e.reason?.stack || e.reason?.message || e.reason || String(e);
            window.__nativeErrors.push('REJECT: ' + msg);
            try { window.webkit.messageHandlers.changedown.postMessage({action:'log',text:'REJECT: '+msg}); } catch(x) {}
        });
        // Capture console.log and console.warn
        var _origLog = console.log;
        var _origWarn = console.warn;
        console.log = function() {
            var msg = Array.from(arguments).map(function(a) {
                return typeof a === 'object' ? JSON.stringify(a) : String(a);
            }).join(' ');
            try { window.webkit.messageHandlers.changedown.postMessage({action:'log',text:'LOG: '+msg}); } catch(x) {}
            _origLog.apply(console, arguments);
        };
        console.warn = function() {
            var msg = Array.from(arguments).map(function(a) {
                return typeof a === 'object' ? JSON.stringify(a) : String(a);
            }).join(' ');
            try { window.webkit.messageHandlers.changedown.postMessage({action:'log',text:'WARN: '+msg}); } catch(x) {}
            _origWarn.apply(console, arguments);
        };
        var _origFetch = window.fetch;
        window.fetch = function() {
            var url = arguments[0];
            if (typeof url === 'string' && url.includes('content')) {
                return _origFetch.apply(this, arguments).then(function(resp) {
                    try { window.webkit.messageHandlers.changedown.postMessage({action:'log',text:'FETCH ' + resp.status + ' ' + url}); } catch(x) {}
                    return resp;
                }).catch(function(err) {
                    try { window.webkit.messageHandlers.changedown.postMessage({action:'log',text:'FETCH FAIL ' + url + ': ' + err}); } catch(x) {}
                    throw err;
                });
            }
            return _origFetch.apply(this, arguments);
        };
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        controller.addUserScript(earlyErrorScript)
        #endif

        config.userContentController = controller

        // Register URL scheme handlers
        distPath = findDistDirectory()
        if let distPath {
            let appHandler = AppSchemeHandler(rootDirectory: distPath)
            config.setURLSchemeHandler(appHandler, forURLScheme: "app")
        }

        // Always register workspace:// — use workspace root if provided, else dist/content/
        // so only the welcome file is visible (not internal assets like main.js, lsp-worker, etc.)
        let wsPath: String
        if let root = workspaceRoot {
            wsPath = root
        } else if let dist = distPath {
            wsPath = (dist as NSString).appendingPathComponent("content")
        } else {
            wsPath = FileManager.default.currentDirectoryPath
        }
        let wsHandler = WorkspaceSchemeHandler(rootDirectory: wsPath)
        config.setURLSchemeHandler(wsHandler, forURLScheme: "workspace")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        coordinator.webView = webView

        #if DEBUG
        webView.isInspectable = true
        #endif

        // Create the window
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let windowWidth: CGFloat = min(1200, screenRect.width * 0.8)
        let windowHeight: CGFloat = min(800, screenRect.height * 0.8)
        let windowX = screenRect.midX - windowWidth / 2
        let windowY = screenRect.midY - windowHeight / 2

        window = NSWindow(
            contentRect: NSRect(x: windowX, y: windowY, width: windowWidth, height: windowHeight),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "ChangeDown"
        window.minSize = NSSize(width: 600, height: 400)
        window.contentView = webView
        window.isReleasedWhenClosed = false

        // Set up File menu with Open
        setupMenuBar()

        // Show window immediately — native.html has pre-rendered content with
        // inline critical CSS, so it looks correct before JS hydrates.
        // Load the SPA, then show window once first paint is ready.
        loadWebApp()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    // MARK: - Menu Bar

    private func setupMenuBar() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About ChangeDown", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit ChangeDown", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // File menu
        let fileMenuItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(NSMenuItem(title: "Open...", action: #selector(openFile(_:)), keyEquivalent: "o"))
        fileMenu.addItem(NSMenuItem(title: "Save", action: #selector(saveFile(_:)), keyEquivalent: "s"))
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        // Edit menu (for copy/paste to work in WKWebView)
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View menu
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r"))
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Menu Actions

    @objc func openFile(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [
            UTType.plainText,
            UTType(filenameExtension: "md") ?? .plainText,
        ]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        coordinator.injectFile(atPath: url.path)
    }

    @objc func saveFile(_ sender: Any?) {
        coordinator.requestSaveFromJS()
    }

    @objc func reloadPage(_ sender: Any?) {
        webView.reload()
    }

    // MARK: - Load Web App

    private func loadWebApp() {
        // Load via app:// scheme handler (production path)
        if distPath != nil {
            let url = URL(string: "app://localhost/native.html")!
            log("Loading via scheme handler: \(url)")
            webView.load(URLRequest(url: url))
            return
        }

        // Fallback: show an error page
        let candidates = distCandidates()
        log("ERROR: Could not find website-v2/dist/native.html")
        let errorHTML = """
        <html><body style="background:#18181b;color:#e4e4e7;font-family:system-ui;padding:2rem;">
        <h1>Build not found</h1>
        <p>Could not locate <code>website-v2/dist/native.html</code>.</p>
        <p>Run <code>cd website-v2 && npm run build</code> first.</p>
        <p>Searched:</p><ul>
        \(candidates.map { "<li><code>\($0)</code></li>" }.joined())
        </ul>
        </body></html>
        """
        webView.loadHTMLString(errorHTML, baseURL: nil)
    }

    private func findDistDirectory() -> String? {
        // Only match directories containing native.html (the native SPA build).
        // website-v2/dist has index.html (Astro build) but NOT native.html —
        // using that directory causes -1100 because the scheme handler can't
        // find native.html to serve.
        for candidate in distCandidates() {
            let nativePath = (candidate as NSString).appendingPathComponent("native.html")
            if FileManager.default.fileExists(atPath: nativePath) {
                return candidate
            }
        }
        return nil
    }

    /// Return candidate paths for the website-v2/dist directory
    private func distCandidates() -> [String] {
        var candidates: [String] = []

        // 1. Environment variable override
        if let envPath = ProcessInfo.processInfo.environment["CHANGEDOWN_DIST"] {
            candidates.append(envPath)
        }

        // 2. Inside .app bundle (Contents/Resources/dist/)
        if let resourcePath = Bundle.main.resourcePath {
            candidates.append((resourcePath as NSString).appendingPathComponent("dist"))
        }

        // 3. Relative to executable -- resolve symlinks so ~/.local/bin/changedown-app works
        let rawExecURL = URL(fileURLWithPath: CommandLine.arguments[0])
        let executableURL = rawExecURL.resolvingSymlinksInPath()
        let execDir = executableURL.deletingLastPathComponent().path

        // From .build/arm64-apple-macosx/debug/ up to packages/mac-wrapper/dist
        let fromBuildToWrapper = (execDir as NSString)
            .appendingPathComponent("../../../../../packages/mac-wrapper/dist")
        candidates.append((fromBuildToWrapper as NSString).standardizingPath)

        // From .build/arm64-apple-macosx/debug/ up to repo root, then into website-v2/dist
        let fromBuildToWebsite = (execDir as NSString)
            .appendingPathComponent("../../../../../website-v2/dist")
        candidates.append((fromBuildToWebsite as NSString).standardizingPath)

        // 4. Relative to CWD
        let cwd = FileManager.default.currentDirectoryPath
        // mac-wrapper/dist (when running from packages/mac-wrapper/)
        candidates.append(((cwd as NSString).appendingPathComponent("dist") as NSString).standardizingPath)
        candidates.append(((cwd as NSString).appendingPathComponent("../../website-v2/dist") as NSString).standardizingPath)
        candidates.append(((cwd as NSString).appendingPathComponent("website-v2/dist") as NSString).standardizingPath)

        // 5. Hardcoded development paths
        candidates.append("/Users/MAC/Coding/changetracks/packages/mac-wrapper/dist")
        candidates.append("/Users/MAC/Coding/changetracks/website-v2/dist")

        return candidates
    }

    // MARK: - CLI Argument Parsing

    /// Parse CLI arguments to determine file path and workspace root.
    /// - File argument -> filePath=file, workspaceRoot=parent directory
    /// - Directory argument -> filePath=nil, workspaceRoot=directory
    /// - No argument -> filePath=nil, workspaceRoot=nil
    static func parseArguments() -> (filePath: String?, workspaceRoot: String?) {
        let args = CommandLine.arguments.dropFirst()
        let fm = FileManager.default

        for arg in args {
            if arg.hasPrefix("-") { continue }

            // Resolve relative paths against CWD
            let resolved: String
            if arg.hasPrefix("/") {
                resolved = arg
            } else {
                resolved = (fm.currentDirectoryPath as NSString).appendingPathComponent(arg)
            }

            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: resolved, isDirectory: &isDir) else { continue }

            if isDir.boolValue {
                // Directory argument: workspace root, no specific file
                return (filePath: nil, workspaceRoot: resolved)
            } else {
                // File argument: open file, workspace root is parent directory
                let parent = (resolved as NSString).deletingLastPathComponent
                return (filePath: resolved, workspaceRoot: parent)
            }
        }

        return (filePath: nil, workspaceRoot: nil)
    }
}
