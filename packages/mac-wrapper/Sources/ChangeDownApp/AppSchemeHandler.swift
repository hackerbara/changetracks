import WebKit
import UniformTypeIdentifiers

class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    let rootDirectory: String

    init(rootDirectory: String) {
        self.rootDirectory = rootDirectory
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var path = url.path
        if path == "/" || path.isEmpty { path = "/native.html" }

        let filePath = (rootDirectory as NSString).appendingPathComponent(path)

        // SPA fallback: if file doesn't exist, serve native.html
        let actualPath: String
        if FileManager.default.fileExists(atPath: filePath) {
            actualPath = filePath
        } else {
            let fallback = (rootDirectory as NSString).appendingPathComponent("native.html")
            guard FileManager.default.fileExists(atPath: fallback) else {
                task.didFailWithError(URLError(.fileDoesNotExist))
                return
            }
            actualPath = fallback
        }

        guard let data = FileManager.default.contents(atPath: actualPath) else {
            task.didFailWithError(URLError(.cannotOpenFile))
            return
        }

        let mimeType = Self.mimeType(for: actualPath)
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mimeType,
                "Content-Length": "\(data.count)",
                "Access-Control-Allow-Origin": "*",
            ]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        let fallbacks: [String: String] = [
            "mjs": "application/javascript; charset=utf-8",
            "wasm": "application/wasm",
            "map": "application/json; charset=utf-8",
            "woff2": "font/woff2",
            "woff": "font/woff",
            "md": "text/markdown; charset=utf-8",
        ]
        if let fallback = fallbacks[ext] { return fallback }
        if let utType = UTType(filenameExtension: ext),
           let mime = utType.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}
