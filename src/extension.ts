// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import assert from "node:assert"
import { DIFF_VIEW_URI_SCHEME } from "@hosts/vscode/VscodeDiffViewProvider"
import * as vscode from "vscode"
import { previewHtml } from "./core/controller/htmlPreview/previewHtml"
import { loadGeojsonCommand } from "./core/controller/map/loadGeojsonCommand"
import { sendChatButtonClickedEvent } from "./core/controller/ui/subscribeToChatButtonClicked"
import { sendConnectorsButtonClickedEvent } from "./core/controller/ui/subscribeToConnectorsButtonClicked"
import { sendHistoryButtonClickedEvent } from "./core/controller/ui/subscribeToHistoryButtonClicked"
import { sendMcpButtonClickedEvent } from "./core/controller/ui/subscribeToMcpButtonClicked"
import { sendSettingsButtonClickedEvent } from "./core/controller/ui/subscribeToSettingsButtonClicked"
import { WebviewProvider } from "./core/webview"
import { createAiHydroAPI } from "./exports"
import { VscodeHtmlPreviewProvider } from "./hosts/vscode/VscodeHtmlPreviewProvider"
import { VscodeMapPanelProvider } from "./hosts/vscode/VscodeMapPanelProvider"
import { GeeService } from "./services/gee/GeeService"
import { GeeTileProxyService } from "./services/gee/GeeTileProxyService"
import type { GeeProjectInfo, GeeStatusResult } from "./services/gee/types"
import { Logger } from "./services/logging/Logger"
import { cleanupTestMode, initializeTestMode } from "./services/test/TestMode"
import { PreviewHtmlRequest } from "./shared/proto/cline/html_preview"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import path from "node:path"
import type { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"
import { readTextFromClipboard, writeTextToClipboard } from "@/utils/env"
import { initialize, tearDown } from "./common"
import { addToAiHydro } from "./core/controller/commands/addToAiHydro"
import { explainWithAiHydro } from "./core/controller/commands/explainWithAiHydro"
import { fixWithAiHydro } from "./core/controller/commands/fixWithAiHydro"
import { improveWithAiHydro } from "./core/controller/commands/improveWithAiHydro"
import { sendAddToInputEvent } from "./core/controller/ui/subscribeToAddToInput"
import { sendFocusChatInputEvent } from "./core/controller/ui/subscribeToFocusChatInput"
import { workspaceResolver } from "./core/workspace"
import { focusChatInput, getContextForCommand } from "./hosts/vscode/commandUtils"
import { abortCommitGeneration, generateCommitMessage } from "./hosts/vscode/commit-message-generator"
import { VscodeDiffViewProvider } from "./hosts/vscode/VscodeDiffViewProvider"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider"
import { ExtensionRegistryInfo } from "./registry"
import { AuthService } from "./services/auth/AuthService"
import { LogoutReason } from "./services/auth/types"
import { telemetryService } from "./services/telemetry"
import { SharedUriHandler } from "./services/uri/SharedUriHandler"
import { ShowMessageType } from "./shared/proto/host/window"
import { fileExistsAtPath } from "./utils/fs"

function geeNeedsProject(result: GeeStatusResult): boolean {
	const text = `${result.message ?? ""}\n${result.error ?? ""}`.toLowerCase()
	return text.includes("project") && (text.includes("registered") || text.includes("serviceusage"))
}

async function chooseGeeProject(): Promise<string | undefined> {
	const projectsResult = await GeeService.listProjects()
	if (!projectsResult.ok || (projectsResult.projects ?? []).length === 0) {
		const projectId = await vscode.window.showInputBox({
			title: "AI-Hydro: Google Earth Engine Project",
			prompt: `${projectsResult.message} Enter a Google Cloud project ID registered for Earth Engine.`,
			placeHolder: "my-earthengine-project",
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length < 3 ? "Enter a valid Google Cloud project ID." : undefined),
		})
		if (!projectId) {
			return undefined
		}
		await vscode.workspace
			.getConfiguration("aihydro.gee")
			.update("projectId", projectId.trim(), vscode.ConfigurationTarget.Global)
		await GeeService.setProject(projectId.trim())
		return projectId.trim()
	}

	const manualItem = {
		label: "$(edit) Enter project ID manually",
		description: "Type your project ID manually",
		project: undefined as GeeProjectInfo | undefined,
	}
	const items = [
		...(projectsResult.projects ?? []).map((project) => ({
			label: project.project_id,
			description: project.name,
			detail: project.project_number ? `Project number: ${project.project_number}` : undefined,
			project,
		})),
		manualItem,
	]
	const selected = await vscode.window.showQuickPick(items, {
		title: "AI-Hydro: Select Google Earth Engine Project",
		placeHolder: "Choose a Google Cloud project registered for Earth Engine",
		ignoreFocusOut: true,
	})
	if (!selected) {
		return undefined
	}
	let projectId = selected.project?.project_id
	if (!projectId) {
		projectId = await vscode.window.showInputBox({
			title: "AI-Hydro: Google Earth Engine Project",
			prompt: "Enter a Google Cloud project ID registered for Earth Engine. AI-Hydro will save it to settings.",
			placeHolder: "my-earthengine-project",
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length < 3 ? "Enter a valid Google Cloud project ID." : undefined),
		})
	}
	if (!projectId) {
		return undefined
	}
	await vscode.workspace
		.getConfiguration("aihydro.gee")
		.update("projectId", projectId.trim(), vscode.ConfigurationTarget.Global)
	await GeeService.setProject(projectId.trim())
	return projectId.trim()
}

