import AppKit
import WebKit
import WidgetKit

/// Owns the one WKWebView that runs Tally's web app. It lives as long as the app, not the window,
/// so closing the window keeps Tally running and able to take logs from widgets straight away.
@MainActor
final class WebModel: NSObject {
    static let shared = WebModel()

    let webView: WKWebView
    private let baseURL: URL
    /// The web app has loaded its data and registered `window.tallyNative`.
    private var webReady = false
    private var downloads: [ObjectIdentifier: URL] = [:]

    override init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "TallyURL") as? String ?? ""
        baseURL = URL(string: configured) ?? URL(string: "https://tally-web-kappa.vercel.app")!

        let config = WKWebViewConfiguration()
        // Persistent storage: IndexedDB survives restarts, like a browser profile.
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        config.userContentController.add(WeakMessageHandler(self), name: "tally")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.load(URLRequest(url: baseURL.appendingPathComponent("app")))

        observeWidgetLogs()
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WebModel.shared.deliverPendingLogs() }
        }
    }

    func reload() {
        webReady = false
        webView.load(URLRequest(url: baseURL.appendingPathComponent("app")))
    }

    /// tally://open?tab=plan from a widget: switch tabs without reloading.
    func handle(url: URL) {
        guard url.scheme == "tally" else { return }
        let tab = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "tab" }?.value ?? "home"
        let allowed = ["home", "finances", "plan", "inbox"]
        let hash = allowed.contains(tab) && tab != "home" ? tab : ""
        webView.evaluateJavaScript("location.hash = \"\(hash)\"")
    }

    // MARK: Widget logs

    private func observeWidgetLogs() {
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), observer,
            { _, _, _, _, _ in DispatchQueue.main.async { MainActor.assumeIsolated { WebModel.shared.deliverPendingLogs() } } },
            SharedStore.pendingLogsNotification as CFString, nil, .deliverImmediately)
    }

    /// Hands queued widget logs to the web app. They leave the queue only when the web app confirms
    /// them, and it ignores IDs it already has, so a log is never lost or added twice.
    func deliverPendingLogs() {
        guard webReady else { return }
        let logs = SharedStore.pendingLogs()
        guard !logs.isEmpty, let data = try? JSONEncoder().encode(logs), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.tallyNative && window.tallyNative.receiveLogs(\(json))")
    }

    fileprivate func receive(_ message: WKScriptMessage) {
        // Only Tally's own pages may talk to the bridge.
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == baseURL.host,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            webReady = true
            deliverPendingLogs()
        case "snapshot":
            guard let raw = body["snapshot"], JSONSerialization.isValidJSONObject(raw),
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else { return }
            if SharedStore.save(snapshot) { WidgetCenter.shared.reloadAllTimelines() }
        case "ack":
            let ids = Set(body["ids"] as? [String] ?? [])
            guard !ids.isEmpty else { return }
            SharedStore.updatePendingLogs { $0.removeAll { ids.contains($0.id) } }
            WidgetCenter.shared.reloadAllTimelines()
        default:
            break
        }
    }

    private func showLoadError(_ error: Error) {
        let html = """
        <!doctype html><meta charset="utf-8"><title>Tally</title>
        <style>
          :root { color-scheme: light dark; font: 15px -apple-system, system-ui; }
          body { display: grid; place-items: center; height: 100vh; margin: 0; text-align: center; }
          div { max-width: 360px; } h1 { font-size: 20px; } p { color: GrayText; }
        </style>
        <div><h1>Tally couldn't load</h1>
        <p>Your expenses are safe on this Mac. Check your internet connection, then choose View → Reload (⌘R).</p>
        <p><small>\(error.localizedDescription)</small></p></div>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}

// MARK: - Navigation, file pickers and downloads

extension WebModel: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if navigationAction.shouldPerformDownload { return .download }
        guard let url = navigationAction.request.url else { return .cancel }
        // Links to other sites open in the default browser; Tally's own pages stay in the app.
        if ["http", "https"].contains(url.scheme ?? ""), url.host != baseURL.host {
            NSWorkspace.shared.open(url)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        navigationResponse.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        webReady = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// Backups and CSV exports go to Downloads, without overwriting an existing file.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let name = (suggestedFilename as NSString).deletingPathExtension
        let ext = (suggestedFilename as NSString).pathExtension
        var url = folder.appendingPathComponent(suggestedFilename)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent(ext.isEmpty ? "\(name) \(n)" : "\(name) \(n).\(ext)")
            n += 1
        }
        downloads[ObjectIdentifier(download)] = url
        return url
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        NSAlert(error: error).runModal()
    }

    /// <input type="file"> for Restore and receipt photos.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo) async -> [URL]? {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        return panel.runModal() == .OK ? panel.urls : nil
    }

    /// target="_blank" links open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
}

/// WKUserContentController holds its handlers strongly; this avoids a retain cycle with WebModel.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var model: WebModel?

    init(_ model: WebModel) {
        self.model = model
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { model?.receive(message) }
    }
}
