import * as os from "node:os"
import * as path from "node:path"
import type { Controller } from "@core/controller"
import { handleMapAgentTaskMessage } from "@core/map/handleMapAgentTask"
import * as vscode from "vscode"
import { GeeService } from "@/services/gee/GeeService"
import { GeeTileProxyService } from "@/services/gee/GeeTileProxyService"
import { buildGeeMapLayer } from "@/services/gee/mapMessageHandler"
import { geeCommandSchema, geePreviewChirpsPayloadSchema, geeStatusPayloadSchema } from "@/services/gee/schemas"
import type { GeeProjectInfo, GeeStatusResult } from "@/services/gee/types"
import { handleHydroMapCommand } from "@/services/hydrology/handleHydroMapCommand"

function expandHomePath(filePath: string): string {
	if (filePath === "~") {
		return os.homedir()
	}
	if (filePath.startsWith("~/")) {
		return path.join(os.homedir(), filePath.slice(2))
	}
	return filePath
}

function geeNeedsProject(result: GeeStatusResult): boolean {
	const text = `${result.message ?? ""}\n${result.error ?? ""}`.toLowerCase()
	return text.includes("project") && (text.includes("registered") || text.includes("serviceusage"))
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

export class VscodeMapPanelProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []

	public static initialize(context: vscode.ExtensionContext, controller: Controller) {
		VscodeMapPanelProvider.context = context
		VscodeMapPanelProvider.controller = controller
	}

	/** Returns true if the map panel is currently open (even if not visible). */
	public static isOpen(): boolean {
		return VscodeMapPanelProvider.currentPanel !== undefined
	}

	/**
	 * Send raw file bytes to the map webview for client-side parsing.
	 * Opens the panel first if it's not already visible.
	 * Kept for small legacy callers. Prefer sendFileUrisToMap for workspace files,
	 * especially binary rasters, to avoid JSON-serializing large byte arrays.
	 */
	public static async sendFilesToMap(files: Array<{ name: string; data: Uint8Array }>): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		// Small delay to let the webview finish mounting before we push data
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const file of files) {
			await panel.webview.postMessage({
				type: "aihydro-load-file",
				name: file.name,
				// Transfer as plain number array so JSON serialization works
				data: Array.from(file.data),
			})
		}
	}

	/**
	 * Send file references to the map webview. The webview fetches each URI as
	 * a Blob and parses it client-side, avoiding the huge number[] payload that
	 * can crash VS Code/webview when loading GeoTIFFs from the file prompt.
	 */
	public static async sendFileUrisToMap(uris: vscode.Uri[]): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		VscodeMapPanelProvider.allowLocalFileRoots(
			panel,
			uris.map((uri) => vscode.Uri.file(path.dirname(uri.fsPath))),
		)
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const uri of uris) {
			await panel.webview.postMessage({
				type: "aihydro-load-file-uri",
				name: path.basename(uri.fsPath),
				uri: panel.webview.asWebviewUri(uri).toString(),
			})
		}
	}

	private static allowLocalFileRoots(panel: vscode.WebviewPanel, roots: vscode.Uri[]): void {
		const existing = panel.webview.options.localResourceRoots ?? []
		const next = [...existing]
		const seen = new Set(existing.map((uri) => uri.toString()))
		for (const root of roots) {
			const key = root.toString()
			if (!seen.has(key)) {
				seen.add(key)
				next.push(root)
			}
		}
		panel.webview.options = {
			...panel.webview.options,
			localResourceRoots: next,
		}
	}

	public static async createOrShow() {
		if (!VscodeMapPanelProvider.context) {
			console.warn("[VscodeMapPanelProvider] Not yet initialized — cannot open map panel")
			return
		}

		const column = vscode.ViewColumn.Two

		// If we already have a panel, show it
		if (VscodeMapPanelProvider.currentPanel) {
			VscodeMapPanelProvider.currentPanel.reveal(column)
			return
		}

		// Otherwise, create a new panel
		const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
		const panel = vscode.window.createWebviewPanel("aihydroMapView", "AI-Hydro Map", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build"),
				...workspaceRoots,
			],
		})

		VscodeMapPanelProvider.currentPanel = panel

		// Set the webview's HTML content
		panel.webview.html = VscodeMapPanelProvider.getHtmlForWebview(panel.webview)

		// CRITICAL: Set up message handler so this panel can communicate with the extension
		VscodeMapPanelProvider.setupMessageHandler(panel)

		// Handle disposal
		panel.onDidDispose(
			() => {
				VscodeMapPanelProvider.currentPanel = undefined
				// Clean up disposables
				while (VscodeMapPanelProvider.disposables.length) {
					const x = VscodeMapPanelProvider.disposables.pop()
					if (x) {
						x.dispose()
					}
				}
			},
			null,
			[],
		)
	}

	/**
	 * Sets up message handling between the webview panel and the extension
	 * This allows the map panel to receive layer updates from the backend
	 */
	private static setupMessageHandler(panel: vscode.WebviewPanel) {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		// Get the main webview instance to access the controller
		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeMapPanelProvider] Cannot set up message handler: no main webview instance")
			return
		}

		// Set up message listener for this panel
		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: any) => panel.webview.postMessage(response)

				switch (message.type) {
					case "grpc_request": {
						if (message.grpc_request) {
							await handleGrpcRequest(mainWebview.controller, postMessageToWebview, message.grpc_request)
						}
						break
					}
					case "grpc_request_cancel": {
						if (message.grpc_request_cancel) {
							await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
						}
						break
					}
					case "aihydro-hydro-command": {
						if (mainWebview?.controller) {
							await handleHydroMapCommand(mainWebview.controller, message, async (response) => {
								await postMessageToWebview(response)
							})
						}
						break
					}
					case "aihydro-map-agent-task": {
						if (mainWebview?.controller) {
							await handleMapAgentTaskMessage(mainWebview.controller, message, async (response) => {
								await postMessageToWebview(response)
							})
						}
						break
					}
					case "aihydro-resolve-file-uri": {
						const requestId = message.requestId
						const filePath = typeof message.path === "string" ? expandHomePath(message.path) : ""
						try {
							if (!filePath) {
								throw new Error("Missing file path")
							}
							const uri = vscode.Uri.file(filePath)
							VscodeMapPanelProvider.allowLocalFileRoots(panel, [vscode.Uri.file(path.dirname(uri.fsPath))])
							await panel.webview.postMessage({
								type: "aihydro-resolve-file-uri-result",
								requestId,
								ok: true,
								name: path.basename(uri.fsPath),
								uri: panel.webview.asWebviewUri(uri).toString(),
							})
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-resolve-file-uri-result",
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-gee-command": {
						try {
							const parsed = geeCommandSchema.parse(message)
							const requestId = parsed.requestId
							if (parsed.command === "connect") {
								const payload = geeStatusPayloadSchema.parse(parsed.payload)
								let result = await GeeService.connect(payload?.projectId)
								result = await promptForGeeProjectAndRetry("connect", result)
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message,
									result,
								})
							} else if (parsed.command === "status") {
								const payload = geeStatusPayloadSchema.parse(parsed.payload)
								let result = await GeeService.status(payload?.projectId)
								result = await promptForGeeProjectAndRetry("status", result)
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message,
									result,
								})
							} else if (parsed.command === "chooseProject") {
								const projectId = await chooseGeeProject()
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: Boolean(projectId),
									message: projectId ? `Saved GEE project: ${projectId}` : "No GEE project selected",
									result: { ok: Boolean(projectId), project_id: projectId },
								})
							} else if (parsed.command === "previewChirpsLayer") {
								const payload = geePreviewChirpsPayloadSchema.parse(parsed.payload ?? {})
								const result = await GeeService.previewChirpsLayer(payload)
								if (result.ok && (result.tile_url_template || result.tile_url)) {
									const remoteTemplate = result.tile_url_template || result.tile_url || ""
									const proxiedTemplate = await GeeTileProxyService.proxify(remoteTemplate)
									const layer = buildGeeMapLayer(
										{
											...result,
											tile_url: proxiedTemplate,
											tile_url_template: proxiedTemplate,
											remote_tile_url_template: remoteTemplate,
										} as any,
										(result as any).provenance_path,
									)
									mainWebview.controller.addMapLayer(layer)
								}
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message || (result.ok ? "CHIRPS layer added" : "CHIRPS layer failed"),
									result,
									error: result.error,
								})
							}
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-gee-result",
								requestId: message.requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					default: {
						console.error("[VscodeMapPanelProvider] Received unhandled message type:", JSON.stringify(message))
					}
				}
			},
			null,
			VscodeMapPanelProvider.disposables,
		)
	}

	private static getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none';
		style-src ${webview.cspSource} 'unsafe-inline';
		script-src 'nonce-${nonce}';
		img-src ${webview.cspSource} https: data: blob:;
		font-src ${webview.cspSource} https: data:;
		connect-src https: http://127.0.0.1:* http://localhost:* ${webview.cspSource};
		worker-src blob:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Map</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			width: 100vw;
			height: 100vh;
		}
		#root {
			width: 100%;
			height: 100%;
		}
		.map-standalone {
			width: 100%;
			height: 100%;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		// Set standalone map mode flag
		window.AIHYDRO_MAP_STANDALONE = true;
	</script>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
	}
}

function getNonce() {
	let text = ""
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}
