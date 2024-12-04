import * as vscode from "vscode"
import { getTheme } from "../../integrations/theme/getTheme"
import { ExtensionMessage } from "../../shared/ExtensionMessage"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"

export class WebviewManager {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly onMessage: (message: WebviewMessage) => Promise<void>
    ) {}

    getHtmlContent(webview: vscode.Webview): string {
        const stylesUri = getUri(webview, this.context.extensionUri, [
            "webview-ui",
            "build",
            "static",
            "css",
            "main.css",
        ])
        const scriptUri = getUri(webview, this.context.extensionUri, [
            "webview-ui",
            "build",
            "static",
            "js",
            "main.js",
        ])
        const codiconsUri = getUri(webview, this.context.extensionUri, [
            "node_modules",
            "@vscode",
            "codicons",
            "dist",
            "codicon.css",
        ])

        const nonce = getNonce()

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>Cline</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `
    }

    setupMessageListener(webview: vscode.Webview, disposables: vscode.Disposable[]) {
        webview.onDidReceiveMessage(this.onMessage, null, disposables)
    }

    setupVisibilityListener(
        webview: vscode.WebviewView | vscode.WebviewPanel,
        postMessage: (message: ExtensionMessage) => Promise<void>,
        disposables: vscode.Disposable[]
    ) {
        if ("onDidChangeViewState" in webview) {
            webview.onDidChangeViewState(
                () => {
                    if (webview.visible) {
                        postMessage({ type: "action", action: "didBecomeVisible" })
                    }
                },
                null,
                disposables,
            )
        } else if ("onDidChangeVisibility" in webview) {
            webview.onDidChangeVisibility(
                () => {
                    if (webview.visible) {
                        postMessage({ type: "action", action: "didBecomeVisible" })
                    }
                },
                null,
                disposables,
            )
        }
    }

    setupThemeListener(
        postMessage: (message: ExtensionMessage) => Promise<void>,
        disposables: vscode.Disposable[]
    ) {
        vscode.workspace.onDidChangeConfiguration(
            async (e) => {
                if (e && e.affectsConfiguration("workbench.colorTheme")) {
                    await postMessage({ type: "theme", text: JSON.stringify(await getTheme()) })
                }
            },
            null,
            disposables,
        )
    }
}
