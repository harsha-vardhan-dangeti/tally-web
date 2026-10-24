import SwiftUI
import WebKit

@main
struct TallyMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Tally", id: "main") {
            WebContainer()
                .frame(minWidth: 420, minHeight: 560)
                .onOpenURL { WebModel.shared.handle(url: $0) }
        }
        .defaultSize(width: 1180, height: 820)
        .commands {
            CommandGroup(after: .toolbar) {
                Button("Reload") { WebModel.shared.reload() }
                    .keyboardShortcut("r")
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Start the web app even if the window is restored later, so widget logs are taken in at once.
        _ = WebModel.shared
    }

    /// Keep running with the window closed: widgets can still log, and Tally adds those logs right away.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

/// Shows the shared web view. The same WKWebView moves into a new window if the old one was closed.
struct WebContainer: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let webView = WebModel.shared.webView
        webView.removeFromSuperview()
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
