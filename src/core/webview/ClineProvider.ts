import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import axios from "axios"
import EventEmitter from "events"
import fs from "fs/promises"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import * as vscode from "vscode"

import { changeLanguage, t } from "../../i18n"
import { setPanel } from "../../activate/registerCommands"
import {
	ApiConfiguration,
	ApiProvider,
	ModelInfo,
	API_CONFIG_KEYS,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	glamaDefaultModelId,
	glamaDefaultModelInfo,
} from "../../shared/api"
import { findLast } from "../../shared/array"
import { supportPrompt } from "../../shared/support-prompt"
import { GlobalFileNames } from "../../shared/globalFileNames"
import {
	SecretKey,
	GlobalStateKey,
	SECRET_KEYS,
	GLOBAL_STATE_KEYS,
	ConfigurationValues,
} from "../../shared/globalState"
import { HistoryItem } from "../../shared/HistoryItem"
import { ApiConfigMeta, ExtensionMessage } from "../../shared/ExtensionMessage"
import { checkoutDiffPayloadSchema, checkoutRestorePayloadSchema, WebviewMessage } from "../../shared/WebviewMessage"
import { Mode, PromptComponent, defaultModeSlug, ModeConfig, getModeBySlug, getGroupName } from "../../shared/modes"
import { checkExistKey } from "../../shared/checkExistApiConfig"
import { EXPERIMENT_IDS, experiments as Experiments, experimentDefault, ExperimentId } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { Terminal, TERMINAL_SHELL_INTEGRATION_TIMEOUT } from "../../integrations/terminal/Terminal"
import { downloadTask } from "../../integrations/misc/export-markdown"
import { openFile, openImage } from "../../integrations/misc/open-file"
import { selectImages } from "../../integrations/misc/process-images"
import { getTheme } from "../../integrations/theme/getTheme"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"
import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { ShadowCheckpointService } from "../../services/checkpoints/ShadowCheckpointService"
import { BrowserSession } from "../../services/browser/BrowserSession"
import { discoverChromeInstances } from "../../services/browser/browserDiscovery"
import { searchWorkspaceFiles } from "../../services/search/file-search"
import { fileExistsAtPath } from "../../utils/fs"
import { playSound, setSoundEnabled, setSoundVolume } from "../../utils/sound"
import { playTts, setTtsEnabled, setTtsSpeed, stopTts } from "../../utils/tts"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { searchCommits } from "../../utils/git"
import { getDiffStrategy } from "../diff/DiffStrategy"
import { SYSTEM_PROMPT } from "../prompts/system"
import { ConfigManager } from "../config/ConfigManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { ContextProxy } from "../contextProxy"
import { buildApiHandler } from "../../api"
import { getOpenRouterModels } from "../../api/providers/openrouter"
import { getGlamaModels } from "../../api/providers/glama"
import { getUnboundModels } from "../../api/providers/unbound"
import { getRequestyModels } from "../../api/providers/requesty"
import { getOpenAiModels } from "../../api/providers/openai"
import { getOllamaModels } from "../../api/providers/ollama"
import { getVsCodeLmModels } from "../../api/providers/vscode-lm"
import { getLmStudioModels } from "../../api/providers/lmstudio"
import { ACTION_NAMES } from "../CodeActionProvider"
import { Cline, ClineOptions } from "../Cline"
import { openMention } from "../mentions"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { telemetryService } from "../../services/telemetry/TelemetryService"
import { TelemetrySetting } from "../../shared/TelemetrySetting"
import { getWorkspacePath } from "../../utils/path"

/**
 * https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
 * https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
 */

export type ClineProviderEvents = {
	clineCreated: [cline: Cline]
}

