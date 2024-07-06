import { getUri } from "../utilities/getUri"
import { getNonce } from "../utilities/getNonce"
//import * as weather from "weather-js"
import * as vscode from "vscode"

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "vscodeSidebar.openview"

	private _view?: vscode.WebviewView

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext<unknown>,
		token: vscode.CancellationToken
	): void | Thenable<void> {
		this._view = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		}
		webviewView.webview.html = this.getHtmlContent(webviewView.webview)
	}

	private getHtmlContent(webview: vscode.Webview): string {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.js"))

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "reset.css"))
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "vscode.css"))

		// Same for stylesheet
		const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.css"))

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce()

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

        

				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				
        <link href="${stylesheetUri}" rel="stylesheet">
				
			</head>

			<body>
			<section class="wrapper">
      <div class="container">
            <div class="content">
                <h2 class="subtitle">Subscribe today</h2>
                <input type="text" class="mail" placeholder="Your email address" name="mail" required>
                
                <button class="add-color-button">Subscribe</button>
                
                <p class="text">We won’t send you spam.</p>
                <p class="text">Unsubscribe at any time.</p>
                
            </div>
      </div>
			</section>
			<!--<script nonce="${nonce}" src="${scriptUri}"></script>-->
      </body>

			</html>`
	}
}
