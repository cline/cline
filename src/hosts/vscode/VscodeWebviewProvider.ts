import { sendShowWebviewEvent } from "@core/controller/ui/subscribeToShowWebview"
import { WebviewProvider } from "@core/webview"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { createClineSessionFactory } from "@/sdk/cline-session-factory"
import { LegacyStateReader } from "@/sdk/legacy-state-reader"
import { SdkController } from "@/sdk/SdkController"
import { WebviewGrpcBridge } from "@/sdk/webview-grpc-bridge"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { WebviewMessage } from "@/shared/WebviewMessage"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class VscodeWebviewProvider extends WebviewProvider implements vscode.WebviewViewProvider {
	// Used in package.json as the view's id. This value cannot be changed due to how vscode caches
	// views based on their id, and updating the id would break existing instances of the extension.
	public static readonly SIDEBAR_ID = ExtensionRegistryInfo.views.Sidebar

	private webview?: vscode.WebviewView
	private disposables: vscode.Disposable[] = []

	/** SDK bridge for webview ↔ SDK adapter communication */
	private bridge?: WebviewGrpcBridge
	private sdkController?: SdkController

	override getWebviewUrl(path: string) {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		const uri = this.webview.webview.asWebviewUri(vscode.Uri.file(path))
		return uri.toString()
	}

	override getCspSource() {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		return this.webview.webview.cspSource
	}

	override isVisible() {
		return this.webview?.visible || false
	}

	public getWebview(): vscode.WebviewView | undefined {
		return this.webview
	}

	/**
	 * Navigate the webview to a specific view (for SDK mode).
	 * Used by extension.ts button commands to trigger navigation
	 * via typed messages that bypass gRPC streaming subscriptions.
	 */
	public navigate(view: string, opts?: { tab?: string; targetSection?: string }): void {
		if (this.bridge) {
			this.bridge.navigate(view, opts)
		}
	}

	/**
	 * Clear the current task via the SDK bridge.
	 * Called by extension.ts Plus button to reset the SDK session.
	 */
	public async clearSdkTask(): Promise<void> {
		if (this.sdkController) {
			await this.sdkController.clearTask()
		}
	}

	/**
	 * Initializes and sets up the webview when it's first created.
	 *
	 * @param webviewView - The sidebar webview view instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.webview = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		}

		webviewView.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received
		this.setWebviewMessageListener(webviewView.webview)

		// Logs show up in bottom panel > Debug Console
		//Logger.log("registering listener")

		// Listen for when the sidebar becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840

		// onDidChangeVisibility is only available on the sidebar webview
		// Otherwise WebviewView and WebviewPanel have all the same properties except for this visibility listener
		// WebviewPanel is not currently used in the extension
		webviewView.onDidChangeVisibility(
			async () => {
				if (this.webview?.visible) {
					// View becoming visible should not steal editor focus.
					await sendShowWebviewEvent(true)
				}
			},
			null,
			this.disposables,
		)

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				await this.dispose()
			},
			null,
			this.disposables,
		)

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				if (e && e.affectsConfiguration("cline.mcpMarketplace.enabled")) {
					// Update state when marketplace tab setting changes
					await this.controller.postStateToWebview()
				}
			},
			null,
			this.disposables,
		)

		// if the extension is starting a new session, clear previous task state
		this.controller.clearTask()

		// Initialize the SDK bridge for webview communication
		this.initSdkBridge()

		Logger.log("[VscodeWebviewProvider] Webview view resolved")

		// Title setting logic removed to allow VSCode to use the container title primarily.
	}

	/**
	 * Initialize the SDK adapter bridge.
	 * This creates an SdkController backed by legacy state and wires it
	 * to the webview via the WebviewGrpcBridge.
	 */
	private initSdkBridge(): void {
		try {
			const legacyState = new LegacyStateReader()
			const taskHistory = legacyState.readTaskHistory()

			// Build apiConfiguration from ALL flat globalState keys + secrets.
			// The classic extension stores provider settings as flat keys:
			//   actModeApiProvider, actModeClineModelId, planModeApiProvider, etc.
			// plus secrets like clineApiKey, openRouterApiKey, etc.
			// buildApiConfiguration() reads them all and merges into one object,
			// replicating what StateManager.constructApiConfigurationFromCache() does.
			const apiConfiguration = legacyState.buildApiConfiguration()

			// Create session factory backed by @clinebot/core
			const sessionFactory = createClineSessionFactory()

			this.sdkController = new SdkController({
				version: ExtensionRegistryInfo.version,
				apiConfiguration,
				mode: legacyState.getMode(),
				cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
				taskHistory,
				legacyState,
				sessionFactory,
			})

			const postMessage = (msg: any) =>
				Promise.resolve(this.webview?.webview.postMessage(msg) as boolean | PromiseLike<boolean> | undefined)
			this.bridge = new WebviewGrpcBridge(this.sdkController, postMessage)

			// Wire push callbacks so SdkController state changes reach the webview
			this.sdkController.onPushState((state) => this.bridge!.pushState(state))
			this.sdkController.onPushPartialMessage((msg) => this.bridge!.pushPartialMessage(msg))
			this.sdkController.onPushAuthStatus((authData) => this.bridge!.pushAuthStatus(authData))

			// Wire platform-specific file picker
			// Returns { images: dataURL[], files: relativePath[] } matching proto StringArrays (values1/values2)
			this.sdkController.selectFilesCallback = async (allowImages: boolean) => {
				const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg"]
				const filters: Record<string, string[]> = allowImages
					? { "All Files": ["*"], Images: imageExtensions }
					: { "All Files": ["*"] }
				const uris = await vscode.window.showOpenDialog({
					canSelectMany: true,
					canSelectFiles: true,
					canSelectFolders: false,
					filters,
				})
				if (!uris) return { images: [], files: [] }
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
				const images: string[] = []
				const files: string[] = []
				for (const uri of uris) {
					const ext = uri.fsPath.split(".").pop()?.toLowerCase() ?? ""
					if (allowImages && imageExtensions.includes(ext)) {
						// Read image as data URL
						try {
							const fileData = await vscode.workspace.fs.readFile(uri)
							const mimeType = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`
							const base64 = Buffer.from(fileData).toString("base64")
							images.push(`data:${mimeType};base64,${base64}`)
						} catch {
							// Fall back to file path if read fails
							const relPath =
								workspaceRoot && uri.fsPath.startsWith(workspaceRoot)
									? uri.fsPath.substring(workspaceRoot.length + 1)
									: uri.fsPath
							files.push(relPath)
						}
					} else {
						const relPath =
							workspaceRoot && uri.fsPath.startsWith(workspaceRoot)
								? uri.fsPath.substring(workspaceRoot.length + 1)
								: uri.fsPath
						files.push(relPath)
					}
				}
				return { images, files }
			}

			// Wire platform-specific callbacks for URL, file, clipboard operations
			this.sdkController.openUrlCallback = async (url: string) => {
				await vscode.env.openExternal(vscode.Uri.parse(url))
			}

			this.sdkController.openFileCallback = async (filePath: string) => {
				try {
					// Try as absolute path first
					let uri: vscode.Uri
					if (filePath.startsWith("/") || filePath.match(/^[a-zA-Z]:\\/)) {
						uri = vscode.Uri.file(filePath)
					} else {
						// Treat as relative to workspace
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
						if (workspaceRoot) {
							const absolutePath = require("path").join(workspaceRoot, filePath)
							uri = vscode.Uri.file(absolutePath)
						} else {
							uri = vscode.Uri.file(filePath)
						}
					}
					const doc = await vscode.workspace.openTextDocument(uri)
					await vscode.window.showTextDocument(doc, { preview: false })
				} catch (err) {
					Logger.error("[VscodeWebviewProvider] Failed to open file:", err)
				}
			}

			this.sdkController.copyToClipboardCallback = async (text: string) => {
				await vscode.env.clipboard.writeText(text)
			}

			this.sdkController.openMcpSettingsCallback = async () => {
				const os = require("os")
				const path = require("path")
				const settingsPath = path.join(os.homedir(), ".cline", "data", "settings", "cline_mcp_settings.json")
				try {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(settingsPath))
					await vscode.window.showTextDocument(doc, { preview: false })
				} catch (err) {
					Logger.error("[VscodeWebviewProvider] Failed to open MCP settings:", err)
				}
			}

			this.sdkController.exportTaskCallback = async (taskId: string, item: any, messages: unknown[]) => {
				const uri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(`cline-task-${taskId}.json`),
					filters: { JSON: ["json"] },
				})
				if (uri) {
					const exportData = { task: item, messages }
					const content = JSON.stringify(exportData, null, 2)
					await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"))
				}
			}

			// Expose debug hooks for testing
			;(globalThis as any).__sdkBridge = this.bridge
			;(globalThis as any).__sdkController = this.sdkController

			Logger.log("[VscodeWebviewProvider] SDK bridge initialized")
		} catch (error) {
			Logger.error("[VscodeWebviewProvider] Failed to initialize SDK bridge:", error)
			// Bridge remains undefined — falls back to classic handler
		}
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * IMPORTANT: When passing methods as callbacks in JavaScript/TypeScript, the method's
	 * 'this' context can be lost. This happens because the method is passed as a
	 * standalone function reference, detached from its original object.
	 *
	 * The Problem:
	 * Doing: webview.onDidReceiveMessage(this.controller.handleWebviewMessage)
	 * Would cause 'this' inside handleWebviewMessage to be undefined or wrong,
	 * leading to "TypeError: this.setUserInfo is not a function"
	 *
	 * The Solution:
	 * We wrap the method call in an arrow function, which:
	 * 1. Preserves the lexical scope's 'this' binding
	 * 2. Ensures handleWebviewMessage is called as a method on the controller instance
	 * 3. Maintains access to all controller methods and properties
	 *
	 * Alternative solutions could use .bind() or making handleWebviewMessage an arrow
	 * function property, but this approach is clean and explicit.
	 *
	 * @param webview The webview instance to attach the message listener to
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(
			(message) => {
				this.handleWebviewMessage(message)
			},
			null,
			this.disposables,
		)
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	async handleWebviewMessage(message: WebviewMessage) {
		if (!this.bridge) {
			Logger.error("[VscodeWebviewProvider] No SDK bridge — dropping message:", message.type)
			return
		}
		await this.bridge.handleMessage(message)
	}

	/**
	 * Sends a message from the extension to the webview.
	 *
	 * @param message - The message to send to the webview
	 * @returns A thenable that resolves to a boolean indicating success, or undefined if the webview is not available
	 */
	private async postMessageToWebview(message: ExtensionMessage): Promise<boolean | undefined> {
		return this.webview?.webview.postMessage(message)
	}

	override async dispose() {
		// WebviewView doesn't have a dispose method, it's managed by VSCode
		// We just need to clean up our disposables
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		super.dispose()
	}
}