export class ClineProvider extends EventEmitter<ClineProviderEvents> implements vscode.WebviewViewProvider {
	public static readonly sideBarId = "roo-cline.SidebarProvider" // used in package.json as the view's id. This value cannot be changed due to how vscode caches views based on their id, and updating the id would break existing instances of the extension.
	public static readonly tabPanelId = "roo-cline.TabPanelProvider"
	private static activeInstances: Set<ClineProvider> = new Set()
	private disposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private isViewLaunched = false
	private clineStack: Cline[] = []
	private workspaceTracker?: WorkspaceTracker
	protected mcpHub?: McpHub // Change from private to protected
	private latestAnnouncementId = "mar-20-2025-3-10" // update to some unique identifier when we add a new announcement
	private contextProxy: ContextProxy
	configManager: ConfigManager
	customModesManager: CustomModesManager
	get cwd() {
		return getWorkspacePath()
	}
	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly renderContext: "sidebar" | "editor" = "sidebar",
	) {
		super()

		this.outputChannel.appendLine("ClineProvider instantiated")
		this.contextProxy = new ContextProxy(context)
		ClineProvider.activeInstances.add(this)

		// Register this provider with the telemetry service to enable it to add properties like mode and provider
		telemetryService.setProvider(this)

		this.workspaceTracker = new WorkspaceTracker(this)
		this.configManager = new ConfigManager(this.context)
		this.customModesManager = new CustomModesManager(this.context, async () => {
			await this.postStateToWebview()
		})

		// Initialize MCP Hub through the singleton manager
		McpServerManager.getInstance(this.context, this)
			.then((hub) => {
				this.mcpHub = hub
			})
			.catch((error) => {
				this.outputChannel.appendLine(`Failed to initialize MCP Hub: ${error}`)
			})
	}

	// Adds a new Cline instance to clineStack, marking the start of a new task.
	// The instance is pushed to the top of the stack (LIFO order).
	// When the task is completed, the top instance is removed, reactivating the previous task.
	async addClineToStack(cline: Cline) {
		console.log(`[subtasks] adding task ${cline.taskId}.${cline.instanceId} to stack`)

		// Add this cline instance into the stack that represents the order of all the called tasks.
		this.clineStack.push(cline)

		// Ensure getState() resolves correctly.
		const state = await this.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	// Removes and destroys the top Cline instance (the current finished task),
	// activating the previous one (resuming the parent task).
	async removeClineFromStack() {
		if (this.clineStack.length === 0) {
			return
		}

		// Pop the top Cline instance from the stack.
		var cline = this.clineStack.pop()

		if (cline) {
			console.log(`[subtasks] removing task ${cline.taskId}.${cline.instanceId} from stack`)

			try {
				// Abort the running task and set isAbandoned to true so
				// all running promises will exit as well.
				await cline.abortTask(true)
			} catch (e) {
				this.log(
					`[subtasks] encountered error while aborting task ${cline.taskId}.${cline.instanceId}: ${e.message}`,
				)
			}

			// Make sure no reference kept, once promises end it will be
			// garbage collected.
			cline = undefined
		}
	}

	// returns the current cline object in the stack (the top one)
	// if the stack is empty, returns undefined
	getCurrentCline(): Cline | undefined {
		if (this.clineStack.length === 0) {
			return undefined
		}
		return this.clineStack[this.clineStack.length - 1]
	}

	// returns the current clineStack length (how many cline objects are in the stack)
	getClineStackSize(): number {
		return this.clineStack.length
	}

	public getCurrentTaskStack(): string[] {
		return this.clineStack.map((cline) => cline.taskId)
	}

	// remove the current task/cline instance (at the top of the stack), ao this task is finished
	// and resume the previous task/cline instance (if it exists)
	// this is used when a sub task is finished and the parent task needs to be resumed
	async finishSubTask(lastMessage?: string) {
		console.log(`[subtasks] finishing subtask ${lastMessage}`)
		// remove the last cline instance from the stack (this is the finished sub task)
		await this.removeClineFromStack()
		// resume the last cline instance in the stack (if it exists - this is the 'parnt' calling task)
		this.getCurrentCline()?.resumePausedTask(lastMessage)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		this.outputChannel.appendLine("Disposing ClineProvider...")
		await this.removeClineFromStack()
		this.outputChannel.appendLine("Cleared task")

		if (this.view && "dispose" in this.view) {
			this.view.dispose()
			this.outputChannel.appendLine("Disposed webview")
		}

		while (this.disposables.length) {
			const x = this.disposables.pop()

			if (x) {
				x.dispose()
			}
		}

		this.workspaceTracker?.dispose()
		this.workspaceTracker = undefined
		this.mcpHub?.dispose()
		this.mcpHub = undefined
		this.customModesManager?.dispose()
		this.outputChannel.appendLine("Disposed all disposables")
		ClineProvider.activeInstances.delete(this)

		// Unregister from McpServerManager
		McpServerManager.unregisterProvider(this)
	}

	public static getVisibleInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	public static async getInstance(): Promise<ClineProvider | undefined> {
		let visibleProvider = ClineProvider.getVisibleInstance()

		// If no visible provider, try to show the sidebar view
		if (!visibleProvider) {
			await vscode.commands.executeCommand("roo-cline.SidebarProvider.focus")
			// Wait briefly for the view to become visible
			await delay(100)
			visibleProvider = ClineProvider.getVisibleInstance()
		}

		// If still no visible provider, return
		if (!visibleProvider) {
			return
		}

		return visibleProvider
	}

	public static async isActiveTask(): Promise<boolean> {
		const visibleProvider = await ClineProvider.getInstance()
		if (!visibleProvider) {
			return false
		}

		// check if there is a cline instance in the stack (if this provider has an active task)
		if (visibleProvider.getCurrentCline()) {
			return true
		}

		return false
	}

	public static async handleCodeAction(
		command: string,
		promptType: keyof typeof ACTION_NAMES,
		params: Record<string, string | any[]>,
	): Promise<void> {
		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()

		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command.endsWith("addToContext")) {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: prompt,
			})

			return
		}

		if (visibleProvider.getCurrentCline() && command.endsWith("InCurrentTask")) {
			await visibleProvider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text: prompt })
			return
		}

		await visibleProvider.initClineWithTask(prompt)
	}

	public static async handleTerminalAction(
		command: string,
		promptType: "TERMINAL_ADD_TO_CONTEXT" | "TERMINAL_FIX" | "TERMINAL_EXPLAIN",
		params: Record<string, string | any[]>,
	): Promise<void> {
		const visibleProvider = await ClineProvider.getInstance()
		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()

		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command.endsWith("AddToContext")) {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: prompt,
			})
			return
		}

		if (visibleProvider.getCurrentCline() && command.endsWith("InCurrentTask")) {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "sendMessage",
				text: prompt,
			})
			return
		}

		await visibleProvider.initClineWithTask(prompt)
	}

	async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
		this.outputChannel.appendLine("Resolving webview view")

		if (!this.contextProxy.isInitialized) {
			await this.contextProxy.initialize()
		}

		this.view = webviewView

		// Set panel reference according to webview type
		if ("onDidChangeViewState" in webviewView) {
			// Tag page type
			setPanel(webviewView, "tab")
		} else if ("onDidChangeVisibility" in webviewView) {
			// Sidebar Type
			setPanel(webviewView, "sidebar")
		}

		// Initialize out-of-scope variables that need to recieve persistent global state values
		this.getState().then(({ soundEnabled, terminalShellIntegrationTimeout }) => {
			setSoundEnabled(soundEnabled ?? false)
			Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout ?? TERMINAL_SHELL_INTEGRATION_TIMEOUT)
		})

		// Initialize tts enabled state
		this.getState().then(({ ttsEnabled }) => {
			setTtsEnabled(ttsEnabled ?? false)
		})

		// Initialize tts speed state
		this.getState().then(({ ttsSpeed }) => {
			setTtsSpeed(ttsSpeed ?? 1)
		})

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [this.contextProxy.extensionUri],
		}

		webviewView.webview.html =
			this.contextProxy.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(webviewView.webview)
				: this.getHtmlContent(webviewView.webview)

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is recieved
		this.setWebviewMessageListener(webviewView.webview)

		// Logs show up in bottom panel > Debug Console
		//console.log("registering listener")

		// Listen for when the panel becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840
		if ("onDidChangeViewState" in webviewView) {
			// WebviewView and WebviewPanel have all the same properties except for this visibility listener
			// panel
			webviewView.onDidChangeViewState(
				() => {
					if (this.view?.visible) {
						this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
					}
				},
				null,
				this.disposables,
			)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			webviewView.onDidChangeVisibility(
				() => {
					if (this.view?.visible) {
						this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
					}
				},
				null,
				this.disposables,
			)
		}

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				await this.dispose()
			},
			null,
			this.disposables,
		)

		// Listen for when color changes
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				if (e && e.affectsConfiguration("workbench.colorTheme")) {
					// Sends latest theme name to webview
					await this.postMessageToWebview({ type: "theme", text: JSON.stringify(await getTheme()) })
				}
			},
			null,
			this.disposables,
		)

		// If the extension is starting a new session, clear previous task state.
		await this.removeClineFromStack()

		this.outputChannel.appendLine("Webview view resolved")
	}

	public async initClineWithSubTask(parent: Cline, task?: string, images?: string[]) {
		return this.initClineWithTask(task, images, parent)
	}

	// when initializing a new task, (not from history but from a tool command new_task) there is no need to remove the previouse task
	// since the new task is a sub task of the previous one, and when it finishes it is removed from the stack and the caller is resumed
	// in this way we can have a chain of tasks, each one being a sub task of the previous one until the main task is finished
	public async initClineWithTask(task?: string, images?: string[], parentTask?: Cline) {
		const {
			apiConfiguration,
			customModePrompts,
			diffEnabled: enableDiff,
			enableCheckpoints,
			checkpointStorage,
			fuzzyMatchThreshold,
			mode,
			customInstructions: globalInstructions,
			experiments,
		} = await this.getState()

		const modePrompt = customModePrompts?.[mode] as PromptComponent
		const effectiveInstructions = [globalInstructions, modePrompt?.customInstructions].filter(Boolean).join("\n\n")

		const cline = new Cline({
			provider: this,
			apiConfiguration,
			customInstructions: effectiveInstructions,
			enableDiff,
			enableCheckpoints,
			checkpointStorage,
			fuzzyMatchThreshold,
			task,
			images,
			experiments,
			rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined,
			parentTask,
			taskNumber: this.clineStack.length + 1,
			onCreated: (cline) => this.emit("clineCreated", cline),
		})

		await this.addClineToStack(cline)
		this.log(
			`[subtasks] ${cline.parentTask ? "child" : "parent"} task ${cline.taskId}.${cline.instanceId} instantiated`,
		)
		return cline
	}

	public async initClineWithHistoryItem(historyItem: HistoryItem & { rootTask?: Cline; parentTask?: Cline }) {
		await this.removeClineFromStack()

		const {
			apiConfiguration,
			customModePrompts,
			diffEnabled: enableDiff,
			enableCheckpoints,
			checkpointStorage,
			fuzzyMatchThreshold,
			mode,
			customInstructions: globalInstructions,
			experiments,
		} = await this.getState()

		const modePrompt = customModePrompts?.[mode] as PromptComponent
		const effectiveInstructions = [globalInstructions, modePrompt?.customInstructions].filter(Boolean).join("\n\n")

		const taskId = historyItem.id
		const globalStorageDir = this.contextProxy.globalStorageUri.fsPath
		const workspaceDir = this.cwd

		const checkpoints: Pick<ClineOptions, "enableCheckpoints" | "checkpointStorage"> = {
			enableCheckpoints,
			checkpointStorage,
		}

		if (enableCheckpoints) {
			try {
				checkpoints.checkpointStorage = await ShadowCheckpointService.getTaskStorage({
					taskId,
					globalStorageDir,
					workspaceDir,
				})

				this.log(
					`[ClineProvider#initClineWithHistoryItem] Using ${checkpoints.checkpointStorage} storage for ${taskId}`,
				)
			} catch (error) {
				checkpoints.enableCheckpoints = false
				this.log(`[ClineProvider#initClineWithHistoryItem] Error getting task storage: ${error.message}`)
			}
		}

		const cline = new Cline({
			provider: this,
			apiConfiguration,
			customInstructions: effectiveInstructions,
			enableDiff,
			...checkpoints,
			fuzzyMatchThreshold,
			historyItem,
			experiments,
			rootTask: historyItem.rootTask,
			parentTask: historyItem.parentTask,
			taskNumber: historyItem.number,
			onCreated: (cline) => this.emit("clineCreated", cline),
		})

		await this.addClineToStack(cline)
		this.log(
			`[subtasks] ${cline.parentTask ? "child" : "parent"} task ${cline.taskId}.${cline.instanceId} instantiated`,
		)
		return cline
	}

	public async postMessageToWebview(message: ExtensionMessage) {
		await this.view?.webview.postMessage(message)
	}

	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const localPort = "5173"
		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (error) {
			vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))

			return this.getHtmlContent(webview)
		}

		const nonce = getNonce()

		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		])

		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])

		const file = "src/index.tsx"
		const scriptUri = `http://${localServerUrl}/${file}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource}`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${webview.cspSource} data:`,
			`script-src 'unsafe-eval' ${webview.cspSource} https://* https://*.posthog.com http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src https://* https://*.posthog.com ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
					</script>
					<title>Roo Code</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @param webview A reference to the extension webview
	 * @param extensionUri The URI of the directory containing the extension
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private getHtmlContent(webview: vscode.Webview): string {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])
		// The JS file from the React build output
		const scriptUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "build", "assets", "index.js"])

		// The codicon font from the React build output
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
		// we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
		// don't forget to add font-src ${webview.cspSource};
		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		])

		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])

		// const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.js"))

		// const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "reset.css"))
		// const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "vscode.css"))

		// // Same for stylesheet
		// const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.css"))

		// Use a nonce to only allow a specific script to be run.
		/*
		content security policy of your webview to only allow scripts that have a specific nonce
		create a content security policy meta tag so that only loading scripts with a nonce is allowed
		As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicity allow for these resources. E.g.
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

		in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
		*/
		const nonce = getNonce()

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' https://us-assets.i.posthog.com; connect-src https://openrouter.ai https://us.i.posthog.com https://us-assets.i.posthog.com;">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
			</script>
            <title>Roo Code</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
          </body>
        </html>
      `
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is recieved.
	 *
	 * @param webview A reference to the extension webview
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(
			async (message: WebviewMessage) => {
				switch (message.type) {
					case "webviewDidLaunch":
						// Load custom modes first
						const customModes = await this.customModesManager.getCustomModes()
						await this.updateGlobalState("customModes", customModes)

						this.postStateToWebview()
						this.workspaceTracker?.initializeFilePaths() // don't await

						getTheme().then((theme) =>
							this.postMessageToWebview({ type: "theme", text: JSON.stringify(theme) }),
						)

						// If MCP Hub is already initialized, update the webview with current server list
						if (this.mcpHub) {
							this.postMessageToWebview({
								type: "mcpServers",
								mcpServers: this.mcpHub.getAllServers(),
							})
						}

						const cacheDir = await this.ensureCacheDirectoryExists()

						// Post last cached models in case the call to endpoint fails.
						this.readModelsFromCache(GlobalFileNames.openRouterModels).then((openRouterModels) => {
							if (openRouterModels) {
								this.postMessageToWebview({ type: "openRouterModels", openRouterModels })
							}
						})

						// GUI relies on model info to be up-to-date to provide
						// the most accurate pricing, so we need to fetch the
						// latest details on launch.
						// We do this for all users since many users switch
						// between api providers and if they were to switch back
						// to OpenRouter it would be showing outdated model info
						// if we hadn't retrieved the latest at this point
						// (see normalizeApiConfiguration > openrouter).
						const { apiConfiguration: currentApiConfig } = await this.getState()
						getOpenRouterModels(currentApiConfig).then(async (openRouterModels) => {
							if (Object.keys(openRouterModels).length > 0) {
								await fs.writeFile(
									path.join(cacheDir, GlobalFileNames.openRouterModels),
									JSON.stringify(openRouterModels),
								)
								await this.postMessageToWebview({ type: "openRouterModels", openRouterModels })

								// Update model info in state (this needs to be
								// done here since we don't want to update state
								// while settings is open, and we may refresh
								// models there).
								const { apiConfiguration } = await this.getState()

								if (apiConfiguration.openRouterModelId) {
									await this.updateGlobalState(
										"openRouterModelInfo",
										openRouterModels[apiConfiguration.openRouterModelId],
									)
									await this.postStateToWebview()
								}
							}
						})

						this.readModelsFromCache(GlobalFileNames.glamaModels).then((glamaModels) => {
							if (glamaModels) {
								this.postMessageToWebview({ type: "glamaModels", glamaModels })
							}
						})

						getGlamaModels().then(async (glamaModels) => {
							if (Object.keys(glamaModels).length > 0) {
								await fs.writeFile(
									path.join(cacheDir, GlobalFileNames.glamaModels),
									JSON.stringify(glamaModels),
								)
								await this.postMessageToWebview({ type: "glamaModels", glamaModels })

								const { apiConfiguration } = await this.getState()

								if (apiConfiguration.glamaModelId) {
									await this.updateGlobalState(
										"glamaModelInfo",
										glamaModels[apiConfiguration.glamaModelId],
									)
									await this.postStateToWebview()
								}
							}
						})

						this.readModelsFromCache(GlobalFileNames.unboundModels).then((unboundModels) => {
							if (unboundModels) {
								this.postMessageToWebview({ type: "unboundModels", unboundModels })
							}
						})

						getUnboundModels().then(async (unboundModels) => {
							if (Object.keys(unboundModels).length > 0) {
								await fs.writeFile(
									path.join(cacheDir, GlobalFileNames.unboundModels),
									JSON.stringify(unboundModels),
								)
								await this.postMessageToWebview({ type: "unboundModels", unboundModels })

								const { apiConfiguration } = await this.getState()

								if (apiConfiguration?.unboundModelId) {
									await this.updateGlobalState(
										"unboundModelInfo",
										unboundModels[apiConfiguration.unboundModelId],
									)
									await this.postStateToWebview()
								}
							}
						})

						this.readModelsFromCache(GlobalFileNames.requestyModels).then((requestyModels) => {
							if (requestyModels) {
								this.postMessageToWebview({ type: "requestyModels", requestyModels })
							}
						})

						getRequestyModels().then(async (requestyModels) => {
							if (Object.keys(requestyModels).length > 0) {
								await fs.writeFile(
									path.join(cacheDir, GlobalFileNames.requestyModels),
									JSON.stringify(requestyModels),
								)
								await this.postMessageToWebview({ type: "requestyModels", requestyModels })

								const { apiConfiguration } = await this.getState()

								if (apiConfiguration.requestyModelId) {
									await this.updateGlobalState(
										"requestyModelInfo",
										requestyModels[apiConfiguration.requestyModelId],
									)
									await this.postStateToWebview()
								}
							}
						})

						this.configManager
							.listConfig()
							.then(async (listApiConfig) => {
								if (!listApiConfig) {
									return
								}

								if (listApiConfig.length === 1) {
									// check if first time init then sync with exist config
									if (!checkExistKey(listApiConfig[0])) {
										const { apiConfiguration } = await this.getState()
										await this.configManager.saveConfig(
											listApiConfig[0].name ?? "default",
											apiConfiguration,
										)
										listApiConfig[0].apiProvider = apiConfiguration.apiProvider
									}
								}

								const currentConfigName = (await this.getGlobalState("currentApiConfigName")) as string

								if (currentConfigName) {
									if (!(await this.configManager.hasConfig(currentConfigName))) {
										// current config name not valid, get first config in list
										await this.updateGlobalState("currentApiConfigName", listApiConfig?.[0]?.name)
										if (listApiConfig?.[0]?.name) {
											const apiConfig = await this.configManager.loadConfig(
												listApiConfig?.[0]?.name,
											)

											await Promise.all([
												this.updateGlobalState("listApiConfigMeta", listApiConfig),
												this.postMessageToWebview({ type: "listApiConfig", listApiConfig }),
												this.updateApiConfiguration(apiConfig),
											])
											await this.postStateToWebview()
											return
										}
									}
								}

								await Promise.all([
									await this.updateGlobalState("listApiConfigMeta", listApiConfig),
									await this.postMessageToWebview({ type: "listApiConfig", listApiConfig }),
								])
							})
							.catch((error) =>
								this.outputChannel.appendLine(
									`Error list api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								),
							)

						// If user already opted in to telemetry, enable telemetry service
						this.getStateToPostToWebview().then((state) => {
							const { telemetrySetting } = state
							const isOptedIn = telemetrySetting === "enabled"
							telemetryService.updateTelemetryState(isOptedIn)
						})

						this.isViewLaunched = true
						break
					case "newTask":
						// Code that should run in response to the hello message command
						//vscode.window.showInformationMessage(message.text!)

						// Send a message to our webview.
						// You can send any JSON serializable data.
						// Could also do this in extension .ts
						//this.postMessageToWebview({ type: "text", text: `Extension: ${Date.now()}` })
						// initializing new instance of Cline will make sure that any agentically running promises in old instance don't affect our new task. this essentially creates a fresh slate for the new task
						await this.initClineWithTask(message.text, message.images)
						break
					case "apiConfiguration":
						if (message.apiConfiguration) {
							await this.updateApiConfiguration(message.apiConfiguration)
						}
						await this.postStateToWebview()
						break
					case "customInstructions":
						await this.updateCustomInstructions(message.text)
						break
					case "alwaysAllowReadOnly":
						await this.updateGlobalState("alwaysAllowReadOnly", message.bool ?? undefined)
						await this.postStateToWebview()
						break
					case "alwaysAllowReadOnlyOutsideWorkspace":
						await this.updateGlobalState("alwaysAllowReadOnlyOutsideWorkspace", message.bool ?? undefined)
						await this.postStateToWebview()
						break
					case "alwaysAllowWrite":
						await this.updateGlobalState("alwaysAllowWrite", message.bool ?? undefined)
						await this.postStateToWebview()
						break
					case "alwaysAllowWriteOutsideWorkspace":
						await this.updateGlobalState("alwaysAllowWriteOutsideWorkspace", message.bool ?? undefined)
						await this.postStateToWebview()
						break
					case "alwaysAllowExecute":
						await this.updateGlobalState("alwaysAllowExecute", message.bool ?? undefined)
						await this.postStateToWebview()
						break
					case "alwaysAllowBrowser":
						await this.updateGlobalState("alwaysAllowBrowser", message.bool ?? undefined)
						await this.postStateToWebview()
						break
					case "alwaysAllowMcp":
						await this.updateGlobalState("alwaysAllowMcp", message.bool)
						await this.postStateToWebview()
						break
					case "alwaysAllowModeSwitch":
						await this.updateGlobalState("alwaysAllowModeSwitch", message.bool)
						await this.postStateToWebview()
						break
					case "alwaysAllowSubtasks":
						await this.updateGlobalState("alwaysAllowSubtasks", message.bool)
						await this.postStateToWebview()
						break
					case "askResponse":
						this.getCurrentCline()?.handleWebviewAskResponse(
							message.askResponse!,
							message.text,
							message.images,
						)
						break
					case "clearTask":
						// clear task resets the current session and allows for a new task to be started, if this session is a subtask - it allows the parent task to be resumed
						await this.finishSubTask(t("common:tasks.canceled"))
						await this.postStateToWebview()
						break
					case "didShowAnnouncement":
						await this.updateGlobalState("lastShownAnnouncementId", this.latestAnnouncementId)
						await this.postStateToWebview()
						break
					case "selectImages":
						const images = await selectImages()
						await this.postMessageToWebview({ type: "selectedImages", images })
						break
					case "exportCurrentTask":
						const currentTaskId = this.getCurrentCline()?.taskId
						if (currentTaskId) {
							this.exportTaskWithId(currentTaskId)
						}
						break
					case "showTaskWithId":
						this.showTaskWithId(message.text!)
						break
					case "deleteTaskWithId":
						this.deleteTaskWithId(message.text!)
						break
					case "deleteMultipleTasksWithIds": {
						const ids = message.ids
						if (Array.isArray(ids)) {
							// Process in batches of 20 (or another reasonable number)
							const batchSize = 20
							const results = []

							// Only log start and end of the operation
							console.log(`Batch deletion started: ${ids.length} tasks total`)

							for (let i = 0; i < ids.length; i += batchSize) {
								const batch = ids.slice(i, i + batchSize)

								const batchPromises = batch.map(async (id) => {
									try {
										await this.deleteTaskWithId(id)
										return { id, success: true }
									} catch (error) {
										// Keep error logging for debugging purposes
										console.log(
											`Failed to delete task ${id}: ${error instanceof Error ? error.message : String(error)}`,
										)
										return { id, success: false }
									}
								})

								// Process each batch in parallel but wait for completion before starting the next batch
								const batchResults = await Promise.all(batchPromises)
								results.push(...batchResults)

								// Update the UI after each batch to show progress
								await this.postStateToWebview()
							}

							// Log final results
							const successCount = results.filter((r) => r.success).length
							const failCount = results.length - successCount
							console.log(
								`Batch deletion completed: ${successCount}/${ids.length} tasks successful, ${failCount} tasks failed`,
							)
						}
						break
					}
					case "exportTaskWithId":
						this.exportTaskWithId(message.text!)
						break
					case "resetState":
						await this.resetState()
						break
					case "refreshOpenRouterModels": {
						const { apiConfiguration: configForRefresh } = await this.getState()
						const openRouterModels = await getOpenRouterModels(configForRefresh)

						if (Object.keys(openRouterModels).length > 0) {
							const cacheDir = await this.ensureCacheDirectoryExists()
							await fs.writeFile(
								path.join(cacheDir, GlobalFileNames.openRouterModels),
								JSON.stringify(openRouterModels),
							)
							await this.postMessageToWebview({ type: "openRouterModels", openRouterModels })
						}

						break
					}
					case "refreshGlamaModels":
						const glamaModels = await getGlamaModels()

						if (Object.keys(glamaModels).length > 0) {
							const cacheDir = await this.ensureCacheDirectoryExists()
							await fs.writeFile(
								path.join(cacheDir, GlobalFileNames.glamaModels),
								JSON.stringify(glamaModels),
							)
							await this.postMessageToWebview({ type: "glamaModels", glamaModels })
						}

						break
					case "refreshUnboundModels":
						const unboundModels = await getUnboundModels()

						if (Object.keys(unboundModels).length > 0) {
							const cacheDir = await this.ensureCacheDirectoryExists()
							await fs.writeFile(
								path.join(cacheDir, GlobalFileNames.unboundModels),
								JSON.stringify(unboundModels),
							)
							await this.postMessageToWebview({ type: "unboundModels", unboundModels })
						}

						break
					case "refreshRequestyModels":
						const requestyModels = await getRequestyModels()

						if (Object.keys(requestyModels).length > 0) {
							const cacheDir = await this.ensureCacheDirectoryExists()
							await fs.writeFile(
								path.join(cacheDir, GlobalFileNames.requestyModels),
								JSON.stringify(requestyModels),
							)
							await this.postMessageToWebview({ type: "requestyModels", requestyModels })
						}

						break
					case "refreshOpenAiModels":
						if (message?.values?.baseUrl && message?.values?.apiKey) {
							const openAiModels = await getOpenAiModels(
								message?.values?.baseUrl,
								message?.values?.apiKey,
							)
							this.postMessageToWebview({ type: "openAiModels", openAiModels })
						}

						break
					case "requestOllamaModels":
						const ollamaModels = await getOllamaModels(message.text)
						// TODO: Cache like we do for OpenRouter, etc?
						this.postMessageToWebview({ type: "ollamaModels", ollamaModels })
						break
					case "requestLmStudioModels":
						const lmStudioModels = await getLmStudioModels(message.text)
						// TODO: Cache like we do for OpenRouter, etc?
						this.postMessageToWebview({ type: "lmStudioModels", lmStudioModels })
						break
					case "requestVsCodeLmModels":
						const vsCodeLmModels = await getVsCodeLmModels()
						// TODO: Cache like we do for OpenRouter, etc?
						this.postMessageToWebview({ type: "vsCodeLmModels", vsCodeLmModels })
						break
					case "openImage":
						openImage(message.text!)
						break
					case "openFile":
						openFile(message.text!, message.values as { create?: boolean; content?: string })
						break
					case "openMention":
						openMention(message.text)
						break
					case "checkpointDiff":
						const result = checkoutDiffPayloadSchema.safeParse(message.payload)

						if (result.success) {
							await this.getCurrentCline()?.checkpointDiff(result.data)
						}

						break
					case "checkpointRestore": {
						const result = checkoutRestorePayloadSchema.safeParse(message.payload)

						if (result.success) {
							await this.cancelTask()

							try {
								await pWaitFor(() => this.getCurrentCline()?.isInitialized === true, { timeout: 3_000 })
							} catch (error) {
								vscode.window.showErrorMessage(t("common:errors.checkpoint_timeout"))
							}

							try {
								await this.getCurrentCline()?.checkpointRestore(result.data)
							} catch (error) {
								vscode.window.showErrorMessage(t("common:errors.checkpoint_failed"))
							}
						}

						break
					}
					case "cancelTask":
						await this.cancelTask()
						break
					case "allowedCommands":
						await this.context.globalState.update("allowedCommands", message.commands)
						// Also update workspace settings
						await vscode.workspace
							.getConfiguration("roo-cline")
							.update("allowedCommands", message.commands, vscode.ConfigurationTarget.Global)
						break
					case "openMcpSettings": {
						const mcpSettingsFilePath = await this.mcpHub?.getMcpSettingsFilePath()
						if (mcpSettingsFilePath) {
							openFile(mcpSettingsFilePath)
						}
						break
					}
					case "openCustomModesSettings": {
						const customModesFilePath = await this.customModesManager.getCustomModesFilePath()
						if (customModesFilePath) {
							openFile(customModesFilePath)
						}
						break
					}
					case "deleteMcpServer": {
						if (!message.serverName) {
							break
						}

						try {
							this.outputChannel.appendLine(`Attempting to delete MCP server: ${message.serverName}`)
							await this.mcpHub?.deleteServer(message.serverName)
							this.outputChannel.appendLine(`Successfully deleted MCP server: ${message.serverName}`)
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error)
							this.outputChannel.appendLine(`Failed to delete MCP server: ${errorMessage}`)
							// Error messages are already handled by McpHub.deleteServer
						}
						break
					}
					case "restartMcpServer": {
						try {
							await this.mcpHub?.restartConnection(message.text!)
						} catch (error) {
							this.outputChannel.appendLine(
								`Failed to retry connection for ${message.text}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
						}
						break
					}
					case "toggleToolAlwaysAllow": {
						try {
							await this.mcpHub?.toggleToolAlwaysAllow(
								message.serverName!,
								message.toolName!,
								message.alwaysAllow!,
							)
						} catch (error) {
							this.outputChannel.appendLine(
								`Failed to toggle auto-approve for tool ${message.toolName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
						}
						break
					}
					case "toggleMcpServer": {
						try {
							await this.mcpHub?.toggleServerDisabled(message.serverName!, message.disabled!)
						} catch (error) {
							this.outputChannel.appendLine(
								`Failed to toggle MCP server ${message.serverName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
						}
						break
					}
					case "mcpEnabled":
						const mcpEnabled = message.bool ?? true
						await this.updateGlobalState("mcpEnabled", mcpEnabled)
						await this.postStateToWebview()
						break
					case "enableMcpServerCreation":
						await this.updateGlobalState("enableMcpServerCreation", message.bool ?? true)
						await this.postStateToWebview()
						break
					case "playSound":
						if (message.audioType) {
							const soundPath = path.join(this.context.extensionPath, "audio", `${message.audioType}.wav`)
							playSound(soundPath)
						}
						break
					case "soundEnabled":
						const soundEnabled = message.bool ?? true
						await this.updateGlobalState("soundEnabled", soundEnabled)
						setSoundEnabled(soundEnabled) // Add this line to update the sound utility
						await this.postStateToWebview()
						break
					case "soundVolume":
						const soundVolume = message.value ?? 0.5
						await this.updateGlobalState("soundVolume", soundVolume)
						setSoundVolume(soundVolume)
						await this.postStateToWebview()
						break
					case "ttsEnabled":
						const ttsEnabled = message.bool ?? true
						await this.updateGlobalState("ttsEnabled", ttsEnabled)
						setTtsEnabled(ttsEnabled) // Add this line to update the tts utility
						await this.postStateToWebview()
						break
					case "ttsSpeed":
						const ttsSpeed = message.value ?? 1.0
						await this.updateGlobalState("ttsSpeed", ttsSpeed)
						setTtsSpeed(ttsSpeed)
						await this.postStateToWebview()
						break
					case "playTts":
						if (message.text) {
							playTts(message.text, {
								onStart: () => this.postMessageToWebview({ type: "ttsStart", text: message.text }),
								onStop: () => this.postMessageToWebview({ type: "ttsStop", text: message.text }),
							})
						}
						break
					case "stopTts":
						stopTts()
						break
					case "diffEnabled":
						const diffEnabled = message.bool ?? true
						await this.updateGlobalState("diffEnabled", diffEnabled)
						await this.postStateToWebview()
						break
					case "enableCheckpoints":
						const enableCheckpoints = message.bool ?? true
						await this.updateGlobalState("enableCheckpoints", enableCheckpoints)
						await this.postStateToWebview()
						break
					case "checkpointStorage":
						console.log(`[ClineProvider] checkpointStorage: ${message.text}`)
						const checkpointStorage = message.text ?? "task"
						await this.updateGlobalState("checkpointStorage", checkpointStorage)
						await this.postStateToWebview()
						break
					case "browserViewportSize":
						const browserViewportSize = message.text ?? "900x600"
						await this.updateGlobalState("browserViewportSize", browserViewportSize)
						await this.postStateToWebview()
						break
					case "remoteBrowserHost":
						await this.updateGlobalState("remoteBrowserHost", message.text)
						await this.postStateToWebview()
						break
					case "remoteBrowserEnabled":
						// Store the preference in global state
						// remoteBrowserEnabled now means "enable remote browser connection"
						await this.updateGlobalState("remoteBrowserEnabled", message.bool ?? false)
						// If disabling remote browser connection, clear the remoteBrowserHost
						if (!message.bool) {
							await this.updateGlobalState("remoteBrowserHost", undefined)
						}
						await this.postStateToWebview()
						break
					case "testBrowserConnection":
						try {
							const browserSession = new BrowserSession(this.context)
							// If no text is provided, try auto-discovery
							if (!message.text) {
								try {
									const discoveredHost = await discoverChromeInstances()
									if (discoveredHost) {
										// Test the connection to the discovered host
										const result = await browserSession.testConnection(discoveredHost)
										// Send the result back to the webview
										await this.postMessageToWebview({
											type: "browserConnectionResult",
											success: result.success,
											text: `Auto-discovered and tested connection to Chrome at ${discoveredHost}: ${result.message}`,
											values: { endpoint: result.endpoint },
										})
									} else {
										await this.postMessageToWebview({
											type: "browserConnectionResult",
											success: false,
											text: "No Chrome instances found on the network. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
										})
									}
								} catch (error) {
									await this.postMessageToWebview({
										type: "browserConnectionResult",
										success: false,
										text: `Error during auto-discovery: ${error instanceof Error ? error.message : String(error)}`,
									})
								}
							} else {
								// Test the provided URL
								const result = await browserSession.testConnection(message.text)

								// Send the result back to the webview
								await this.postMessageToWebview({
									type: "browserConnectionResult",
									success: result.success,
									text: result.message,
									values: { endpoint: result.endpoint },
								})
							}
						} catch (error) {
							await this.postMessageToWebview({
								type: "browserConnectionResult",
								success: false,
								text: `Error testing connection: ${error instanceof Error ? error.message : String(error)}`,
							})
						}
						break
					case "discoverBrowser":
						try {
							const discoveredHost = await discoverChromeInstances()

							if (discoveredHost) {
								// Don't update the remoteBrowserHost state when auto-discovering
								// This way we don't override the user's preference

								// Test the connection to get the endpoint
								const browserSession = new BrowserSession(this.context)
								const result = await browserSession.testConnection(discoveredHost)

								// Send the result back to the webview
								await this.postMessageToWebview({
									type: "browserConnectionResult",
									success: true,
									text: `Successfully discovered and connected to Chrome at ${discoveredHost}`,
									values: { endpoint: result.endpoint },
								})
							} else {
								await this.postMessageToWebview({
									type: "browserConnectionResult",
									success: false,
									text: "No Chrome instances found on the network. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
								})
							}
						} catch (error) {
							await this.postMessageToWebview({
								type: "browserConnectionResult",
								success: false,
								text: `Error discovering browser: ${error instanceof Error ? error.message : String(error)}`,
							})
						}
						break
					case "fuzzyMatchThreshold":
						await this.updateGlobalState("fuzzyMatchThreshold", message.value)
						await this.postStateToWebview()
						break
					case "alwaysApproveResubmit":
						await this.updateGlobalState("alwaysApproveResubmit", message.bool ?? false)
						await this.postStateToWebview()
						break
					case "requestDelaySeconds":
						await this.updateGlobalState("requestDelaySeconds", message.value ?? 5)
						await this.postStateToWebview()
						break
					case "rateLimitSeconds":
						await this.updateGlobalState("rateLimitSeconds", message.value ?? 0)
						await this.postStateToWebview()
						break
					case "writeDelayMs":
						await this.updateGlobalState("writeDelayMs", message.value)
						await this.postStateToWebview()
						break
					case "terminalOutputLineLimit":
						await this.updateGlobalState("terminalOutputLineLimit", message.value)
						await this.postStateToWebview()
						break
					case "terminalShellIntegrationTimeout":
						await this.updateGlobalState("terminalShellIntegrationTimeout", message.value)
						await this.postStateToWebview()
						if (message.value !== undefined) {
							Terminal.setShellIntegrationTimeout(message.value)
						}
						break
					case "mode":
						await this.handleModeSwitch(message.text as Mode)
						break
					case "updateSupportPrompt":
						try {
							if (Object.keys(message?.values ?? {}).length === 0) {
								return
							}

							const existingPrompts = (await this.getGlobalState("customSupportPrompts")) || {}

							const updatedPrompts = {
								...existingPrompts,
								...message.values,
							}

							await this.updateGlobalState("customSupportPrompts", updatedPrompts)
							await this.postStateToWebview()
						} catch (error) {
							this.outputChannel.appendLine(
								`Error update support prompt: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
							vscode.window.showErrorMessage(t("common:errors.update_support_prompt"))
						}
						break
					case "resetSupportPrompt":
						try {
							if (!message?.text) {
								return
							}

							const existingPrompts = ((await this.getGlobalState("customSupportPrompts")) ||
								{}) as Record<string, any>

							const updatedPrompts = {
								...existingPrompts,
							}

							updatedPrompts[message.text] = undefined

							await this.updateGlobalState("customSupportPrompts", updatedPrompts)
							await this.postStateToWebview()
						} catch (error) {
							this.outputChannel.appendLine(
								`Error reset support prompt: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
							vscode.window.showErrorMessage(t("common:errors.reset_support_prompt"))
						}
						break
					case "updatePrompt":
						if (message.promptMode && message.customPrompt !== undefined) {
							const existingPrompts = (await this.getGlobalState("customModePrompts")) || {}

							const updatedPrompts = {
								...existingPrompts,
								[message.promptMode]: message.customPrompt,
							}

							await this.updateGlobalState("customModePrompts", updatedPrompts)

							// Get current state and explicitly include customModePrompts
							const currentState = await this.getState()

							const stateWithPrompts = {
								...currentState,
								customModePrompts: updatedPrompts,
							}

							// Post state with prompts
							this.view?.webview.postMessage({
								type: "state",
								state: stateWithPrompts,
							})
						}
						break
					case "deleteMessage": {
						const answer = await vscode.window.showInformationMessage(
							t("common:confirmation.delete_message"),
							{ modal: true },
							t("common:confirmation.just_this_message"),
							t("common:confirmation.this_and_subsequent"),
						)
						if (
							(answer === t("common:confirmation.just_this_message") ||
								answer === t("common:confirmation.this_and_subsequent")) &&
							this.getCurrentCline() &&
							typeof message.value === "number" &&
							message.value
						) {
							const timeCutoff = message.value - 1000 // 1 second buffer before the message to delete
							const messageIndex = this.getCurrentCline()!.clineMessages.findIndex(
								(msg) => msg.ts && msg.ts >= timeCutoff,
							)
							const apiConversationHistoryIndex =
								this.getCurrentCline()?.apiConversationHistory.findIndex(
									(msg) => msg.ts && msg.ts >= timeCutoff,
								)

							if (messageIndex !== -1) {
								const { historyItem } = await this.getTaskWithId(this.getCurrentCline()!.taskId)

								if (answer === t("common:confirmation.just_this_message")) {
									// Find the next user message first
									const nextUserMessage = this.getCurrentCline()!
										.clineMessages.slice(messageIndex + 1)
										.find((msg) => msg.type === "say" && msg.say === "user_feedback")

									// Handle UI messages
									if (nextUserMessage) {
										// Find absolute index of next user message
										const nextUserMessageIndex = this.getCurrentCline()!.clineMessages.findIndex(
											(msg) => msg === nextUserMessage,
										)
										// Keep messages before current message and after next user message
										await this.getCurrentCline()!.overwriteClineMessages([
											...this.getCurrentCline()!.clineMessages.slice(0, messageIndex),
											...this.getCurrentCline()!.clineMessages.slice(nextUserMessageIndex),
										])
									} else {
										// If no next user message, keep only messages before current message
										await this.getCurrentCline()!.overwriteClineMessages(
											this.getCurrentCline()!.clineMessages.slice(0, messageIndex),
										)
									}

									// Handle API messages
									if (apiConversationHistoryIndex !== -1) {
										if (nextUserMessage && nextUserMessage.ts) {
											// Keep messages before current API message and after next user message
											await this.getCurrentCline()!.overwriteApiConversationHistory([
												...this.getCurrentCline()!.apiConversationHistory.slice(
													0,
													apiConversationHistoryIndex,
												),
												...this.getCurrentCline()!.apiConversationHistory.filter(
													(msg) => msg.ts && msg.ts >= nextUserMessage.ts,
												),
											])
										} else {
											// If no next user message, keep only messages before current API message
											await this.getCurrentCline()!.overwriteApiConversationHistory(
												this.getCurrentCline()!.apiConversationHistory.slice(
													0,
													apiConversationHistoryIndex,
												),
											)
										}
									}
								} else if (answer === t("common:confirmation.this_and_subsequent")) {
									// Delete this message and all that follow
									await this.getCurrentCline()!.overwriteClineMessages(
										this.getCurrentCline()!.clineMessages.slice(0, messageIndex),
									)
									if (apiConversationHistoryIndex !== -1) {
										await this.getCurrentCline()!.overwriteApiConversationHistory(
											this.getCurrentCline()!.apiConversationHistory.slice(
												0,
												apiConversationHistoryIndex,
											),
										)
									}
								}

								await this.initClineWithHistoryItem(historyItem)
							}
						}
						break
					}
					case "screenshotQuality":
						await this.updateGlobalState("screenshotQuality", message.value)
						await this.postStateToWebview()
						break
					case "maxOpenTabsContext":
						const tabCount = Math.min(Math.max(0, message.value ?? 20), 500)
						await this.updateGlobalState("maxOpenTabsContext", tabCount)
						await this.postStateToWebview()
						break
					case "maxWorkspaceFiles":
						const fileCount = Math.min(Math.max(0, message.value ?? 200), 500)
						await this.updateGlobalState("maxWorkspaceFiles", fileCount)
						await this.postStateToWebview()
						break
					case "browserToolEnabled":
						await this.updateGlobalState("browserToolEnabled", message.bool ?? true)
						await this.postStateToWebview()
						break
					case "language":
						changeLanguage(message.text ?? "en")
						await this.updateGlobalState("language", message.text)
						await this.postStateToWebview()
						break
					case "showRooIgnoredFiles":
						await this.updateGlobalState("showRooIgnoredFiles", message.bool ?? true)
						await this.postStateToWebview()
						break
					case "maxReadFileLine":
						await this.updateGlobalState("maxReadFileLine", message.value)
						await this.postStateToWebview()
						break
					case "toggleApiConfigPin":
						if (message.text) {
							const currentPinned = ((await this.getGlobalState("pinnedApiConfigs")) || {}) as Record<
								string,
								boolean
							>
							const updatedPinned: Record<string, boolean> = { ...currentPinned }

							// Toggle the pinned state
							if (currentPinned[message.text]) {
								delete updatedPinned[message.text]
							} else {
								updatedPinned[message.text] = true
							}

							await this.updateGlobalState("pinnedApiConfigs", updatedPinned)
							await this.postStateToWebview()
						}
						break
					case "enhancementApiConfigId":
						await this.updateGlobalState("enhancementApiConfigId", message.text)
						await this.postStateToWebview()
						break
					case "autoApprovalEnabled":
						await this.updateGlobalState("autoApprovalEnabled", message.bool ?? false)
						await this.postStateToWebview()
						break
					case "enhancePrompt":
						if (message.text) {
							try {
								const {
									apiConfiguration,
									customSupportPrompts,
									listApiConfigMeta,
									enhancementApiConfigId,
								} = await this.getState()

								// Try to get enhancement config first, fall back to current config
								let configToUse: ApiConfiguration = apiConfiguration
								if (enhancementApiConfigId) {
									const config = listApiConfigMeta?.find(
										(c: ApiConfigMeta) => c.id === enhancementApiConfigId,
									)
									if (config?.name) {
										const loadedConfig = await this.configManager.loadConfig(config.name)
										if (loadedConfig.apiProvider) {
											configToUse = loadedConfig
										}
									}
								}

								const enhancedPrompt = await singleCompletionHandler(
									configToUse,
									supportPrompt.create(
										"ENHANCE",
										{
											userInput: message.text,
										},
										customSupportPrompts,
									),
								)

								await this.postMessageToWebview({
									type: "enhancedPrompt",
									text: enhancedPrompt,
								})
							} catch (error) {
								this.outputChannel.appendLine(
									`Error enhancing prompt: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.enhance_prompt"))
								await this.postMessageToWebview({
									type: "enhancedPrompt",
								})
							}
						}
						break
					case "getSystemPrompt":
						try {
							const systemPrompt = await generateSystemPrompt(message)

							await this.postMessageToWebview({
								type: "systemPrompt",
								text: systemPrompt,
								mode: message.mode,
							})
						} catch (error) {
							this.outputChannel.appendLine(
								`Error getting system prompt:  ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
							vscode.window.showErrorMessage(t("common:errors.get_system_prompt"))
						}
						break
					case "copySystemPrompt":
						try {
							const systemPrompt = await generateSystemPrompt(message)

							await vscode.env.clipboard.writeText(systemPrompt)
							await vscode.window.showInformationMessage(t("common:info.clipboard_copy"))
						} catch (error) {
							this.outputChannel.appendLine(
								`Error getting system prompt:  ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
							vscode.window.showErrorMessage(t("common:errors.get_system_prompt"))
						}
						break
					case "searchCommits": {
						const cwd = this.cwd
						if (cwd) {
							try {
								const commits = await searchCommits(message.query || "", cwd)
								await this.postMessageToWebview({
									type: "commitSearchResults",
									commits,
								})
							} catch (error) {
								this.outputChannel.appendLine(
									`Error searching commits: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.search_commits"))
							}
						}
						break
					}
					case "searchFiles": {
						const workspacePath = getWorkspacePath()

						if (!workspacePath) {
							// Handle case where workspace path is not available
							await this.postMessageToWebview({
								type: "fileSearchResults",
								results: [],
								requestId: message.requestId,
								error: "No workspace path available",
							})
							break
						}
						try {
							// Call file search service with query from message
							const results = await searchWorkspaceFiles(
								message.query || "",
								workspacePath,
								20, // Use default limit, as filtering is now done in the backend
							)

							// Send results back to webview
							await this.postMessageToWebview({
								type: "fileSearchResults",
								results,
								requestId: message.requestId,
							})
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error)

							// Send error response to webview
							await this.postMessageToWebview({
								type: "fileSearchResults",
								results: [],
								error: errorMessage,
								requestId: message.requestId,
							})
						}
						break
					}
					case "saveApiConfiguration":
						if (message.text && message.apiConfiguration) {
							try {
								await this.configManager.saveConfig(message.text, message.apiConfiguration)
								const listApiConfig = await this.configManager.listConfig()
								await this.updateGlobalState("listApiConfigMeta", listApiConfig)
							} catch (error) {
								this.outputChannel.appendLine(
									`Error save api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.save_api_config"))
							}
						}
						break
					case "upsertApiConfiguration":
						if (message.text && message.apiConfiguration) {
							await this.upsertApiConfiguration(message.text, message.apiConfiguration)
						}
						break
					case "renameApiConfiguration":
						if (message.values && message.apiConfiguration) {
							try {
								const { oldName, newName } = message.values

								if (oldName === newName) {
									break
								}

								// Load the old configuration to get its ID
								const oldConfig = await this.configManager.loadConfig(oldName)

								// Create a new configuration with the same ID
								const newConfig = {
									...message.apiConfiguration,
									id: oldConfig.id, // Preserve the ID
								}

								// Save with the new name but same ID
								await this.configManager.saveConfig(newName, newConfig)
								await this.configManager.deleteConfig(oldName)

								const listApiConfig = await this.configManager.listConfig()

								// Update listApiConfigMeta first to ensure UI has latest data
								await this.updateGlobalState("listApiConfigMeta", listApiConfig)
								await this.updateGlobalState("currentApiConfigName", newName)

								await this.postStateToWebview()
							} catch (error) {
								this.outputChannel.appendLine(
									`Error rename api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.rename_api_config"))
							}
						}
						break
					case "loadApiConfiguration":
						if (message.text) {
							try {
								const apiConfig = await this.configManager.loadConfig(message.text)
								const listApiConfig = await this.configManager.listConfig()

								await Promise.all([
									this.updateGlobalState("listApiConfigMeta", listApiConfig),
									this.updateGlobalState("currentApiConfigName", message.text),
									this.updateApiConfiguration(apiConfig),
								])

								await this.postStateToWebview()
							} catch (error) {
								this.outputChannel.appendLine(
									`Error load api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.load_api_config"))
							}
						}
						break
					case "loadApiConfigurationById":
						if (message.text) {
							try {
								const { config: apiConfig, name } = await this.configManager.loadConfigById(
									message.text,
								)
								const listApiConfig = await this.configManager.listConfig()

								await Promise.all([
									this.updateGlobalState("listApiConfigMeta", listApiConfig),
									this.updateGlobalState("currentApiConfigName", name),
									this.updateApiConfiguration(apiConfig),
								])

								await this.postStateToWebview()
							} catch (error) {
								this.outputChannel.appendLine(
									`Error load api configuration by ID: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.load_api_config"))
							}
						}
						break
					case "deleteApiConfiguration":
						if (message.text) {
							const answer = await vscode.window.showInformationMessage(
								t("common:confirmation.delete_config_profile"),
								{ modal: true },
								t("common:answers.yes"),
							)

							if (answer !== t("common:answers.yes")) {
								break
							}

							try {
								await this.configManager.deleteConfig(message.text)
								const listApiConfig = await this.configManager.listConfig()

								// Update listApiConfigMeta first to ensure UI has latest data
								await this.updateGlobalState("listApiConfigMeta", listApiConfig)

								// If this was the current config, switch to first available
								const currentApiConfigName = await this.getGlobalState("currentApiConfigName")
								if (message.text === currentApiConfigName && listApiConfig?.[0]?.name) {
									const apiConfig = await this.configManager.loadConfig(listApiConfig[0].name)
									await Promise.all([
										this.updateGlobalState("currentApiConfigName", listApiConfig[0].name),
										this.updateApiConfiguration(apiConfig),
									])
								}

								await this.postStateToWebview()
							} catch (error) {
								this.outputChannel.appendLine(
									`Error delete api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.delete_api_config"))
							}
						}
						break
					case "getListApiConfiguration":
						try {
							const listApiConfig = await this.configManager.listConfig()
							await this.updateGlobalState("listApiConfigMeta", listApiConfig)
							this.postMessageToWebview({ type: "listApiConfig", listApiConfig })
						} catch (error) {
							this.outputChannel.appendLine(
								`Error get list api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
							)
							vscode.window.showErrorMessage(t("common:errors.list_api_config"))
						}
						break
					case "updateExperimental": {
						if (!message.values) {
							break
						}

						const updatedExperiments = {
							...((await this.getGlobalState("experiments")) ?? experimentDefault),
							...message.values,
						} as Record<ExperimentId, boolean>

						await this.updateGlobalState("experiments", updatedExperiments)

						// Update diffStrategy in current Cline instance if it exists
						if (message.values[EXPERIMENT_IDS.DIFF_STRATEGY] !== undefined && this.getCurrentCline()) {
							await this.getCurrentCline()!.updateDiffStrategy(
								Experiments.isEnabled(updatedExperiments, EXPERIMENT_IDS.DIFF_STRATEGY),
								Experiments.isEnabled(updatedExperiments, EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE),
							)
						}

						await this.postStateToWebview()
						break
					}
					case "updateMcpTimeout":
						if (message.serverName && typeof message.timeout === "number") {
							try {
								await this.mcpHub?.updateServerTimeout(message.serverName, message.timeout)
							} catch (error) {
								this.outputChannel.appendLine(
									`Failed to update timeout for ${message.serverName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
								)
								vscode.window.showErrorMessage(t("common:errors.update_server_timeout"))
							}
						}
						break
					case "updateCustomMode":
						if (message.modeConfig) {
							await this.customModesManager.updateCustomMode(message.modeConfig.slug, message.modeConfig)
							// Update state after saving the mode
							const customModes = await this.customModesManager.getCustomModes()
							await this.updateGlobalState("customModes", customModes)
							await this.updateGlobalState("mode", message.modeConfig.slug)
							await this.postStateToWebview()
						}
						break
					case "deleteCustomMode":
						if (message.slug) {
							const answer = await vscode.window.showInformationMessage(
								t("common:confirmation.delete_custom_mode"),
								{ modal: true },
								t("common:answers.yes"),
							)

							if (answer !== t("common:answers.yes")) {
								break
							}

							await this.customModesManager.deleteCustomMode(message.slug)
							// Switch back to default mode after deletion
							await this.updateGlobalState("mode", defaultModeSlug)
							await this.postStateToWebview()
						}
						break
					case "humanRelayResponse":
						if (message.requestId && message.text) {
							vscode.commands.executeCommand("roo-cline.handleHumanRelayResponse", {
								requestId: message.requestId,
								text: message.text,
								cancelled: false,
							})
						}
						break

					case "humanRelayCancel":
						if (message.requestId) {
							vscode.commands.executeCommand("roo-cline.handleHumanRelayResponse", {
								requestId: message.requestId,
								cancelled: true,
							})
						}
						break

					case "telemetrySetting": {
						const telemetrySetting = message.text as TelemetrySetting
						await this.updateGlobalState("telemetrySetting", telemetrySetting)
						const isOptedIn = telemetrySetting === "enabled"
						telemetryService.updateTelemetryState(isOptedIn)
						await this.postStateToWebview()
						break
					}
				}
			},
			null,
			this.disposables,
		)

		const generateSystemPrompt = async (message: WebviewMessage) => {
			const {
				apiConfiguration,
				customModePrompts,
				customInstructions,
				browserViewportSize,
				diffEnabled,
				mcpEnabled,
				fuzzyMatchThreshold,
				experiments,
				enableMcpServerCreation,
				browserToolEnabled,
				language,
			} = await this.getState()

			// Create diffStrategy based on current model and settings
			const diffStrategy = getDiffStrategy(
				apiConfiguration.apiModelId || apiConfiguration.openRouterModelId || "",
				fuzzyMatchThreshold,
				Experiments.isEnabled(experiments, EXPERIMENT_IDS.DIFF_STRATEGY),
				Experiments.isEnabled(experiments, EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE),
			)
			const cwd = this.cwd

			const mode = message.mode ?? defaultModeSlug
			const customModes = await this.customModesManager.getCustomModes()

			const rooIgnoreInstructions = this.getCurrentCline()?.rooIgnoreController?.getInstructions()

			// Determine if browser tools can be used based on model support, mode, and user settings
			let modelSupportsComputerUse = false

			// Create a temporary API handler to check if the model supports computer use
			// This avoids relying on an active Cline instance which might not exist during preview
			try {
				const tempApiHandler = buildApiHandler(apiConfiguration)
				modelSupportsComputerUse = tempApiHandler.getModel().info.supportsComputerUse ?? false
			} catch (error) {
				console.error("Error checking if model supports computer use:", error)
			}

			// Check if the current mode includes the browser tool group
			const modeConfig = getModeBySlug(mode, customModes)
			const modeSupportsBrowser = modeConfig?.groups.some((group) => getGroupName(group) === "browser") ?? false

			// Only enable browser tools if the model supports it, the mode includes browser tools,
			// and browser tools are enabled in settings
			const canUseBrowserTool = modelSupportsComputerUse && modeSupportsBrowser && (browserToolEnabled ?? true)

			const systemPrompt = await SYSTEM_PROMPT(
				this.context,
				cwd,
				canUseBrowserTool,
				mcpEnabled ? this.mcpHub : undefined,
				diffStrategy,
				browserViewportSize ?? "900x600",
				mode,
				customModePrompts,
				customModes,
				customInstructions,
				diffEnabled,
				experiments,
				enableMcpServerCreation,
				language,
				rooIgnoreInstructions,
			)
			return systemPrompt
		}
	}

	/**
	 * Handle switching to a new mode, including updating the associated API configuration
	 * @param newMode The mode to switch to
	 */
	public async handleModeSwitch(newMode: Mode) {
		// Capture mode switch telemetry event
		const currentTaskId = this.getCurrentCline()?.taskId
		if (currentTaskId) {
			telemetryService.captureModeSwitch(currentTaskId, newMode)
		}

		await this.updateGlobalState("mode", newMode)

		// Load the saved API config for the new mode if it exists
		const savedConfigId = await this.configManager.getModeConfigId(newMode)
		const listApiConfig = await this.configManager.listConfig()

		// Update listApiConfigMeta first to ensure UI has latest data
		await this.updateGlobalState("listApiConfigMeta", listApiConfig)

		// If this mode has a saved config, use it
		if (savedConfigId) {
			const config = listApiConfig?.find((c) => c.id === savedConfigId)
			if (config?.name) {
				const apiConfig = await this.configManager.loadConfig(config.name)
				await Promise.all([
					this.updateGlobalState("currentApiConfigName", config.name),
					this.updateApiConfiguration(apiConfig),
				])
			}
		} else {
			// If no saved config for this mode, save current config as default
			const currentApiConfigName = await this.getGlobalState("currentApiConfigName")
			if (currentApiConfigName) {
				const config = listApiConfig?.find((c) => c.name === currentApiConfigName)
				if (config?.id) {
					await this.configManager.setModeConfig(newMode, config.id)
				}
			}
		}

		await this.postStateToWebview()
	}

	private async updateApiConfiguration(apiConfiguration: ApiConfiguration) {
		// Update mode's default config.
		const { mode } = await this.getState()

		if (mode) {
			const currentApiConfigName = await this.getGlobalState("currentApiConfigName")
			const listApiConfig = await this.configManager.listConfig()
			const config = listApiConfig?.find((c) => c.name === currentApiConfigName)

			if (config?.id) {
				await this.configManager.setModeConfig(mode, config.id)
			}
		}
		await this.contextProxy.setApiConfiguration(apiConfiguration)

		if (this.getCurrentCline()) {
			this.getCurrentCline()!.api = buildApiHandler(apiConfiguration)
		}
	}

	async cancelTask() {
		const cline = this.getCurrentCline()

		if (!cline) {
			return
		}

		console.log(`[subtasks] cancelling task ${cline.taskId}.${cline.instanceId}`)

		const { historyItem } = await this.getTaskWithId(cline.taskId)
		// Preserve parent and root task information for history item.
		const rootTask = cline.rootTask
		const parentTask = cline.parentTask

		cline.abortTask()

		await pWaitFor(
			() =>
				this.getCurrentCline()! === undefined ||
				this.getCurrentCline()!.isStreaming === false ||
				this.getCurrentCline()!.didFinishAbortingStream ||
				// If only the first chunk is processed, then there's no
				// need to wait for graceful abort (closes edits, browser,
				// etc).
				this.getCurrentCline()!.isWaitingForFirstChunk,
			{
				timeout: 3_000,
			},
		).catch(() => {
			console.error("Failed to abort task")
		})

		if (this.getCurrentCline()) {
			// 'abandoned' will prevent this Cline instance from affecting
			// future Cline instances. This may happen if its hanging on a
			// streaming request.
			this.getCurrentCline()!.abandoned = true
		}

		// Clears task again, so we need to abortTask manually above.
		await this.initClineWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field.
		await this.updateGlobalState("customInstructions", instructions || undefined)

		if (this.getCurrentCline()) {
			this.getCurrentCline()!.customInstructions = instructions || undefined
		}

		await this.postStateToWebview()
	}

	// MCP

	async ensureMcpServersDirectoryExists(): Promise<string> {
		// Get platform-specific application data directory
		let mcpServersDir: string
		if (process.platform === "win32") {
			// Windows: %APPDATA%\Roo-Code\MCP
			mcpServersDir = path.join(os.homedir(), "AppData", "Roaming", "Roo-Code", "MCP")
		} else if (process.platform === "darwin") {
			// macOS: ~/Documents/Cline/MCP
			mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
		} else {
			// Linux: ~/.local/share/Cline/MCP
			mcpServersDir = path.join(os.homedir(), ".local", "share", "Roo-Code", "MCP")
		}

		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			// Fallback to a relative path if directory creation fails
			return path.join(os.homedir(), ".roo-code", "mcp")
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const { getSettingsDirectoryPath } = await import("../../shared/storagePathManager")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getSettingsDirectoryPath(globalStoragePath)
	}

	private async ensureCacheDirectoryExists() {
		const { getCacheDirectoryPath } = await import("../../shared/storagePathManager")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getCacheDirectoryPath(globalStoragePath)
	}

	private async readModelsFromCache(filename: string): Promise<Record<string, ModelInfo> | undefined> {
		const filePath = path.join(await this.ensureCacheDirectoryExists(), filename)
		const fileExists = await fileExistsAtPath(filePath)

		if (fileExists) {
			const fileContents = await fs.readFile(filePath, "utf8")
			return JSON.parse(fileContents)
		}

		return undefined
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let { apiConfiguration, currentApiConfigName } = await this.getState()

		let apiKey: string
		try {
			const baseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			// Extract the base domain for the auth endpoint
			const baseUrlDomain = baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"
			const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, { code })
			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			this.outputChannel.appendLine(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
			throw error
		}

		const newConfiguration: ApiConfiguration = {
			...apiConfiguration,
			apiProvider: "openrouter",
			openRouterApiKey: apiKey,
			openRouterModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
			openRouterModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
		}

		await this.upsertApiConfiguration(currentApiConfigName, newConfiguration)
	}

	// Glama

	async handleGlamaCallback(code: string) {
		let apiKey: string
		try {
			const response = await axios.post("https://glama.ai/api/gateway/v1/auth/exchange-code", { code })
			if (response.data && response.data.apiKey) {
				apiKey = response.data.apiKey
			} else {
				throw new Error("Invalid response from Glama API")
			}
		} catch (error) {
			this.outputChannel.appendLine(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
			throw error
		}

		const { apiConfiguration, currentApiConfigName } = await this.getState()

		const newConfiguration: ApiConfiguration = {
			...apiConfiguration,
			apiProvider: "glama",
			glamaApiKey: apiKey,
			glamaModelId: apiConfiguration?.glamaModelId || glamaDefaultModelId,
			glamaModelInfo: apiConfiguration?.glamaModelInfo || glamaDefaultModelInfo,
		}

		await this.upsertApiConfiguration(currentApiConfigName, newConfiguration)
	}

	// Requesty

	async handleRequestyCallback(code: string) {
		let { apiConfiguration, currentApiConfigName } = await this.getState()

		const newConfiguration: ApiConfiguration = {
			...apiConfiguration,
			apiProvider: "requesty",
			requestyApiKey: code,
			requestyModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
			requestyModelInfo: apiConfiguration?.requestyModelInfo || requestyDefaultModelInfo,
		}

		await this.upsertApiConfiguration(currentApiConfigName, newConfiguration)
	}

	// Save configuration

	async upsertApiConfiguration(configName: string, apiConfiguration: ApiConfiguration) {
		try {
			await this.configManager.saveConfig(configName, apiConfiguration)
			const listApiConfig = await this.configManager.listConfig()

			await Promise.all([
				this.updateGlobalState("listApiConfigMeta", listApiConfig),
				this.updateApiConfiguration(apiConfiguration),
				this.updateGlobalState("currentApiConfigName", configName),
			])

			await this.postStateToWebview()
		} catch (error) {
			this.outputChannel.appendLine(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
			vscode.window.showErrorMessage(t("common:errors.create_api_config"))
		}
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = ((await this.getGlobalState("taskHistory")) as HistoryItem[] | undefined) || []
		const historyItem = history.find((item) => item.id === id)
		if (historyItem) {
			const { getTaskDirectoryPath } = await import("../../shared/storagePathManager")
			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
			const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					apiConversationHistory,
				}
			}
		}
		// if we tried to get a task that doesn't exist, remove it from state
		// FIXME: this seems to happen sometimes when the json file doesnt save to disk for some reason
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async showTaskWithId(id: string) {
		if (id !== this.getCurrentCline()?.taskId) {
			// Non-current task.
			const { historyItem } = await this.getTaskWithId(id)
			await this.initClineWithHistoryItem(historyItem) // Clears existing task.
		}

		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		await downloadTask(historyItem.ts, apiConversationHistory)
	}

	// this function deletes a task from task hidtory, and deletes it's checkpoints and delete the task folder
	async deleteTaskWithId(id: string) {
		try {
			// get the task directory full path
			const { taskDirPath } = await this.getTaskWithId(id)

			// remove task from stack if it's the current task
			if (id === this.getCurrentCline()?.taskId) {
				// if we found the taskid to delete - call finish to abort this task and allow a new task to be started,
				// if we are deleting a subtask and parent task is still waiting for subtask to finish - it allows the parent to resume (this case should neve exist)
				await this.finishSubTask(t("common:tasks.deleted"))
			}

			// delete task from the task history state
			await this.deleteTaskFromState(id)

			// Delete associated shadow repository or branch.
			// TODO: Store `workspaceDir` in the `HistoryItem` object.
			const globalStorageDir = this.contextProxy.globalStorageUri.fsPath
			const workspaceDir = this.cwd

			try {
				await ShadowCheckpointService.deleteTask({ taskId: id, globalStorageDir, workspaceDir })
			} catch (error) {
				console.error(
					`[deleteTaskWithId${id}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			// delete the entire task directory including checkpoints and all content
			try {
				await fs.rm(taskDirPath, { recursive: true, force: true })
				console.log(`[deleteTaskWithId${id}] removed task directory`)
			} catch (error) {
				console.error(
					`[deleteTaskWithId${id}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} catch (error) {
			// If task is not found, just remove it from state
			if (error instanceof Error && error.message === "Task not found") {
				await this.deleteTaskFromState(id)
				return
			}
			throw error
		}
	}

	async deleteTaskFromState(id: string) {
		// Remove the task from history
		const taskHistory = ((await this.getGlobalState("taskHistory")) as HistoryItem[]) || []
		const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
		await this.updateGlobalState("taskHistory", updatedTaskHistory)

		// Notify the webview that the task has been deleted
		await this.postStateToWebview()
	}

	async postStateToWebview() {
		const state = await this.getStateToPostToWebview()
		this.postMessageToWebview({ type: "state", state })
	}

	async getStateToPostToWebview() {
		const {
			apiConfiguration,
			lastShownAnnouncementId,
			customInstructions,
			alwaysAllowReadOnly,
			alwaysAllowReadOnlyOutsideWorkspace,
			alwaysAllowWrite,
			alwaysAllowWriteOutsideWorkspace,
			alwaysAllowExecute,
			alwaysAllowBrowser,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			soundEnabled,
			ttsEnabled,
			ttsSpeed,
			diffEnabled,
			enableCheckpoints,
			checkpointStorage,
			taskHistory,
			soundVolume,
			browserViewportSize,
			screenshotQuality,
			remoteBrowserHost,
			remoteBrowserEnabled,
			writeDelayMs,
			terminalOutputLineLimit,
			terminalShellIntegrationTimeout,
			fuzzyMatchThreshold,
			mcpEnabled,
			enableMcpServerCreation,
			alwaysApproveResubmit,
			requestDelaySeconds,
			rateLimitSeconds,
			currentApiConfigName,
			listApiConfigMeta,
			mode,
			customModePrompts,
			customSupportPrompts,
			enhancementApiConfigId,
			autoApprovalEnabled,
			experiments,
			maxOpenTabsContext,
			maxWorkspaceFiles,
			browserToolEnabled,
			telemetrySetting,
			showRooIgnoredFiles,
			language,
			maxReadFileLine,
		} = await this.getState()

		const telemetryKey = process.env.POSTHOG_API_KEY
		const machineId = vscode.env.machineId
		const allowedCommands = vscode.workspace.getConfiguration("roo-cline").get<string[]>("allowedCommands") || []
		const cwd = this.cwd

		return {
			version: this.context.extension?.packageJSON?.version ?? "",
			apiConfiguration,
			customInstructions,
			alwaysAllowReadOnly: alwaysAllowReadOnly ?? false,
			alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? false,
			alwaysAllowWrite: alwaysAllowWrite ?? false,
			alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? false,
			alwaysAllowExecute: alwaysAllowExecute ?? false,
			alwaysAllowBrowser: alwaysAllowBrowser ?? false,
			alwaysAllowMcp: alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: alwaysAllowModeSwitch ?? false,
			alwaysAllowSubtasks: alwaysAllowSubtasks ?? false,
			uriScheme: vscode.env.uriScheme,
			currentTaskItem: this.getCurrentCline()?.taskId
				? (taskHistory || []).find((item: HistoryItem) => item.id === this.getCurrentCline()?.taskId)
				: undefined,
			clineMessages: this.getCurrentCline()?.clineMessages || [],
			taskHistory: (taskHistory || [])
				.filter((item: HistoryItem) => item.ts && item.task)
				.sort((a: HistoryItem, b: HistoryItem) => b.ts - a.ts),
			soundEnabled: soundEnabled ?? false,
			ttsEnabled: ttsEnabled ?? false,
			ttsSpeed: ttsSpeed ?? 1.0,
			diffEnabled: diffEnabled ?? true,
			enableCheckpoints: enableCheckpoints ?? true,
			checkpointStorage: checkpointStorage ?? "task",
			shouldShowAnnouncement:
				telemetrySetting !== "unset" && lastShownAnnouncementId !== this.latestAnnouncementId,
			allowedCommands,
			soundVolume: soundVolume ?? 0.5,
			browserViewportSize: browserViewportSize ?? "900x600",
			screenshotQuality: screenshotQuality ?? 75,
			remoteBrowserHost,
			remoteBrowserEnabled: remoteBrowserEnabled ?? false,
			writeDelayMs: writeDelayMs ?? 1000,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? TERMINAL_SHELL_INTEGRATION_TIMEOUT,
			fuzzyMatchThreshold: fuzzyMatchThreshold ?? 1.0,
			mcpEnabled: mcpEnabled ?? true,
			enableMcpServerCreation: enableMcpServerCreation ?? true,
			alwaysApproveResubmit: alwaysApproveResubmit ?? false,
			requestDelaySeconds: requestDelaySeconds ?? 10,
			rateLimitSeconds: rateLimitSeconds ?? 0,
			currentApiConfigName: currentApiConfigName ?? "default",
			listApiConfigMeta: listApiConfigMeta ?? [],
			mode: mode ?? defaultModeSlug,
			customModePrompts: customModePrompts ?? {},
			customSupportPrompts: customSupportPrompts ?? {},
			enhancementApiConfigId,
			autoApprovalEnabled: autoApprovalEnabled ?? false,
			customModes: await this.customModesManager.getCustomModes(),
			experiments: experiments ?? experimentDefault,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			maxOpenTabsContext: maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: maxWorkspaceFiles ?? 200,
			cwd,
			browserToolEnabled: browserToolEnabled ?? true,
			telemetrySetting,
			telemetryKey,
			machineId,
			showRooIgnoredFiles: showRooIgnoredFiles ?? true,
			language,
			renderContext: this.renderContext,
			maxReadFileLine: maxReadFileLine ?? 500,
			pinnedApiConfigs:
				((await this.getGlobalState("pinnedApiConfigs")) as Record<string, boolean>) ??
				({} as Record<string, boolean>),
		}
	}

	// Caching mechanism to keep track of webview messages + API conversation history per provider instance

	/*
	Now that we use retainContextWhenHidden, we don't have to store a cache of cline messages in the user's state, but we could to reduce memory footprint in long conversations.

	- We have to be careful of what state is shared between ClineProvider instances since there could be multiple instances of the extension running at once. For example when we cached cline messages using the same key, two instances of the extension could end up using the same key and overwriting each other's messages.
	- Some state does need to be shared between the instances, i.e. the API key--however there doesn't seem to be a good way to notfy the other instances that the API key has changed.

	We need to use a unique identifier for each ClineProvider instance's message cache since we could be running several instances of the extension outside of just the sidebar i.e. in editor panels.

	// conversation history to send in API requests

	/*
	It seems that some API messages do not comply with vscode state requirements. Either the Anthropic library is manipulating these values somehow in the backend in a way thats creating cyclic references, or the API returns a function or a Symbol as part of the message content.
	VSCode docs about state: "The value must be JSON-stringifyable ... value — A value. MUST not contain cyclic references."
	For now we'll store the conversation history in memory, and if we need to store in state directly we'd need to do a manual conversion to ensure proper json stringification.
	*/

	// getApiConversationHistory(): Anthropic.MessageParam[] {
	// 	// const history = (await this.getGlobalState(
	// 	// 	this.getApiConversationHistoryStateKey()
	// 	// )) as Anthropic.MessageParam[]
	// 	// return history || []
	// 	return this.apiConversationHistory
	// }

	// setApiConversationHistory(history: Anthropic.MessageParam[] | undefined) {
	// 	// await this.updateGlobalState(this.getApiConversationHistoryStateKey(), history)
	// 	this.apiConversationHistory = history || []
	// }

	// addMessageToApiConversationHistory(message: Anthropic.MessageParam): Anthropic.MessageParam[] {
	// 	// const history = await this.getApiConversationHistory()
	// 	// history.push(message)
	// 	// await this.setApiConversationHistory(history)
	// 	// return history
	// 	this.apiConversationHistory.push(message)
	// 	return this.apiConversationHistory
	// }

	/*
	Storage
	https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
	https://www.eliostruyf.com/devhack-code-extension-storage-options/
	*/

	async getState() {
		// Create an object to store all fetched values
		const stateValues: Record<GlobalStateKey | SecretKey, any> = {} as Record<GlobalStateKey | SecretKey, any>
		const secretValues: Record<SecretKey, any> = {} as Record<SecretKey, any>

		// Create promise arrays for global state and secrets
		const statePromises = GLOBAL_STATE_KEYS.map((key) => this.getGlobalState(key))
		const secretPromises = SECRET_KEYS.map((key) => this.getSecret(key))

		// Add promise for custom modes which is handled separately
		const customModesPromise = this.customModesManager.getCustomModes()

		let idx = 0
		const valuePromises = await Promise.all([...statePromises, ...secretPromises, customModesPromise])

		// Populate stateValues and secretValues
		GLOBAL_STATE_KEYS.forEach((key, _) => {
			stateValues[key] = valuePromises[idx]
			idx = idx + 1
		})

		SECRET_KEYS.forEach((key, index) => {
			secretValues[key] = valuePromises[idx]
			idx = idx + 1
		})

		let customModes = valuePromises[idx] as ModeConfig[] | undefined

		// Determine apiProvider with the same logic as before
		let apiProvider: ApiProvider
		if (stateValues.apiProvider) {
			apiProvider = stateValues.apiProvider
		} else {
			apiProvider = "anthropic"
		}

		// Build the apiConfiguration object combining state values and secrets
		// Using the dynamic approach with API_CONFIG_KEYS
		const apiConfiguration: ApiConfiguration = {
			// Dynamically add all API-related keys from stateValues
			...Object.fromEntries(API_CONFIG_KEYS.map((key) => [key, stateValues[key]])),
			// Add all secrets
			...secretValues,
		}

		// Ensure apiProvider is set properly if not already in state
		if (!apiConfiguration.apiProvider) {
			apiConfiguration.apiProvider = apiProvider
		}

		// Return the same structure as before
		return {
			apiConfiguration,
			lastShownAnnouncementId: stateValues.lastShownAnnouncementId,
			customInstructions: stateValues.customInstructions,
			alwaysAllowReadOnly: stateValues.alwaysAllowReadOnly ?? false,
			alwaysAllowReadOnlyOutsideWorkspace: stateValues.alwaysAllowReadOnlyOutsideWorkspace ?? false,
			alwaysAllowWrite: stateValues.alwaysAllowWrite ?? false,
			alwaysAllowWriteOutsideWorkspace: stateValues.alwaysAllowWriteOutsideWorkspace ?? false,
			alwaysAllowExecute: stateValues.alwaysAllowExecute ?? false,
			alwaysAllowBrowser: stateValues.alwaysAllowBrowser ?? false,
			alwaysAllowMcp: stateValues.alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: stateValues.alwaysAllowModeSwitch ?? false,
			alwaysAllowSubtasks: stateValues.alwaysAllowSubtasks ?? false,
			taskHistory: stateValues.taskHistory,
			allowedCommands: stateValues.allowedCommands,
			soundEnabled: stateValues.soundEnabled ?? false,
			ttsEnabled: stateValues.ttsEnabled ?? false,
			ttsSpeed: stateValues.ttsSpeed ?? 1.0,
			diffEnabled: stateValues.diffEnabled ?? true,
			enableCheckpoints: stateValues.enableCheckpoints ?? true,
			checkpointStorage: stateValues.checkpointStorage ?? "task",
			soundVolume: stateValues.soundVolume,
			browserViewportSize: stateValues.browserViewportSize ?? "900x600",
			screenshotQuality: stateValues.screenshotQuality ?? 75,
			remoteBrowserHost: stateValues.remoteBrowserHost,
			remoteBrowserEnabled: stateValues.remoteBrowserEnabled ?? false,
			fuzzyMatchThreshold: stateValues.fuzzyMatchThreshold ?? 1.0,
			writeDelayMs: stateValues.writeDelayMs ?? 1000,
			terminalOutputLineLimit: stateValues.terminalOutputLineLimit ?? 500,
			terminalShellIntegrationTimeout:
				stateValues.terminalShellIntegrationTimeout ?? TERMINAL_SHELL_INTEGRATION_TIMEOUT,
			mode: stateValues.mode ?? defaultModeSlug,
			language: stateValues.language ?? formatLanguage(vscode.env.language),
			mcpEnabled: stateValues.mcpEnabled ?? true,
			enableMcpServerCreation: stateValues.enableMcpServerCreation ?? true,
			alwaysApproveResubmit: stateValues.alwaysApproveResubmit ?? false,
			requestDelaySeconds: Math.max(5, stateValues.requestDelaySeconds ?? 10),
			rateLimitSeconds: stateValues.rateLimitSeconds ?? 0,
			currentApiConfigName: stateValues.currentApiConfigName ?? "default",
			listApiConfigMeta: stateValues.listApiConfigMeta ?? [],
			modeApiConfigs: stateValues.modeApiConfigs ?? ({} as Record<Mode, string>),
			customModePrompts: stateValues.customModePrompts ?? {},
			customSupportPrompts: stateValues.customSupportPrompts ?? {},
			enhancementApiConfigId: stateValues.enhancementApiConfigId,
			experiments: stateValues.experiments ?? experimentDefault,
			autoApprovalEnabled: stateValues.autoApprovalEnabled ?? false,
			customModes,
			maxOpenTabsContext: stateValues.maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: stateValues.maxWorkspaceFiles ?? 200,
			openRouterUseMiddleOutTransform: stateValues.openRouterUseMiddleOutTransform ?? true,
			browserToolEnabled: stateValues.browserToolEnabled ?? true,
			telemetrySetting: stateValues.telemetrySetting || "unset",
			showRooIgnoredFiles: stateValues.showRooIgnoredFiles ?? true,
			maxReadFileLine: stateValues.maxReadFileLine ?? 500,
		}
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = ((await this.getGlobalState("taskHistory")) as HistoryItem[] | undefined) || []
		const existingItemIndex = history.findIndex((h) => h.id === item.id)

		if (existingItemIndex !== -1) {
			history[existingItemIndex] = item
		} else {
			history.push(item)
		}
		await this.updateGlobalState("taskHistory", history)
		return history
	}

	// global

	public async updateGlobalState(key: GlobalStateKey, value: any) {
		await this.contextProxy.updateGlobalState(key, value)
	}

	public async getGlobalState(key: GlobalStateKey) {
		return await this.contextProxy.getGlobalState(key)
	}

	// secrets

	public async storeSecret(key: SecretKey, value?: string) {
		await this.contextProxy.storeSecret(key, value)
	}

	private async getSecret(key: SecretKey) {
		return await this.contextProxy.getSecret(key)
	}

	// global + secret

	public async setValues(values: Partial<ConfigurationValues>) {
		await this.contextProxy.setValues(values)
	}

	// dev

	async resetState() {
		const answer = await vscode.window.showInformationMessage(
			t("common:confirmation.reset_state"),
			{ modal: true },
			t("common:answers.yes"),
		)

		if (answer !== t("common:answers.yes")) {
			return
		}

		await this.contextProxy.resetAllState()
		await this.configManager.resetAllConfigs()
		await this.customModesManager.resetCustomModes()
		await this.removeClineFromStack()
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	// logging

	public log(message: string) {
		this.outputChannel.appendLine(message)
		console.log(message)
	}

	// integration tests

	get viewLaunched() {
		return this.isViewLaunched
	}

	get messages() {
		return this.getCurrentCline()?.clineMessages || []
	}

	// Add public getter
	public getMcpHub(): McpHub | undefined {
		return this.mcpHub
	}

	/**
	 * Returns properties to be included in every telemetry event
	 * This method is called by the telemetry service to get context information
	 * like the current mode, API provider, etc.
	 */
	public async getTelemetryProperties(): Promise<Record<string, any>> {
		const { mode, apiConfiguration, language } = await this.getState()
		const appVersion = this.context.extension?.packageJSON?.version
		const vscodeVersion = vscode.version
		const platform = process.platform

		const properties: Record<string, any> = {
			vscodeVersion,
			platform,
		}

		// Add extension version
		if (appVersion) {
			properties.appVersion = appVersion
		}

		// Add language
		if (language) {
			properties.language = language
		}

		// Add current mode
		if (mode) {
			properties.mode = mode
		}

		// Add API provider
		if (apiConfiguration?.apiProvider) {
			properties.apiProvider = apiConfiguration.apiProvider
		}

		// Add model ID if available
		const currentCline = this.getCurrentCline()
		if (currentCline?.api) {
			const { id: modelId } = currentCline.api.getModel()
			if (modelId) {
				properties.modelId = modelId
			}
		}

		if (currentCline?.diffStrategy) {
			properties.diffStrategy = currentCline.diffStrategy.getName()
		}

		return properties
	}
}