async function promptForGeeProjectAndRetry(operation: "connect" | "status", result: GeeStatusResult): Promise<GeeStatusResult> {
	if (!geeNeedsProject(result)) {
		return result
	}
	const projectId = await chooseGeeProject()
	if (!projectId) {
		return result
	}
	return operation === "connect" ? GeeService.connect(projectId) : GeeService.status(projectId)
}

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

	const webview = (await initialize(context)) as VscodeWebviewProvider

	Logger.log("AI-Hydro extension activated")

	const testModeWatchers = await initializeTestMode(webview)
	// Initialize test mode and add disposables to context
	context.subscriptions.push(...testModeWatchers)

	vscode.commands.executeCommand("setContext", "aihydro.isDevMode", IS_DEV && IS_DEV === "true")

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VscodeWebviewProvider.SIDEBAR_ID, webview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	const { commands } = ExtensionRegistryInfo

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.PlusButton, async () => {
			console.log("[DEBUG] aihydro.plusButtonClicked")

			const sidebarInstance = WebviewProvider.getInstance()
			await sidebarInstance.controller.clearTask()
			await sidebarInstance.controller.postStateToWebview()
			await sendChatButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.McpButton, () => {
			sendMcpButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.SettingsButton, () => {
			sendSettingsButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.HistoryButton, async () => {
			// Send event to all subscribers using the gRPC streaming method
			await sendHistoryButtonClickedEvent()
		}),
	)

	// Initialize map panel provider with controller
	VscodeMapPanelProvider.initialize(context, webview.controller)

	// Initialize HTML preview panel provider with controller
	VscodeHtmlPreviewProvider.initialize(context, webview.controller)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.MapButton, async () => {
			console.log("[DEBUG] aihydro.mapButtonClicked - opening side-by-side map panel")

			// Open map in a separate side-by-side panel instead of replacing the chat view
			await VscodeMapPanelProvider.createOrShow()

			// Auto-load workspace GeoJSON files as hidden layers
			await webview.controller.loadWorkspaceGeoJsonLayers()
		}),
	)

	// Register AI-Hydro: Preview HTML command
	// Opens a standalone panel only — the sidebar chat stays visible.
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.HtmlPreviewButton, async () => {
			console.log("[DEBUG] aihydro.htmlPreviewButtonClicked - opening side-by-side HTML preview panel")
			telemetryService.captureButtonClick("aihydro_htmlPreviewButton", webview.controller?.task?.ulid)
			await VscodeHtmlPreviewProvider.createOrShow()
		}),
	)

	// Register AI-Hydro: External Connectors command
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ConnectorsButton, () => {
			sendConnectorsButtonClickedEvent()
		}),
	)

	// Register the Load GeoJSON to Map command
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.LoadGeojsonToMap, async () => {
			const sidebarInstance = WebviewProvider.getInstance()
			await loadGeojsonCommand(sidebarInstance.controller)
		}),
	)

	// Register "Add to AI-Hydro Map" explorer context menu command.
	// Accepts one or more URIs (VS Code passes selected items as args when multi-select).
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AddFileToMap, async (...args: unknown[]) => {
			// VS Code passes selected URIs as rest args when invoked from explorer/context.
			// First arg is the right-clicked file; remaining args are additional selections.
			const uris: vscode.Uri[] = args.flat().filter((a): a is vscode.Uri => a instanceof vscode.Uri)
			if (uris.length === 0) {
				return
			}
			const MAX_BYTES = 200 * 1024 * 1024 // 200 MB guard
			const files: Array<{ name: string; data: Uint8Array }> = []
			for (const uri of uris) {
				try {
					const bytes = await vscode.workspace.fs.readFile(uri)
					if (bytes.byteLength > MAX_BYTES) {
						vscode.window.showWarningMessage(
							`AI-Hydro Map: ${path.basename(uri.fsPath)} is too large (>${MAX_BYTES / 1024 / 1024} MB). Use the + Add Layer button inside the map panel instead.`,
						)
						continue
					}
					files.push({ name: path.basename(uri.fsPath), data: bytes })
				} catch (err) {
					vscode.window.showErrorMessage(
						`AI-Hydro Map: Failed to read ${path.basename(uri.fsPath)}: ${err instanceof Error ? err.message : String(err)}`,
					)
				}
			}
			if (files.length > 0) {
				await VscodeMapPanelProvider.sendFilesToMap(files)
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GeeConnect, async () => {
			let result = await GeeService.connect()
			result = await promptForGeeProjectAndRetry("connect", result)
			if (result.ok) {
				vscode.window.showInformationMessage(`AI-Hydro GEE: ${result.message}`)
			} else {
				vscode.window.showWarningMessage(`AI-Hydro GEE: ${result.message}`)
			}
			return result
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GeeStatus, async () => {
			let result = await GeeService.status()
			result = await promptForGeeProjectAndRetry("status", result)
			if (result.ok) {
				vscode.window.showInformationMessage(`AI-Hydro GEE: ${result.message}`)
			} else {
				vscode.window.showWarningMessage(`AI-Hydro GEE: ${result.message}`)
			}
			return result
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GeeChooseProject, async () => {
			const projectId = await chooseGeeProject()
			if (projectId) {
				vscode.window.showInformationMessage(`AI-Hydro GEE project saved: ${projectId}`)
			}
			return { ok: Boolean(projectId), project_id: projectId }
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GeePreviewChirpsLayer, async () => {
			const endDate = new Date().toISOString().slice(0, 10)
			const startDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10)
			const result = await GeeService.previewChirpsLayer({ startDate, endDate })
			if (!result.ok) {
				vscode.window.showWarningMessage(`AI-Hydro GEE: ${result.message ?? "Failed to preview CHIRPS layer"}`)
			}
			return result
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GeeTest, async () => {
			let result = await GeeService.status()
			result = await promptForGeeProjectAndRetry("status", result)
			if (result.ok) {
				vscode.window.showInformationMessage(`GEE: Connected ✓ — ${result.message}`)
			} else {
				vscode.window.showWarningMessage(`GEE: Not connected — ${result.message}`)
			}
			return result
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GeeDisconnect, async () => {
			await vscode.workspace.getConfiguration("aihydro").update("projectId", undefined, vscode.ConfigurationTarget.Global)
			vscode.window.showInformationMessage("AI-Hydro GEE: Disconnected. Project credentials cleared.")
			return { ok: true, message: "Disconnected" }
		}),
	)

	// Register "Add to AI-Hydro HTML Preview" explorer context menu command.
	// Accepts one or more URIs (VS Code passes selected items as args when multi-select).
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AddFileToHtmlPreview, async (...args: unknown[]) => {
			const uris: vscode.Uri[] = args.flat().filter((a): a is vscode.Uri => a instanceof vscode.Uri)
			if (uris.length === 0) {
				return
			}
			let addedCount = 0
			for (const uri of uris) {
				try {
					await previewHtml(
						webview.controller,
						PreviewHtmlRequest.create({
							htmlContent: "",
							title: path.basename(uri.fsPath),
							filePath: uri.fsPath,
						}),
					)
					addedCount++
				} catch (err) {
					vscode.window.showErrorMessage(
						`AI-Hydro HTML Preview: Failed to add ${path.basename(uri.fsPath)}: ${err instanceof Error ? err.message : String(err)}`,
					)
				}
			}
			if (addedCount > 0) {
				await VscodeHtmlPreviewProvider.createOrShow()
				vscode.window.showInformationMessage(
					`Added ${addedCount} file${addedCount === 1 ? "" : "s"} to AI-Hydro HTML Preview.`,
				)
			}
		}),
	)

	// Graceful drag-and-drop: when a geospatial file is dragged onto the VS Code window
	// VS Code opens it in the editor. We intercept this and offer to add it to the map instead.
	const GEO_EXTS_TEXT = new Set([".geojson", ".topojson", ".kml", ".gpx", ".csv"])
	const GEO_EXTS_BINARY = new Set([".tif", ".tiff", ".kmz", ".zip"])
	const ALL_GEO_EXTS = new Set([...GEO_EXTS_TEXT, ...GEO_EXTS_BINARY])

	// Track URIs we've already prompted for so we don't repeat the prompt when
	// the user moves between tabs (tab change events fire on focus too).
	const promptedUris = new Set<string>()

	const promptAddToMap = async (uri: vscode.Uri) => {
		const key = uri.toString()
		if (promptedUris.has(key)) {
			return
		}
		promptedUris.add(key)
		// Only offer when the map panel is already open (don't force-open the map for every geospatial file).
		if (!VscodeMapPanelProvider.isOpen()) {
			return
		}
		const ext = path.extname(uri.fsPath).toLowerCase()
		if (!ALL_GEO_EXTS.has(ext)) {
			return
		}
		const action = await vscode.window.showInformationMessage(
			`"${path.basename(uri.fsPath)}" is a geospatial file. Add it to the AI-Hydro Map?`,
			"Add to Map",
			"Keep in Editor",
		)
		if (action === "Add to Map") {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri)
				await VscodeMapPanelProvider.sendFilesToMap([{ name: path.basename(uri.fsPath), data: bytes }])
				// Best-effort: close the editor tab now that we've added it to the map.
				try {
					await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
				} catch {
					/* ignore */
				}
			} catch (err) {
				vscode.window.showErrorMessage(`AI-Hydro Map: ${err instanceof Error ? err.message : String(err)}`)
			}
		}
	}

	// Text-based formats fire onDidOpenTextDocument.
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (doc.uri.scheme !== "file") {
				return
			}
			const ext = path.extname(doc.uri.fsPath).toLowerCase()
			if (!GEO_EXTS_TEXT.has(ext)) {
				return
			}
			void promptAddToMap(doc.uri)
		}),
	)

	// Binary formats (.tif, .kmz, .zip) don't fire onDidOpenTextDocument because
	// VS Code's text-document pipeline never sees them. They surface as tabs
	// instead — TabInputText (the "binary not displayed" view) or TabInputCustom
	// (when a third-party extension claims the extension). Watch tab changes.
	context.subscriptions.push(
		vscode.window.tabGroups.onDidChangeTabs((event) => {
			for (const tab of event.opened) {
				const input = tab.input
				let uri: vscode.Uri | undefined
				if (input instanceof vscode.TabInputText) {
					uri = input.uri
				} else if (input instanceof vscode.TabInputCustom) {
					uri = input.uri
				}
				if (!uri || uri.scheme !== "file") {
					continue
				}
				const ext = path.extname(uri.fsPath).toLowerCase()
				if (!GEO_EXTS_BINARY.has(ext)) {
					continue
				}
				void promptAddToMap(uri)
			}
		}),
	)

	// ── HTML file tab-intercept ────────────────────────────────────────────
	// When a user opens an HTML file in the editor and the HTML preview panel
	// is already open, offer to add it to the panel (like geo files for Map).
	const HTML_EXTS = new Set([".html", ".htm"])
	const promptedHtmlUris = new Set<string>()

	const promptAddToHtmlPreview = async (uri: vscode.Uri) => {
		const key = uri.toString()
		if (promptedHtmlUris.has(key)) {
			return
		}
		promptedHtmlUris.add(key)
		if (!VscodeHtmlPreviewProvider.isOpen()) {
			return
		}
		const ext = path.extname(uri.fsPath).toLowerCase()
		if (!HTML_EXTS.has(ext)) {
			return
		}
		const action = await vscode.window.showInformationMessage(
			`"${path.basename(uri.fsPath)}" is an HTML file. Add it to the AI-Hydro HTML Preview?`,
			"Add to HTML Preview",
			"Keep in Editor",
		)
		if (action === "Add to HTML Preview") {
			try {
				// Use filePath-only loading so previewHtml reads content on demand.
				await previewHtml(
					webview.controller,
					PreviewHtmlRequest.create({
						htmlContent: "",
						title: path.basename(uri.fsPath),
						filePath: uri.fsPath,
					}),
				)
				// Best-effort: close the editor tab now that we've added it to the preview.
				try {
					await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
				} catch {
					/* ignore */
				}
			} catch (err) {
				vscode.window.showErrorMessage(`AI-Hydro HTML Preview: ${err instanceof Error ? err.message : String(err)}`)
			}
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (doc.uri.scheme !== "file") {
				return
			}
			const ext = path.extname(doc.uri.fsPath).toLowerCase()
			if (!HTML_EXTS.has(ext)) {
				return
			}
			void promptAddToHtmlPreview(doc.uri)
		}),
	)

	context.subscriptions.push(
		vscode.window.tabGroups.onDidChangeTabs((event) => {
			for (const tab of event.closed) {
				const input = tab.input
				let uri: vscode.Uri | undefined
				if (input instanceof vscode.TabInputText) {
					uri = input.uri
				} else if (input instanceof vscode.TabInputCustom) {
					uri = input.uri
				}
				if (uri) {
					promptedUris.delete(uri.toString())
					promptedHtmlUris.delete(uri.toString())
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
				const devTaskCommands = module.registerTaskCommands(webview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("AI-Hydro dev task commands registered")
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

				console.log("addSelectedTerminalOutputToAIHydro", terminalContents, terminal.name)
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

					// Add to AI-Hydro (Always available)
					const addAction = new vscode.CodeAction("Add to AI-Hydro", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: commands.AddToChat,
						title: "Add to AI-Hydro",
						arguments: [expandedRange, context.diagnostics],
					}
					actions.push(addAction)

					// Explain with AI-Hydro (Always available)
					const explainAction = new vscode.CodeAction("Explain with AI-Hydro", vscode.CodeActionKind.RefactorExtract) // Using a refactor kind
					explainAction.command = {
						command: commands.ExplainCode,
						title: "Explain with AI-Hydro",
						arguments: [expandedRange],
					}
					actions.push(explainAction)

					// Improve with AI-Hydro (Always available)
					const improveAction = new vscode.CodeAction("Improve with AI-Hydro", vscode.CodeActionKind.RefactorRewrite) // Using a refactor kind
					improveAction.command = {
						command: commands.ImproveCode,
						title: "Improve with AI-Hydro",
						arguments: [expandedRange],
					}
					actions.push(improveAction)

					// Fix with AI-Hydro (Only if diagnostics exist)
					if (context.diagnostics.length > 0) {
						const fixAction = new vscode.CodeAction("Fix with AI-Hydro", vscode.CodeActionKind.QuickFix)
						fixAction.isPreferred = true
						fixAction.command = {
							command: commands.FixWithAiHydro,
							title: "Fix with AI-Hydro",
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
			await addToAiHydro(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.FixWithAiHydro,
			async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
				const context = await getContextForCommand(range, diagnostics)
				if (!context) {
					return
				}
				await fixWithAiHydro(context.controller, context.commandContext)
			},
		),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ExplainCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await explainWithAiHydro(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ImproveCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await improveWithAiHydro(context.controller, context.commandContext)
		}),
	)

	// Register the focusChatInput command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FocusChatInput, async () => {
			const webview = WebviewProvider.getInstance() as VscodeWebviewProvider

			// Show the webview
			const webviewView = webview.getWebview()
			if (webviewView) {
				webviewView.show()
			}

			// Send focus event
			sendFocusChatInputEvent()
			telemetryService.captureButtonClick("aihydro_focusChatInput", webview.controller?.task?.ulid)
		}),
	)

	// Register the openWalkthrough command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.Walkthrough, async () => {
			await vscode.commands.executeCommand("workbench.action.openWalkthrough", `${context.extension.id}#AIHydroWalkthrough`)
			telemetryService.captureButtonClick("aihydro_openWalkthrough")
		}),
	)

	// Register the reconstructTaskHistory command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ReconstructTaskHistory, async () => {
			const { reconstructTaskHistory } = await import("./core/commands/reconstructTaskHistory")
			await reconstructTaskHistory()
			telemetryService.captureButtonClick("aihydro_reconstructTaskHistory")
		}),
	)

	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GenerateCommit, async (scm) => {
			generateCommitMessage(webview.controller.stateManager, scm)
		}),
		vscode.commands.registerCommand(commands.AbortCommit, () => {
			abortCommitGeneration()
		}),
	)

	context.subscriptions.push(
		context.secrets.onDidChange(async (event) => {
			if (event.key === "aihydroAccountId" || event.key === "aihydro:aihydroAccountId") {
				// Check if the secret was removed (logout) or added/updated (login)
				const secretValue = await context.secrets.get(event.key)
				const activeWebview = WebviewProvider.getVisibleInstance()
				const controller = activeWebview?.controller

				const authService = AuthService.getInstance(controller)
				if (secretValue) {
					// Secret was added or updated - restore auth info (login from another window)
					authService?.restoreRefreshTokenAndRetrieveAuthInfo()
				} else {
					// Secret was removed - handle logout for all windows
					authService?.handleDeauth(LogoutReason.CROSS_WINDOW_SYNC)
				}
			}
		}),
	)

	return createAiHydroAPI(webview.controller) // AI-Hydro API
}

function setupHostProvider(context: ExtensionContext) {
	console.log("Setting up AI-Hydro vscode host providers...")

	const createWebview = () => new VscodeWebviewProvider(context)
	const createDiffView = () => new VscodeDiffViewProvider()
	const outputChannel = vscode.window.createOutputChannel("AI-Hydro")
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
		throw new Error(`AI-Hydro: Binary '${name}' is not supported`)
	}

	const checkPath = async (pkgFolder: string) => {
		const fullPathResult = workspaceResolver.resolveWorkspacePath(
			vscode.env.appRoot,
			path.join(pkgFolder, name),
			"AI-Hydro.ripgrep.getBinPath",
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
		throw new Error("AI-Hydro: Could not find ripgrep binary")
	}
	return binPath
}

// This method is called when your extension is deactivated
export async function deactivate() {
	GeeTileProxyService.dispose()
	tearDown()

	// Clean up test mode
	cleanupTestMode()

	Logger.log("AI-Hydro extension deactivated")
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
