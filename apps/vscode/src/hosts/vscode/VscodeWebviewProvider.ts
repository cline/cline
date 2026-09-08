import { sendShowWebviewEvent } from "@core/controller/ui/subscribeToShowWebview"
import { WebviewProvider } from "@core/webview"
import * as vscode from "vscode"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { telemetryService } from "@/services/telemetry"
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
	/**
	 * Tracks whether the webview has been fully initialized (HTML set + listeners registered).
	 * This survives across view visibility toggles because VscodeWebviewProvider is a singleton
	 * that lives as long as the extension host.
	 *
	 * On the very first resolveWebviewView call (_initialized === false):
	 *   - Set HTML content
	 *   - Register message listeners
	 *   - Clear any stale task state (extension just loaded, no active session to preserve)
	 *
	 * On subsequent calls (_initialized === true), e.g. after VS Code recycles the webview:
	 *   - Re-set HTML content (the webview JavaScript context was destroyed)
	 *   - Re-register message listeners
	 *   - Do NOT clearTask() — preserve the active session
	 *   - Push current controller state to the rehydrated webview
	 */
	private _initialized = false

	/**
	 * Tracks whether the webview has confirmed it's ready to receive state.
	 * This prevents race conditions where state is pushed before the React app
	 * has mounted and set up its message listener.
	 */
	private _webviewReady = false
	private _pendingStatePush: ReturnType<typeof setTimeout> | null = null

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

		const isFirstInit = !this._initialized

		if (isFirstInit) {
			// ── First-time initialization ──────────────────────────────────
			webviewView.webview.html =
				this.context.extensionMode === vscode.ExtensionMode.Development
					? await this.getHMRHtmlContent()
					: this.getHtmlContent()

			// Sets up an event listener to listen for messages passed from the webview view context
			// and executes code based on the message that is received
			this.setWebviewMessageListener(webviewView.webview)
			telemetryService.capturePanelOpened("sidebar_resolved")

			// Check if we have an active task to determine if this is crash recovery
			const hasActiveTask = !!this.controller.task?.taskId
			if (hasActiveTask) {
				// Crash recovery: extension host restarted but task was preserved
				// Do NOT clear the task - it's still running in the SDK
				Logger.log("[VscodeWebviewProvider] Crash recovery detected - preserving active task")
			} else {
				// Fresh start: no active task, safe to clear stale state
				Logger.log("[VscodeWebviewProvider] Fresh start - clearing stale state")
				this.controller.clearTask()
			}

			this._initialized = true
		} else {
			// ── Webview re-creation (e.g. after VS Code recycling) ─────────
			// The webview JavaScript context was destroyed, so we MUST re-set HTML
			// and re-register listeners. However we must NOT clearTask() — the
			// active session is still running in the extension host.
			webviewView.webview.html =
				this.context.extensionMode === vscode.ExtensionMode.Development
					? await this.getHMRHtmlContent()
					: this.getHtmlContent()

			this.setWebviewMessageListener(webviewView.webview)
			telemetryService.capturePanelOpened("sidebar_recreated")

			Logger.log("[VscodeWebviewProvider] Webview re-created, waiting for webview ready signal")

			// Reset ready state - webview needs to confirm it's ready
			this._webviewReady = false

			// Schedule a delayed state push as fallback in case ready signal is lost
			// This ensures state is eventually pushed even if the webview fails to signal ready
			if (this._pendingStatePush) {
				clearTimeout(this._pendingStatePush)
			}
			this._pendingStatePush = setTimeout(() => {
				if (!this._webviewReady) {
					Logger.warn("[VscodeWebviewProvider] Webview ready signal timeout - pushing state anyway")
					this.pushStateToWebview()
				}
			}, 2000) // 2 second fallback timeout
		}

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
					telemetryService.capturePanelOpened("sidebar_visible")
					// View becoming visible should not steal editor focus.
					// FIRE-AND-FORGET: do NOT block the visibility handler on
					// sendShowWebviewEvent's subscriber iteration. The webview React app
					// will request state on its own via gRPC subscribeToState.
					sendShowWebviewEvent(true).catch((err) => {
						Logger.error("[VscodeWebviewProvider] Failed to send show-webview event:", err)
					})
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

		Logger.log(`[VscodeWebviewProvider] Webview view resolved (firstInit=${isFirstInit})`)

		// Title setting logic removed to allow VSCode to use the container title primarily.
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
		const postMessageToWebview = (response: ExtensionMessage) => this.postMessageToWebview(response)

		switch (message.type) {
			case "grpc_request": {
				if (message.grpc_request) {
					await handleGrpcRequest(this.controller, postMessageToWebview, message.grpc_request)
				}
				break
			}
			case "grpc_request_cancel": {
				if (message.grpc_request_cancel) {
					await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
				}
				break
			}
			case "webview_ready": {
				// Webview has confirmed it's ready to receive state
				Logger.log("[VscodeWebviewProvider] Webview ready signal received")
				this._webviewReady = true

				// Cancel the fallback timeout
				if (this._pendingStatePush) {
					clearTimeout(this._pendingStatePush)
					this._pendingStatePush = null
				}

				// Push current state to the ready webview
				this.pushStateToWebview()
				break
			}
			default: {
				Logger.error("Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
	}

	/**
	 * Pushes the current controller state to the webview with size monitoring.
	 * This method checks the state size and applies truncation if necessary
	 * to prevent IPC message drops.
	 */
	private pushStateToWebview(): void {
		// FIRE-AND-FORGET with deferred microtask: we do NOT await this because:
		//   1. The webview's React app needs to mount and set up its message listener first.
		//   2. `postStateToWebview()` serializes the full ExtensionState (may be large with
		//      many messages), and blocking VSCode's resolveWebviewView on that I/O causes
		//      visible UI jank/rescaling when switching back to the Cline tab.
		//   3. The webview will request full state via gRPC subscribeToState on mount anyway,
		//      so this push is an optimistic optimization, not a requirement.
		queueMicrotask(() => {
			this.controller.postStateToWebview().catch((err) => {
				Logger.error("[VscodeWebviewProvider] Failed to push state on webview re-creation:", err)
			})
		})
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
		// Cancel any pending state push timeout
		if (this._pendingStatePush) {
			clearTimeout(this._pendingStatePush)
			this._pendingStatePush = null
		}

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
