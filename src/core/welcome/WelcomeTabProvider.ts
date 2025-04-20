import * as vscode from "vscode"
import * as path from "path"
import { Logger } from "../../services/logging/Logger"
import { getUri } from "../webview/getUri"

export class WelcomeTabProvider {
	private static readonly WELCOME_TAB_SHOWN_KEY = "cline.welcomeTabShown"

	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Shows the welcome tab if it hasn't been shown before and is enabled in settings
	 */
	public async showWelcomeTabIfNeeded(): Promise<void> {
		// Check if we've already shown the welcome tab
		const hasShownWelcomeTab = this.context.globalState.get<boolean>(WelcomeTabProvider.WELCOME_TAB_SHOWN_KEY, false)

		// Check if showing the welcome tab on install is enabled in settings
		const showWelcomeTabOnInstall = vscode.workspace.getConfiguration("cline").get<boolean>("showWelcomeTabOnInstall", true)

		if (!hasShownWelcomeTab && showWelcomeTabOnInstall) {
			await this.showWelcomeTab()
			// Mark that we've shown the welcome tab
			await this.context.globalState.update(WelcomeTabProvider.WELCOME_TAB_SHOWN_KEY, true)
		}
	}

	/**
	 * Shows the welcome tab
	 */
	public async showWelcomeTab(): Promise<vscode.WebviewPanel> {
		Logger.log("Showing welcome tab")

		// Create and show the webview panel
		const panel = vscode.window.createWebviewPanel(
			"clineWelcomeTab", // Unique ID
			"Welcome to Cline", // Title displayed in the tab
			vscode.ViewColumn.One, // Show in the first column
			{
				enableScripts: true,
				localResourceRoots: [this.context.extensionUri],
			},
		)

		// Set the icon for the tab
		panel.iconPath = {
			light: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "robot_panel_light.png"),
			dark: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "robot_panel_dark.png"),
		}

		// Get the content of the welcome tab
		panel.webview.html = await this.getWelcomeTabContent(panel.webview)

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			(message) => {
				switch (message.command) {
					case "openCline":
						// Open Cline when the button is clicked
						vscode.commands.executeCommand("cline.openInNewTab")
						return
				}
			},
			undefined,
			this.context.subscriptions,
		)

		return panel
	}

	/**
	 * Gets the HTML content for the welcome tab
	 */
	private async getWelcomeTabContent(webview: vscode.Webview): Promise<string> {
		// Get the path to the welcome tab HTML file
		const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "src", "assets", "welcome-tab.html")

		// Read the HTML file
		const htmlContent = await vscode.workspace.fs.readFile(htmlPath)
		let htmlString = Buffer.from(htmlContent).toString("utf-8")

		// Get the base path for assets
		const assetsPath = vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "src", "assets")

		// Convert resource paths to webview URIs
		const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, "css", "styles.css"))
		const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, "js", "script.js"))

		// Replace CSS and JS paths
		htmlString = htmlString.replace("css/styles.css", cssUri.toString())
		htmlString = htmlString.replace("js/script.js", jsUri.toString())

		// Replace image paths
		const imageFiles = [
			"back-icon.svg",
			"vector.svg",
			"vector-1.svg",
			"feature-icon-1.svg",
			"feature-icon-2.svg",
			"feature-icon-3.svg",
			"feature-icon-4.svg",
			"action-icon-1.svg",
			"action-icon-2.svg",
			"button-icon-1.svg",
			"anthropic-model.jpg",
			"google-model.jpg",
			"meta-model.jpg",
			"feature-bg.png",
			"50.svg",
		]

		for (const imageFile of imageFiles) {
			const imageUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, "images", imageFile))
			htmlString = htmlString.replace(`images/${imageFile}`, imageUri.toString())
		}

		// Add Content Security Policy
		const csp = `
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
    style-src ${webview.cspSource} https://fonts.googleapis.com; 
    font-src ${webview.cspSource} https://fonts.googleapis.com https://fonts.gstatic.com; 
    img-src ${webview.cspSource} https: data:; 
    script-src ${webview.cspSource};">
  `

		// Insert CSP meta tag into the head section
		htmlString = htmlString.replace("</head>", `${csp}</head>`)

		// Get the logo path (if needed)
		const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "icon.png"))

		// Replace the placeholder with the actual logo path (if needed)
		htmlString = htmlString.replace("{{logoPath}}", logoUri.toString())

		return htmlString
	}
}
