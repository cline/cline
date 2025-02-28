import delay from "delay"
import * as vscode from "vscode"
import { ClineProvider } from "./core/webview/ClineProvider"
import { Logger } from "./services/logging/Logger"
import { createClineAPI } from "./exports"
import "./utils/path" // necessary to have access to String.prototype.toPosix
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import assert from "node:assert"
import { telemetryService } from "./services/telemetry/TelemetryService"

let outputChannel: vscode.OutputChannel

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("Cline")
	context.subscriptions.push(outputChannel)

	Logger.initialize(outputChannel)
	Logger.log("Cline extension activated")

	const sidebarProvider = new ClineProvider(context, outputChannel)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, sidebarProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.plusButtonClicked", async () => {
			Logger.log("Plus button Clicked")
			await sidebarProvider.clearTask()
			await sidebarProvider.postStateToWebview()
			await sidebarProvider.postMessageToWebview({
				type: "action",
				action: "chatButtonClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.mcpButtonClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "mcpButtonClicked",
			})
		}),
	)

	const openClineInNewTab = async () => {
		Logger.log("Opening Cline in new tab")
		const tabProvider = new ClineProvider(context, outputChannel)
		const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

		const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0
		if (!hasVisibleEditors) {
			await vscode.commands.executeCommand("workbench.action.newGroupRight")
			await delay(100)
		}
		const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

		const panel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Cline", targetCol, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
			iconPath: {
				light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_light.png"),
				dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_dark.png"),
			},
		})
		tabProvider.resolveWebviewView(panel)
		await vscode.commands.executeCommand("workbench.action.lockEditorGroup")
	}

	context.subscriptions.push(vscode.commands.registerCommand("cline.popoutButtonClicked", openClineInNewTab))
	context.subscriptions.push(vscode.commands.registerCommand("cline.openInNewTab", openClineInNewTab))

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.settingsButtonClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "settingsButtonClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.historyButtonClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "historyButtonClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.accountLoginClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "accountLoginClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("cline.askFixedQuestion", async () => {
			const fixedQuestion = "What is the weather like today?"
			await sidebarProvider.postMessageToWebview({
				type: "invoke",
				invoke: "sendMessage",
				text: fixedQuestion,
			})
		}),
	)

	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	const handleUri = async (uri: vscode.Uri) => {
		const path = uri.path
		const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
		const visibleProvider = ClineProvider.getVisibleInstance()
		if (!visibleProvider) {
			return
		}
		switch (path) {
			case "/openrouter": {
				const code = query.get("code")
				if (code) {
					await visibleProvider.handleOpenRouterCallback(code)
				}
				break
			}
			case "/auth": {
				const token = query.get("token")
				const state = query.get("state")

				if (!(await visibleProvider.validateAuthState(state))) {
					vscode.window.showErrorMessage("Invalid auth state")
					return
				}

				if (token) {
					await visibleProvider.handleAuthCallback(token)
				}
				break
			}
			default:
				break
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	return createClineAPI(outputChannel, sidebarProvider)
}

export function deactivate() {
	telemetryService.shutdown()
	Logger.log("Cline extension deactivated")
}

const { IS_DEV, DEV_WORKSPACE_FOLDER } = process.env

if (IS_DEV && IS_DEV !== "false") {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	watcher.onDidChange(({ scheme, path }) => {
		console.info(`${scheme} ${path} changed. Reloading VSCode...`)

		vscode.commands.executeCommand("workbench.action.reloadWindow")
	})
}
