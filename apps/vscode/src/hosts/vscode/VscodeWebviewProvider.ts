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
	// Used as the viewType of the "Open in Editor" tab panel, and matched by the
	// `activeWebviewPanelId` when-clause of the editor/title menu contributions.
	public static readonly TAB_PANEL_ID = ExtensionRegistryInfo.views.TabPanel

	// The webview currently bound to the controller. There is a single controller, so only
	// one webview renders the full UI at a time: the editor tab panel when one is open,
	// otherwise the sidebar view.
	private webview?: vscode.WebviewView | vscode.WebviewPanel
	// The most recently resolved sidebar view. Kept separately from `webview` so the UI can
	// be handed back to the sidebar when the tab panel closes.
	private sidebarView?: vscode.WebviewView
	private tabPanel?: vscode.WebviewPanel
	private disposables: vscode.Disposable[] = []
	// Lifecycle listeners for the sidebar view itself. These must outlive bind/unbind
	// cycles (the sidebar keeps existing while the tab panel owns the UI), so they are
	// tracked separately from `disposables`.
	private sidebarDisposables: vscode.Disposable[] = []
	private hasResolvedView = false

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

	public getWebview(): vscode.WebviewView | vscode.WebviewPanel | undefined {
		return this.webview
	}

	public getTabPanel(): vscode.WebviewPanel | undefined {
		return this.tabPanel
	}

	/**
	 * Initializes and sets up the sidebar webview when it's first created.
	 *
	 * @param webviewView - The sidebar webview view instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		// A newer view supersedes any previous one (VS Code re-resolves this same
		// provider when the view is moved between sidebars). Release the previous
		// view's listeners up front in case its onDidDispose fired late or not at all.
		this.disposeSidebarListeners()
		this.sidebarView = webviewView

		// Listen for when the sidebar becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840
		webviewView.onDidChangeVisibility(
			async () => {
				// Ignore visibility changes while the tab panel owns the UI (the
				// sidebar only shows the placeholder page then).
				if (this.webview === webviewView && webviewView.visible) {
					telemetryService.capturePanelOpened("sidebar_visible")
					// View becoming visible should not steal editor focus.
					await sendShowWebviewEvent(true)
				}
			},
			null,
			this.sidebarDisposables,
		)

		// Listen for when the view is disposed. This happens when the user moves the
		// view between the primary and secondary sidebars: VS Code destroys the old
		// WebviewView and calls resolveWebviewView again on this same provider with a
		// new one. Only release view-scoped resources here — the controller must stay
		// alive so the re-resolved view keeps working. The controller is disposed on
		// extension deactivation (tearDown -> WebviewProvider.disposeAllInstances).
		webviewView.onDidDispose(
			() => {
				// resolveWebviewView awaits HTML generation, so an old view's dispose
				// event can arrive after a newer view has already been resolved. Only
				// tear down if this view is still the current one.
				if (this.sidebarView === webviewView) {
					this.sidebarView = undefined
					this.disposeSidebarListeners()
				}
				if (this.webview === webviewView) {
					this.disposeView()
				}
			},
			null,
			this.sidebarDisposables,
		)

		if (this.tabPanel) {
			// The tab panel owns the UI: the sidebar only shows a placeholder until the
			// panel is closed (see resolveWebviewPanel's onDidDispose handoff).
			this.showSidebarPlaceholder(webviewView)
		} else {
			await this.bindWebview(webviewView)
		}

		telemetryService.capturePanelOpened("sidebar_resolved")
		Logger.log("[VscodeWebviewProvider] Webview view resolved")

		// Title setting logic removed to allow VSCode to use the container title primarily.
	}

	/**
	 * Binds an "Open in Editor" tab panel to the controller. While the panel is open it
	 * owns the UI; the sidebar (if resolved) shows a placeholder. When the panel is
	 * closed, the UI is handed back to the sidebar.
	 *
	 * @param panel - The webview panel created for the editor tab
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
		this.tabPanel = panel
		await this.bindWebview(panel)
		telemetryService.capturePanelOpened("tab_resolved")

		panel.onDidChangeViewState(
			async (e) => {
				if (this.webview === panel && e.webviewPanel.visible && e.webviewPanel.active) {
					telemetryService.capturePanelOpened("tab_visible")
					// Panel becoming visible should not steal editor focus.
					await sendShowWebviewEvent(true)
				}
			},
			null,
			this.disposables,
		)

		panel.onDidDispose(
			async () => {
				if (this.tabPanel === panel) {
					this.tabPanel = undefined
				}
				if (this.webview === panel) {
					this.disposeView()
					// Hand the UI back to the sidebar if it is still resolved.
					if (this.sidebarView) {
						await this.bindWebview(this.sidebarView)
					}
				}
			},
			null,
			this.disposables,
		)

		// The sidebar can't render the UI at the same time (there is a single
		// controller), so replace it with a placeholder while the panel is open.
		if (this.sidebarView) {
			this.showSidebarPlaceholder(this.sidebarView)
		}

		Logger.log("[VscodeWebviewProvider] Webview panel resolved")
	}

	/**
	 * Points the given webview (sidebar view or tab panel) at the webview-ui app and
	 * makes it the one bound to the controller.
	 */
	private async bindWebview(webview: vscode.WebviewView | vscode.WebviewPanel): Promise<void> {
		// Release the previously bound webview's listeners.
		this.disposeView()
		this.webview = webview

		webview.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		}

		webview.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received
		this.setWebviewMessageListener(webview.webview)

		// Clear stale task state only when a webview first loads after activation.
		// Re-binds (e.g. the view moved between sidebars, or the tab panel handed the
		// UI back to the sidebar) must not terminate an active task.
		if (!this.hasResolvedView) {
			this.hasResolvedView = true
			this.controller.clearTask()
		}
	}

	/**
	 * Replaces the sidebar's content with a static placeholder page while the tab panel
	 * owns the UI. The real UI is restored by bindWebview when the panel closes.
	 */
	private showSidebarPlaceholder(webviewView: vscode.WebviewView) {
		webviewView.webview.options = {
			enableScripts: false,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		}
		webviewView.webview.html = /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none';">
					<title>Cline</title>
				</head>
				<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
					<p style="max-width:260px;text-align:center;color:var(--vscode-descriptionForeground);font-family:var(--vscode-font-family);font-size:13px;line-height:1.5;">
						Cline is open in an editor tab. Close the tab to use Cline here again.
					</p>
				</body>
			</html>
		`
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
			default: {
				Logger.error("Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
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

	/**
	 * Releases resources tied to the currently bound webview without tearing down the
	 * controller, so this provider can be re-bound to another webview (e.g. when the
	 * user moves the view to the other sidebar, or opens/closes the tab panel).
	 */
	private disposeView() {
		// WebviewView doesn't have a dispose method, it's managed by VSCode
		// We just need to clean up our disposables
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		this.webview = undefined
	}

	private disposeSidebarListeners() {
		while (this.sidebarDisposables.length) {
			const x = this.sidebarDisposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	override async dispose() {
		this.disposeView()
		this.disposeSidebarListeners()
		this.sidebarView = undefined
		// Unlike WebviewViews, WebviewPanels are owned by the extension and must be
		// disposed explicitly.
		this.tabPanel?.dispose()
		this.tabPanel = undefined
		await super.dispose()
	}
}
