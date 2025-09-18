// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import assert from "node:assert"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { DIFF_VIEW_URI_SCHEME } from "@hosts/vscode/VscodeDiffViewProvider"
import { WebviewProviderType as WebviewProviderTypeEnum } from "@shared/proto/cline/ui"
import * as vscode from "vscode"
import { sendAccountButtonClickedEvent } from "./core/controller/ui/subscribeToAccountButtonClicked"
import { sendChatButtonClickedEvent } from "./core/controller/ui/subscribeToChatButtonClicked"
import { sendHistoryButtonClickedEvent } from "./core/controller/ui/subscribeToHistoryButtonClicked"
import { sendMcpButtonClickedEvent } from "./core/controller/ui/subscribeToMcpButtonClicked"
import { sendSettingsButtonClickedEvent } from "./core/controller/ui/subscribeToSettingsButtonClicked"
import { WebviewProvider } from "./core/webview"
import { createClineAPI } from "./exports"
import { Logger } from "./services/logging/Logger"
import { cleanupTestMode, initializeTestMode } from "./services/test/TestMode"
import { WebviewProviderType } from "./shared/webview/types"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import path from "node:path"
import type { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"
import { readTextFromClipboard, writeTextToClipboard } from "@/utils/env"
import { initialize, tearDown } from "./common"
import { addToCline } from "./core/controller/commands/addToCline"
import { explainWithCline } from "./core/controller/commands/explainWithCline"
import { fixWithCline } from "./core/controller/commands/fixWithCline"
import { improveWithCline } from "./core/controller/commands/improveWithCline"
import { sendAddToInputEvent } from "./core/controller/ui/subscribeToAddToInput"
import { sendFocusChatInputEvent } from "./core/controller/ui/subscribeToFocusChatInput"
import { workspaceResolver } from "./core/workspace"
import { focusChatInput, getContextForCommand } from "./hosts/vscode/commandUtils"
import { VscodeDiffViewProvider } from "./hosts/vscode/VscodeDiffViewProvider"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider"
import { GitCommitGenerator } from "./integrations/git/commit-message-generator"
import { ExtensionRegistryInfo } from "./registry"
import { AuthService } from "./services/auth/AuthService"
import { telemetryService } from "./services/telemetry"
import { SharedUriHandler } from "./services/uri/SharedUriHandler"
import { ShowMessageType } from "./shared/proto/host/window"
import { fileExistsAtPath } from "./utils/fs"
/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	setupHostProvider(context)

	const sidebarWebview = (await initialize(context)) as VscodeWebviewProvider

	Logger.log("Cline extension activated")

	const testModeWatchers = await initializeTestMode(sidebarWebview)
	// Initialize test mode and add disposables to context
	context.subscriptions.push(...testModeWatchers)

	vscode.commands.executeCommand("setContext", "cline.isDevMode", IS_DEV && IS_DEV === "true")

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VscodeWebviewProvider.SIDEBAR_ID, sidebarWebview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	const { commands } = ExtensionRegistryInfo

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.PlusButton, async (webview: any) => {
			console.log("[DEBUG] plusButtonClicked", webview)
			// Pass the webview type to the event sender
			const isSidebar = !webview

			const openChat = async (instance: WebviewProvider) => {
				await instance?.controller.clearTask()
				await instance?.controller.postStateToWebview()
				await sendChatButtonClickedEvent(instance.controller.id)
			}

			if (isSidebar) {
				const sidebarInstance = WebviewProvider.getSidebarInstance()
				if (sidebarInstance) {
					openChat(sidebarInstance)
					// Send event to the sidebar instance
				}
			} else {
				const tabInstances = WebviewProvider.getTabInstances()
				for (const instance of tabInstances) {
					openChat(instance)
				}
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.McpButton, (webview: any) => {
			console.log("[DEBUG] mcpButtonClicked", webview)

			const activeInstance = WebviewProvider.getActiveInstance()
			const isSidebar = !webview

			if (isSidebar) {
				const sidebarInstance = WebviewProvider.getSidebarInstance()
				const sidebarInstanceId = sidebarInstance?.getClientId()
				if (sidebarInstanceId) {
					sendMcpButtonClickedEvent(sidebarInstanceId)
				} else {
					console.error("[DEBUG] No sidebar instance found, cannot send MCP button event")
				}
			} else {
				const activeInstanceId = activeInstance?.getClientId()
				if (activeInstanceId) {
					sendMcpButtonClickedEvent(activeInstanceId)
				} else {
					console.error("[DEBUG] No active instance found, cannot send MCP button event")
				}
			}
		}),
	)

	const openClineInNewTab = async () => {
		Logger.log("Opening Cline in new tab")
		// (this example uses webviewProvider activation event which is necessary to deserialize cached webview, but since we use retainContextWhenHidden, we don't need to use that event)
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
		const tabWebview = HostProvider.get().createWebviewProvider(WebviewProviderType.TAB) as VscodeWebviewProvider
		const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

		// Check if there are any visible text editors, otherwise open a new group to the right
		const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0
		if (!hasVisibleEditors) {
			await vscode.commands.executeCommand("workbench.action.newGroupRight")
		}
		const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

		const panel = vscode.window.createWebviewPanel(VscodeWebviewProvider.TAB_PANEL_ID, "Cline", targetCol, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		})
		// TODO: use better svg icon with light and dark variants (see https://stackoverflow.com/questions/58365687/vscode-extension-iconpath)

		panel.iconPath = {
			light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_light.png"),
			dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_dark.png"),
		}
		tabWebview.resolveWebviewView(panel)

		// Lock the editor group so clicking on files doesn't open them over the panel
		await setTimeoutPromise(100)
		await vscode.commands.executeCommand("workbench.action.lockEditorGroup")
		return tabWebview
	}

	context.subscriptions.push(vscode.commands.registerCommand(commands.PopoutButton, openClineInNewTab))
	context.subscriptions.push(vscode.commands.registerCommand(commands.OpenInNewTab, openClineInNewTab))

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.SettingsButton, (webview: any) => {
			const isSidebar = !webview
			const webviewType = isSidebar ? WebviewProviderTypeEnum.SIDEBAR : WebviewProviderTypeEnum.TAB

			sendSettingsButtonClickedEvent(webviewType)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.HistoryButton, async (webview: any) => {
			console.log("[DEBUG] historyButtonClicked", webview)
			// Pass the webview type to the event sender
			const isSidebar = !webview
			const webviewType = isSidebar ? WebviewProviderTypeEnum.SIDEBAR : WebviewProviderTypeEnum.TAB

			// Send event to all subscribers using the gRPC streaming method
			await sendHistoryButtonClickedEvent(webviewType)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AccountButton, (webview: any) => {
			console.log("[DEBUG] accountButtonClicked", webview)

			const isSidebar = !webview
			if (isSidebar) {
				const sidebarInstance = WebviewProvider.getSidebarInstance()
				if (sidebarInstance) {
					// Send event to sidebar controller
					sendAccountButtonClickedEvent(sidebarInstance.controller.id)
				}
			} else {
				// Send to all tab instances
				const tabInstances = WebviewProvider.getTabInstances()
				for (const instance of tabInstances) {
					sendAccountButtonClickedEvent(instance.controller.id)
				}
			}
		}),
	)

	/*
	We use the text document content provider API to show the left side for diff view by creating a 
	virtual document for the original content. This makes it readonly so users know to edit the right 
	side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by 
	claiming an uri-scheme for which your provider then returns text contents. The scheme must be 
	provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents
	 given such an uri. In return, content providers are wired into the open document logic so that 
	 providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	const handleUri = async (uri: vscode.Uri) => {
		const url = decodeURIComponent(uri.toString())
		const success = await SharedUriHandler.handleUri(url)
		if (!success) {
			console.warn("Extension URI handler: Failed to process URI:", uri.toString())
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register size testing commands in development mode
	if (IS_DEV && IS_DEV === "true") {
		// Use dynamic import to avoid loading the module in production
		import("./dev/commands/tasks")
			.then((module) => {
				const devTaskCommands = module.registerTaskCommands(context, sidebarWebview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("Cline dev task commands registered")
			})
			.catch((error) => {
				Logger.log("Failed to register dev task commands: " + error)
			})
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.TerminalOutput, async () => {
			const terminal = vscode.window.activeTerminal
			if (!terminal) {
				return
			}

			// Save current clipboard content
			const tempCopyBuffer = await readTextFromClipboard()

			try {
				// Copy the *existing* terminal selection (without selecting all)
				await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

				// Get copied content
				const terminalContents = (await readTextFromClipboard()).trim()

				// Restore original clipboard content
				await writeTextToClipboard(tempCopyBuffer)

				if (!terminalContents) {
					// No terminal content was copied (either nothing selected or some error)
					return
				}
				// Ensure the sidebar view is visible
				await focusChatInput()

				await sendAddToInputEvent(`Terminal output:\n\`\`\`\n${terminalContents}\n\`\`\``)

				console.log("addSelectedTerminalOutputToChat", terminalContents, terminal.name)
			} catch (error) {
				// Ensure clipboard is restored even if an error occurs
				await writeTextToClipboard(tempCopyBuffer)
				console.error("Error getting terminal contents:", error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Failed to get terminal contents",
				})
			}
		}),
	)

	// Register code action provider
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			"*",
			new (class implements vscode.CodeActionProvider {
				public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor]

				provideCodeActions(
					document: vscode.TextDocument,
					range: vscode.Range,
					context: vscode.CodeActionContext,
				): vscode.CodeAction[] {
					const CONTEXT_LINES_TO_EXPAND = 3
					const START_OF_LINE_CHAR_INDEX = 0
					const LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING = 1

					const actions: vscode.CodeAction[] = []
					const editor = vscode.window.activeTextEditor // Get active editor for selection check

					// Expand range to include surrounding 3 lines or use selection if broader
					const selection = editor?.selection
					let expandedRange = range
					if (
						editor &&
						selection &&
						!selection.isEmpty &&
						selection.contains(range.start) &&
						selection.contains(range.end)
					) {
						expandedRange = selection
					} else {
						expandedRange = new vscode.Range(
							Math.max(0, range.start.line - CONTEXT_LINES_TO_EXPAND),
							START_OF_LINE_CHAR_INDEX,
							Math.min(
								document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
								range.end.line + CONTEXT_LINES_TO_EXPAND,
							),
							document.lineAt(
								Math.min(
									document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
									range.end.line + CONTEXT_LINES_TO_EXPAND,
								),
							).text.length,
						)
					}

					// Add to Cline (Always available)
					const addAction = new vscode.CodeAction("Add to Cline", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: commands.AddToChat,
						title: "Add to Cline",
						arguments: [expandedRange, context.diagnostics],
					}
					actions.push(addAction)

					// Explain with Cline (Always available)
					const explainAction = new vscode.CodeAction("Explain with Cline", vscode.CodeActionKind.RefactorExtract) // Using a refactor kind
					explainAction.command = {
						command: commands.ExplainCode,
						title: "Explain with Cline",
						arguments: [expandedRange],
					}
					actions.push(explainAction)

					// Improve with Cline (Always available)
					const improveAction = new vscode.CodeAction("Improve with Cline", vscode.CodeActionKind.RefactorRewrite) // Using a refactor kind
					improveAction.command = {
						command: commands.ImproveCode,
						title: "Improve with Cline",
						arguments: [expandedRange],
					}
					actions.push(improveAction)

					// Fix with Cline (Only if diagnostics exist)
					if (context.diagnostics.length > 0) {
						const fixAction = new vscode.CodeAction("Fix with Cline", vscode.CodeActionKind.QuickFix)
						fixAction.isPreferred = true
						fixAction.command = {
							command: commands.FixWithCline,
							title: "Fix with Cline",
							arguments: [expandedRange, context.diagnostics],
						}
						actions.push(fixAction)
					}
					return actions
				}
			})(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.RefactorExtract,
					vscode.CodeActionKind.RefactorRewrite,
				],
			},
		),
	)

	// Register the command handlers
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AddToChat, async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await addToCline(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FixWithCline, async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await fixWithCline(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ExplainCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await explainWithCline(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ImproveCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await improveWithCline(context.controller, context.commandContext)
		}),
	)

	// Register the focusChatInput command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FocusChatInput, async () => {
			// Fast path: check for existing active instance
			let activeWebview = WebviewProvider.getLastActiveInstance() as VscodeWebviewProvider

			if (activeWebview) {
				// Instance exists - just reveal and focus it
				const webview = activeWebview.getWebview()
				if (webview) {
					if (webview && "reveal" in webview) {
						webview.reveal()
					} else if ("show" in webview) {
						webview.show()
					}
				}
			} else {
				// No active instance - need to find or create one
				WebviewProvider.setLastActiveControllerId(null)

				// Check for existing tab instances first (cheaper than focusing sidebar)
				const tabInstances = WebviewProvider.getTabInstances() as VscodeWebviewProvider[]
				if (tabInstances.length > 0) {
					activeWebview = tabInstances[tabInstances.length - 1]
				} else {
					// Try to focus sidebar via hostbridge
					await HostProvider.workspace.openClineSidebarPanel({})

					// Small delay for focus to complete
					await new Promise((resolve) => setTimeout(resolve, 200))
					activeWebview = WebviewProvider.getSidebarInstance() as VscodeWebviewProvider
					if (!activeWebview) {
						// Last resort: create new tab
						activeWebview = (await openClineInNewTab()) as VscodeWebviewProvider
					}
				}
			}

			// Send focus event
			const clientId = activeWebview?.getClientId()
			if (!clientId) {
				console.error("FocusChatInput: Could not find or activate a Cline webview to focus.")
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Could not activate Cline view. Please try opening it manually from the Activity Bar.",
				})
				return
			}

			sendFocusChatInputEvent(clientId)
			telemetryService.captureButtonClick("command_focusChatInput", activeWebview.controller?.task?.ulid)
		}),
	)

	// Register the openWalkthrough command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.Walkthrough, async () => {
			await vscode.commands.executeCommand("workbench.action.openWalkthrough", `${context.extension.id}#ClineWalkthrough`)
			telemetryService.captureButtonClick("command_openWalkthrough")
		}),
	)

	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GenerateCommit, async (scm) => {
			await GitCommitGenerator?.generate?.(context, scm)
		}),
		vscode.commands.registerCommand(commands.AbortCommit, () => {
			GitCommitGenerator?.abort?.()
		}),
	)

	context.subscriptions.push(
		context.secrets.onDidChange(async (event) => {
			if (event.key === "clineAccountId") {
				// Check if the secret was removed (logout) or added/updated (login)
				const secretValue = await context.secrets.get("clineAccountId")
				const activeWebviewProvider = WebviewProvider.getVisibleInstance()
				const controller = activeWebviewProvider?.controller

				const authService = AuthService.getInstance(controller)
				if (secretValue) {
					// Secret was added or updated - restore auth info (login from another window)
					authService?.restoreRefreshTokenAndRetrieveAuthInfo()
				} else {
					// Secret was removed - handle logout for all windows
					authService?.handleDeauth()
				}
			}
		}),
	)

	return createClineAPI(sidebarWebview.controller)
}

function setupHostProvider(context: ExtensionContext) {
	console.log("Setting up vscode host providers...")

	const createWebview = (type: WebviewProviderType) => new VscodeWebviewProvider(context, type)
	const createDiffView = () => new VscodeDiffViewProvider()
	const outputChannel = vscode.window.createOutputChannel("Cline")
	context.subscriptions.push(outputChannel)

	const getCallbackUrl = async () => `${vscode.env.uriScheme || "vscode"}://${context.extension.id}`
	HostProvider.initialize(
		createWebview,
		createDiffView,
		vscodeHostBridgeClient,
		outputChannel.appendLine,
		getCallbackUrl,
		getBinaryLocation,
		context.extensionUri.fsPath,
		context.globalStorageUri.fsPath,
	)
}

async function getBinaryLocation(name: string): Promise<string> {
	// The only binary currently supported is the rg binary from the VSCode installation.
	if (!name.startsWith("rg")) {
		throw new Error(`Binary '${name}' is not supported`)
	}

	const checkPath = async (pkgFolder: string) => {
		const fullPathResult = workspaceResolver.resolveWorkspacePath(
			vscode.env.appRoot,
			path.join(pkgFolder, name),
			"Services.ripgrep.getBinPath",
		)
		const fullPath = typeof fullPathResult === "string" ? fullPathResult : fullPathResult.absolutePath
		return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
	}

	const binPath =
		(await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
		(await checkPath("node_modules/vscode-ripgrep/bin")) ||
		(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
		(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/"))
	if (!binPath) {
		throw new Error("Could not find ripgrep binary")
	}
	return binPath
}

// This method is called when your extension is deactivated
export async function deactivate() {
	tearDown()

	// Clean up test mode
	cleanupTestMode()

	Logger.log("Cline extension deactivated")
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const IS_DEV = process.env.IS_DEV
const DEV_WORKSPACE_FOLDER = process.env.DEV_WORKSPACE_FOLDER

// Set up development mode file watcher
if (IS_DEV && IS_DEV !== "false") {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	watcher.onDidChange(({ scheme, path }) => {
		console.info(`${scheme} ${path} changed. Reloading VSCode...`)

		vscode.commands.executeCommand("workbench.action.reloadWindow")
	})
}
