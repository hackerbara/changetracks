import WebKit
import UniformTypeIdentifiers

class WorkspaceSchemeHandler: NSObject, WKURLSchemeHandler {
    var rootDirectory: String

    init(rootDirectory: String) {
        self.rootDirectory = rootDirectory
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        let path = url.path
        let resolvedPath = ((rootDirectory as NSString).appendingPathComponent(path) as NSString).resolvingSymlinksInPath

        // Security: prevent traversal outside workspace root (resolve symlinks to catch symlink-based escapes)
        let rootResolved = (rootDirectory as NSString).resolvingSymlinksInPath
        guard resolvedPath.hasPrefix(rootResolved) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        // Directory listing
        if url.query == "list" {
            serveListing(task: task, url: url, dirPath: resolvedPath)
            return
        }

        // File read
        guard let data = FileManager.default.contents(atPath: resolvedPath) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Access-Control-Allow-Origin": "*"])!
            task.didReceive(response)
            task.didReceive(Data())
            task.didFinish()
            return
        }

        let mimeType = AppSchemeHandler.mimeType(for: resolvedPath)
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

    private func serveListing(task: WKURLSchemeTask, url: URL, dirPath: String) {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dirPath, isDirectory: &isDir), isDir.boolValue else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let rootResolved = (rootDirectory as NSString).resolvingSymlinksInPath

        var entries: [[String: String]] = []
        if let contents = try? FileManager.default.contentsOfDirectory(
            at: URL(fileURLWithPath: dirPath),
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) {
            for fileURL in contents {
                let resolved = fileURL.resolvingSymlinksInPath().path
                guard resolved.hasPrefix(rootResolved) else { continue }

                let relativePath = String(resolved.dropFirst(rootResolved.count))
                let isDirectory = (try? fileURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                let name = fileURL.lastPathComponent

                entries.append([
                    "name": name,
                    "path": relativePath,
                    "type": isDirectory ? "directory" : "file",
                ])
            }
        }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: entries) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": "\(jsonData.count)",
                "Access-Control-Allow-Origin": "*",
            ]
        )!

        task.didReceive(response)
        task.didReceive(jsonData)
        task.didFinish()
    }
}
