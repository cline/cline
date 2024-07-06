/*
Example of vscode-webview-ui-toolkit
https://github.com/microsoft/vscode-webview-ui-toolkit/blob/main/docs/getting-started.md
https://github.com/microsoft/vscode-webview-ui-toolkit/blob/main/docs/components.md
*/


import * as vscode from "vscode"
import { getUri } from "./utilities/getUri"
import { getNonce } from "./utilities/getNonce"

export class HelloWorldPanel {
	/*
    - public can be access outside of class
    - private can only be accessed by class itself (_ is a convention not required)
    - readonly means var can only be set during declaration or in constructor
    - static means var is shared among all instances of class
    */
	public static currentPanel: HelloWorldPanel | undefined
	private readonly panel: vscode.WebviewPanel
	private disposables: vscode.Disposable[] = []

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel

		// the method can be triggered when the webview panel is closed
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

		this.panel.webview.html = this.getWebviewContent(this.panel.webview, extensionUri)
		this.setWebviewMessageListener(this.panel.webview);
	}

	// This will be responsible for rendering the current webview panel – if it exists – or creating and displaying a new webview panel.
	public static render(extensionUri: vscode.Uri) {
		if (HelloWorldPanel.currentPanel) {
			HelloWorldPanel.currentPanel.panel.reveal(vscode.ViewColumn.One)
		} else {
			const panel = vscode.window.createWebviewPanel("helloworld", "Hello World", vscode.ViewColumn.One, {
				// Enable javascript in the webview
				enableScripts: true,
				// Restrict the webview to only load resources from the `out` directory
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
			})

			HelloWorldPanel.currentPanel = new HelloWorldPanel(panel, extensionUri)
		}
	}

	// webview resources are cleaned up when the webview panel is closed by the user or closed programmatically.
	public dispose() {
		HelloWorldPanel.currentPanel = undefined

		this.panel.dispose()

		while (this.disposables.length) {
			const disposable = this.disposables.pop()
			if (disposable) {
				disposable.dispose()
			}
		}
	}

	// where the UI of the extension will be defined. This is also where references to CSS and JavaScript files are created and inserted into the webview HTML.
	private getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
		const webviewUri = getUri(webview, extensionUri, ["dist", "webview.js"])
		/*
        content security policy of your webview to only allow scripts that have a specific nonce
        create a content security policy meta tag so that only loading scripts with a nonce is allowed
        As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicity allow for these resources. E.g.
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">


        in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
        */
		const nonce = getNonce()

		return /*html*/ `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';">
              <title>Hello World!</title>
            </head>
            <body>
              <h1>Hello World!</h1>
              <vscode-button id="howdy">Howdy!</vscode-button>
              <script type="module" nonce="${nonce}" src="${webviewUri}"></script>
            </body>
          </html>
        `
	}

	// responsible for setting up an event listener that listens for messages passed from the webview context and executes code based on the received message.
	private setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(
			(message: any) => {
				const command = message.command
				const text = message.text

				switch (command) {
					case "hello":
						vscode.window.showInformationMessage(text)
						return
				}
			},
			undefined,
			this.disposables
		)
	}
}
