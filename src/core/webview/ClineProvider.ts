import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import fs from "fs/promises"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { downloadTask } from "../../integrations/misc/export-markdown"
import { openFile, openImage } from "../../integrations/misc/open-file"
import { selectImages } from "../../integrations/misc/process-images"
import { getTheme } from "../../integrations/theme/getTheme"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"
import { McpHub } from "../../services/mcp/McpHub"
import { ApiProvider, ModelInfo } from "../../shared/api"
import { findLast } from "../../shared/array"
import { ExtensionMessage } from "../../shared/ExtensionMessage"
import { HistoryItem } from "../../shared/HistoryItem"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { fileExistsAtPath } from "../../utils/fs"
import { Cline } from "../Cline"
import { openMention } from "../mentions"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../shared/AutoApprovalSettings"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts

https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

type SecretKey =
	| "apiKey"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "openAiApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
type GlobalStateKey =
	| "apiProvider"
	| "apiModelId"
	| "awsRegion"
	| "awsUseCrossRegionInference"
	| "vertexProjectId"
	| "vertexRegion"
	| "lastShownAnnouncementId"
	| "customInstructions"
	| "taskHistory"
	| "openAiBaseUrl"
	| "openAiModelId"
	| "ollamaModelId"
	| "ollamaBaseUrl"
	| "lmStudioModelId"
	| "lmStudioBaseUrl"
	| "anthropicBaseUrl"
	| "azureApiVersion"
	| "openRouterModelId"
	| "openRouterModelInfo"
	| "autoApprovalSettings"

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	uiMessages: "ui_messages.json",
	openRouterModels: "openrouter_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
}

export class ClineProvider implements vscode.WebviewViewProvider {
	public static readonly sideBarId = "claude-dev.SidebarProvider" // used in package.json as the view's id. This value cannot be changed due to how vscode caches views based on their id, and updating the id would break existing instances of the extension.
	public static readonly tabPanelId = "claude-dev.TabPanelProvider"
	private static activeInstances: Set<ClineProvider> = new Set()
	private disposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private cline?: Cline
	private workspaceTracker?: WorkspaceTracker
	mcpHub?: McpHub
	private latestAnnouncementId = "dec-17-2024" // update to some unique identifier when we add a new announcement

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
	) {
		this.outputChannel.appendLine("ClineProvider instantiated")
		ClineProvider.activeInstances.add(this)
		this.workspaceTracker = new WorkspaceTracker(this)
		this.mcpHub = new McpHub(this)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		this.outputChannel.appendLine("Disposing ClineProvider...")
		await this.clearTask()
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
		this.outputChannel.appendLine("Disposed all disposables")
		ClineProvider.activeInstances.delete(this)
	}

	public static getVisibleInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView | vscode.WebviewPanel,
		//context: vscode.WebviewViewResolveContext<unknown>, used to recreate a deallocated webview, but we don't need this since we use retainContextWhenHidden
		//token: vscode.CancellationToken
	): void | Thenable<void> {
		this.outputChannel.appendLine("Resolving webview view")
		this.view = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		}
		webviewView.webview.html = this.getHtmlContent(webviewView.webview)

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

		// if the extension is starting a new session, clear previous task state
		this.clearTask()

		this.outputChannel.appendLine("Webview view resolved")
	}

	async initClineWithTask(task?: string, images?: string[]) {
		await this.clearTask() // ensures that an exising task doesn't exist before starting a new one, although this shouldn't be possible since user must clear task before starting a new one
		const { apiConfiguration, customInstructions, autoApprovalSettings } = await this.getState()
		this.cline = new Cline(this, apiConfiguration, autoApprovalSettings, customInstructions, task, images)
	}

	async initClineWithHistoryItem(historyItem: HistoryItem) {
		await this.clearTask()
		const { apiConfiguration, customInstructions, autoApprovalSettings } = await this.getState()
		this.cline = new Cline(
			this,
			apiConfiguration,
			autoApprovalSettings,
			customInstructions,
			undefined,
			undefined,
			historyItem,
		)
	}

	// Send any JSON serializable data to the react app
	async postMessageToWebview(message: ExtensionMessage) {
		await this.view?.webview.postMessage(message)
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
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"static",
			"css",
			"main.css",
		])
		// The JS file from the React build output
		const scriptUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "static", "js", "main.js"])

		// The codicon font from the React build output
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
		// we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
		// don't forget to add font-src ${webview.cspSource};
		const codiconsUri = getUri(webview, this.context.extensionUri, [
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		])

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
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
            <title>Cline</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
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
						this.postStateToWebview()
						this.workspaceTracker?.initializeFilePaths() // don't await
						getTheme().then((theme) =>
							this.postMessageToWebview({ type: "theme", text: JSON.stringify(theme) }),
						)
						// post last cached models in case the call to endpoint fails
						this.readOpenRouterModels().then((openRouterModels) => {
							if (openRouterModels) {
								this.postMessageToWebview({ type: "openRouterModels", openRouterModels })
							}
						})
						// gui relies on model info to be up-to-date to provide the most accurate pricing, so we need to fetch the latest details on launch.
						// we do this for all users since many users switch between api providers and if they were to switch back to openrouter it would be showing outdated model info if we hadn't retrieved the latest at this point
						// (see normalizeApiConfiguration > openrouter)
						this.refreshOpenRouterModels().then(async (openRouterModels) => {
							if (openRouterModels) {
								// update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
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
							const {
								apiProvider,
								apiModelId,
								apiKey,
								openRouterApiKey,
								awsAccessKey,
								awsSecretKey,
								awsSessionToken,
								awsRegion,
								awsUseCrossRegionInference,
								vertexProjectId,
								vertexRegion,
								openAiBaseUrl,
								openAiApiKey,
								openAiModelId,
								ollamaModelId,
								ollamaBaseUrl,
								lmStudioModelId,
								lmStudioBaseUrl,
								anthropicBaseUrl,
								geminiApiKey,
								openAiNativeApiKey,
								deepSeekApiKey,
								azureApiVersion,
								openRouterModelId,
								openRouterModelInfo,
							} = message.apiConfiguration
							await this.updateGlobalState("apiProvider", apiProvider)
							await this.updateGlobalState("apiModelId", apiModelId)
							await this.storeSecret("apiKey", apiKey)
							await this.storeSecret("openRouterApiKey", openRouterApiKey)
							await this.storeSecret("awsAccessKey", awsAccessKey)
							await this.storeSecret("awsSecretKey", awsSecretKey)
							await this.storeSecret("awsSessionToken", awsSessionToken)
							await this.updateGlobalState("awsRegion", awsRegion)
							await this.updateGlobalState("awsUseCrossRegionInference", awsUseCrossRegionInference)
							await this.updateGlobalState("vertexProjectId", vertexProjectId)
							await this.updateGlobalState("vertexRegion", vertexRegion)
							await this.updateGlobalState("openAiBaseUrl", openAiBaseUrl)
							await this.storeSecret("openAiApiKey", openAiApiKey)
							await this.updateGlobalState("openAiModelId", openAiModelId)
							await this.updateGlobalState("ollamaModelId", ollamaModelId)
							await this.updateGlobalState("ollamaBaseUrl", ollamaBaseUrl)
							await this.updateGlobalState("lmStudioModelId", lmStudioModelId)
							await this.updateGlobalState("lmStudioBaseUrl", lmStudioBaseUrl)
							await this.updateGlobalState("anthropicBaseUrl", anthropicBaseUrl)
							await this.storeSecret("geminiApiKey", geminiApiKey)
							await this.storeSecret("openAiNativeApiKey", openAiNativeApiKey)
							await this.storeSecret("deepSeekApiKey", deepSeekApiKey)
							await this.updateGlobalState("azureApiVersion", azureApiVersion)
							await this.updateGlobalState("openRouterModelId", openRouterModelId)
							await this.updateGlobalState("openRouterModelInfo", openRouterModelInfo)
							if (this.cline) {
								this.cline.api = buildApiHandler(message.apiConfiguration)
							}
						}
						await this.postStateToWebview()
						break
					case "customInstructions":
						await this.updateCustomInstructions(message.text)
						break
					case "autoApprovalSettings":
						if (message.autoApprovalSettings) {
							await this.updateGlobalState("autoApprovalSettings", message.autoApprovalSettings)
							if (this.cline) {
								this.cline.autoApprovalSettings = message.autoApprovalSettings
							}
							await this.postStateToWebview()
						}
						break
					case "askResponse":
						this.cline?.handleWebviewAskResponse(message.askResponse!, message.text, message.images)
						break
					case "clearTask":
						// newTask will start a new task with a given task text, while clear task resets the current session and allows for a new task to be started
						await this.clearTask()
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
						const currentTaskId = this.cline?.taskId
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
					case "exportTaskWithId":
						this.exportTaskWithId(message.text!)
						break
					case "resetState":
						await this.resetState()
						break
					case "requestOllamaModels":
						const ollamaModels = await this.getOllamaModels(message.text)
						this.postMessageToWebview({ type: "ollamaModels", ollamaModels })
						break
					case "requestLmStudioModels":
						const lmStudioModels = await this.getLmStudioModels(message.text)
						this.postMessageToWebview({ type: "lmStudioModels", lmStudioModels })
						break
					case "refreshOpenRouterModels":
						await this.refreshOpenRouterModels()
						break
					case "openImage":
						openImage(message.text!)
						break
					case "openFile":
						openFile(message.text!)
						break
					case "openMention":
						openMention(message.text)
						break
					case "cancelTask":
						if (this.cline) {
							const { historyItem } = await this.getTaskWithId(this.cline.taskId)
							this.cline.abortTask()
							await pWaitFor(() => this.cline === undefined || this.cline.didFinishAborting, {
								timeout: 3_000,
							}).catch(() => {
								console.error("Failed to abort task")
							})
							if (this.cline) {
								// 'abandoned' will prevent this cline instance from affecting future cline instance gui. this may happen if its hanging on a streaming request
								this.cline.abandoned = true
							}
							await this.initClineWithHistoryItem(historyItem) // clears task again, so we need to abortTask manually above
							// await this.postStateToWebview() // new Cline instance will post state when it's ready. having this here sent an empty messages array to webview leading to virtuoso having to reload the entire list
						}

						break
					case "openMcpSettings": {
						const mcpSettingsFilePath = await this.mcpHub?.getMcpSettingsFilePath()
						if (mcpSettingsFilePath) {
							openFile(mcpSettingsFilePath)
						}
						break
					}
					case "restartMcpServer": {
						try {
							await this.mcpHub?.restartConnection(message.text!)
						} catch (error) {
							console.error(`Failed to retry connection for ${message.text}:`, error)
						}
						break
					}
					// Add more switch case statements here as more webview message commands
					// are created within the webview context (i.e. inside media/main.js)
				}
			},
			null,
			this.disposables,
		)
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field
		await this.updateGlobalState("customInstructions", instructions || undefined)
		if (this.cline) {
			this.cline.customInstructions = instructions || undefined
		}
		await this.postStateToWebview()
	}

	// MCP

	async ensureMcpServersDirectoryExists(): Promise<string> {
		const mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			return "~/Documents/Cline/MCP" // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine since this path is only ever used in the system prompt
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const settingsDir = path.join(this.context.globalStorageUri.fsPath, "settings")
		await fs.mkdir(settingsDir, { recursive: true })
		return settingsDir
	}

	// Ollama

	async getOllamaModels(baseUrl?: string) {
		try {
			if (!baseUrl) {
				baseUrl = "http://localhost:11434"
			}
			if (!URL.canParse(baseUrl)) {
				return []
			}
			const response = await axios.get(`${baseUrl}/api/tags`)
			const modelsArray = response.data?.models?.map((model: any) => model.name) || []
			const models = [...new Set<string>(modelsArray)]
			return models
		} catch (error) {
			return []
		}
	}

	// LM Studio

	async getLmStudioModels(baseUrl?: string) {
		try {
			if (!baseUrl) {
				baseUrl = "http://localhost:1234"
			}
			if (!URL.canParse(baseUrl)) {
				return []
			}
			const response = await axios.get(`${baseUrl}/v1/models`)
			const modelsArray = response.data?.data?.map((model: any) => model.id) || []
			const models = [...new Set<string>(modelsArray)]
			return models
		} catch (error) {
			return []
		}
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let apiKey: string
		try {
			const response = await axios.post("https://openrouter.ai/api/v1/auth/keys", { code })
			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			console.error("Error exchanging code for API key:", error)
			throw error
		}

		const openrouter: ApiProvider = "openrouter"
		await this.updateGlobalState("apiProvider", openrouter)
		await this.storeSecret("openRouterApiKey", apiKey)
		await this.postStateToWebview()
		if (this.cline) {
			this.cline.api = buildApiHandler({ apiProvider: openrouter, openRouterApiKey: apiKey })
		}
		// await this.postMessageToWebview({ type: "action", action: "settingsButtonClicked" }) // bad ux if user is on welcome
	}

	private async ensureCacheDirectoryExists(): Promise<string> {
		const cacheDir = path.join(this.context.globalStorageUri.fsPath, "cache")
		await fs.mkdir(cacheDir, { recursive: true })
		return cacheDir
	}

	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		const openRouterModelsFilePath = path.join(
			await this.ensureCacheDirectoryExists(),
			GlobalFileNames.openRouterModels,
		)
		const fileExists = await fileExistsAtPath(openRouterModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		}
		return undefined
	}

	async refreshOpenRouterModels() {
		const openRouterModelsFilePath = path.join(
			await this.ensureCacheDirectoryExists(),
			GlobalFileNames.openRouterModels,
		)

		let models: Record<string, ModelInfo> = {}
		try {
			const response = await axios.get("https://openrouter.ai/api/v1/models")
			/*
			{
				"id": "anthropic/claude-3.5-sonnet",
				"name": "Anthropic: Claude 3.5 Sonnet",
				"created": 1718841600,
				"description": "Claude 3.5 Sonnet delivers better-than-Opus capabilities, faster-than-Sonnet speeds, at the same Sonnet prices. Sonnet is particularly good at:\n\n- Coding: Autonomously writes, edits, and runs code with reasoning and troubleshooting\n- Data science: Augments human data science expertise; navigates unstructured data while using multiple tools for insights\n- Visual processing: excelling at interpreting charts, graphs, and images, accurately transcribing text to derive insights beyond just the text alone\n- Agentic tasks: exceptional tool use, making it great at agentic tasks (i.e. complex, multi-step problem solving tasks that require engaging with other systems)\n\n#multimodal",
				"context_length": 200000,
				"architecture": {
					"modality": "text+image-\u003Etext",
					"tokenizer": "Claude",
					"instruct_type": null
				},
				"pricing": {
					"prompt": "0.000003",
					"completion": "0.000015",
					"image": "0.0048",
					"request": "0"
				},
				"top_provider": {
					"context_length": 200000,
					"max_completion_tokens": 8192,
					"is_moderated": true
				},
				"per_request_limits": null
			},
			*/
			if (response.data?.data) {
				const rawModels = response.data.data
				const parsePrice = (price: any) => {
					if (price) {
						return parseFloat(price) * 1_000_000
					}
					return undefined
				}
				for (const rawModel of rawModels) {
					const modelInfo: ModelInfo = {
						maxTokens: rawModel.top_provider?.max_completion_tokens,
						contextWindow: rawModel.context_length,
						supportsImages: rawModel.architecture?.modality?.includes("image"),
						supportsPromptCache: false,
						inputPrice: parsePrice(rawModel.pricing?.prompt),
						outputPrice: parsePrice(rawModel.pricing?.completion),
						description: rawModel.description,
					}

					switch (rawModel.id) {
						case "anthropic/claude-3.5-sonnet":
						case "anthropic/claude-3.5-sonnet:beta":
							// NOTE: this needs to be synced with api.ts/openrouter default model info
							modelInfo.supportsComputerUse = true
							modelInfo.supportsPromptCache = true
							modelInfo.cacheWritesPrice = 3.75
							modelInfo.cacheReadsPrice = 0.3
							break
						case "anthropic/claude-3.5-sonnet-20240620":
						case "anthropic/claude-3.5-sonnet-20240620:beta":
							modelInfo.supportsPromptCache = true
							modelInfo.cacheWritesPrice = 3.75
							modelInfo.cacheReadsPrice = 0.3
							break
						case "anthropic/claude-3-5-haiku":
						case "anthropic/claude-3-5-haiku:beta":
						case "anthropic/claude-3-5-haiku-20241022":
						case "anthropic/claude-3-5-haiku-20241022:beta":
						case "anthropic/claude-3.5-haiku":
						case "anthropic/claude-3.5-haiku:beta":
						case "anthropic/claude-3.5-haiku-20241022":
						case "anthropic/claude-3.5-haiku-20241022:beta":
							modelInfo.supportsPromptCache = true
							modelInfo.cacheWritesPrice = 1.25
							modelInfo.cacheReadsPrice = 0.1
							break
						case "anthropic/claude-3-opus":
						case "anthropic/claude-3-opus:beta":
							modelInfo.supportsPromptCache = true
							modelInfo.cacheWritesPrice = 18.75
							modelInfo.cacheReadsPrice = 1.5
							break
						case "anthropic/claude-3-haiku":
						case "anthropic/claude-3-haiku:beta":
							modelInfo.supportsPromptCache = true
							modelInfo.cacheWritesPrice = 0.3
							modelInfo.cacheReadsPrice = 0.03
							break
						case "deepseek/deepseek-chat":
							modelInfo.supportsPromptCache = true
							// see api.ts/deepSeekModels for more info
							modelInfo.inputPrice = 0
							modelInfo.cacheWritesPrice = 0.14
							modelInfo.cacheReadsPrice = 0.014
							break
					}

					models[rawModel.id] = modelInfo
				}
			} else {
				console.error("Invalid response from OpenRouter API")
			}
			await fs.writeFile(openRouterModelsFilePath, JSON.stringify(models))
			console.log("OpenRouter models fetched and saved", models)
		} catch (error) {
			console.error("Error fetching OpenRouter models:", error)
		}

		await this.postMessageToWebview({ type: "openRouterModels", openRouterModels: models })
		return models
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
			const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks", id)
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
		if (id !== this.cline?.taskId) {
			// non-current task
			const { historyItem } = await this.getTaskWithId(id)
			await this.initClineWithHistoryItem(historyItem) // clears existing task
		}
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		await downloadTask(historyItem.ts, apiConversationHistory)
	}

	async deleteTaskWithId(id: string) {
		if (id === this.cline?.taskId) {
			await this.clearTask()
		}

		const { taskDirPath, apiConversationHistoryFilePath, uiMessagesFilePath } = await this.getTaskWithId(id)

		await this.deleteTaskFromState(id)

		// Delete the task files
		const apiConversationHistoryFileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
		if (apiConversationHistoryFileExists) {
			await fs.unlink(apiConversationHistoryFilePath)
		}
		const uiMessagesFileExists = await fileExistsAtPath(uiMessagesFilePath)
		if (uiMessagesFileExists) {
			await fs.unlink(uiMessagesFilePath)
		}
		const legacyMessagesFilePath = path.join(taskDirPath, "claude_messages.json")
		if (await fileExistsAtPath(legacyMessagesFilePath)) {
			await fs.unlink(legacyMessagesFilePath)
		}
		await fs.rmdir(taskDirPath) // succeeds if the dir is empty
	}

	async deleteTaskFromState(id: string) {
		// Remove the task from history
		const taskHistory = ((await this.getGlobalState("taskHistory")) as HistoryItem[] | undefined) || []
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
		const { apiConfiguration, lastShownAnnouncementId, customInstructions, taskHistory, autoApprovalSettings } =
			await this.getState()
		return {
			version: this.context.extension?.packageJSON?.version ?? "",
			apiConfiguration,
			customInstructions,
			uriScheme: vscode.env.uriScheme,
			clineMessages: this.cline?.clineMessages || [],
			taskHistory: (taskHistory || []).filter((item) => item.ts && item.task).sort((a, b) => b.ts - a.ts),
			shouldShowAnnouncement: lastShownAnnouncementId !== this.latestAnnouncementId,
			autoApprovalSettings,
		}
	}

	async clearTask() {
		this.cline?.abortTask()
		this.cline = undefined // removes reference to it, so once promises end it will be garbage collected
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
		const [
			storedApiProvider,
			apiModelId,
			apiKey,
			openRouterApiKey,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsRegion,
			awsUseCrossRegionInference,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiApiKey,
			openAiModelId,
			ollamaModelId,
			ollamaBaseUrl,
			lmStudioModelId,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiApiKey,
			openAiNativeApiKey,
			deepSeekApiKey,
			azureApiVersion,
			openRouterModelId,
			openRouterModelInfo,
			lastShownAnnouncementId,
			customInstructions,
			taskHistory,
			autoApprovalSettings,
		] = await Promise.all([
			this.getGlobalState("apiProvider") as Promise<ApiProvider | undefined>,
			this.getGlobalState("apiModelId") as Promise<string | undefined>,
			this.getSecret("apiKey") as Promise<string | undefined>,
			this.getSecret("openRouterApiKey") as Promise<string | undefined>,
			this.getSecret("awsAccessKey") as Promise<string | undefined>,
			this.getSecret("awsSecretKey") as Promise<string | undefined>,
			this.getSecret("awsSessionToken") as Promise<string | undefined>,
			this.getGlobalState("awsRegion") as Promise<string | undefined>,
			this.getGlobalState("awsUseCrossRegionInference") as Promise<boolean | undefined>,
			this.getGlobalState("vertexProjectId") as Promise<string | undefined>,
			this.getGlobalState("vertexRegion") as Promise<string | undefined>,
			this.getGlobalState("openAiBaseUrl") as Promise<string | undefined>,
			this.getSecret("openAiApiKey") as Promise<string | undefined>,
			this.getGlobalState("openAiModelId") as Promise<string | undefined>,
			this.getGlobalState("ollamaModelId") as Promise<string | undefined>,
			this.getGlobalState("ollamaBaseUrl") as Promise<string | undefined>,
			this.getGlobalState("lmStudioModelId") as Promise<string | undefined>,
			this.getGlobalState("lmStudioBaseUrl") as Promise<string | undefined>,
			this.getGlobalState("anthropicBaseUrl") as Promise<string | undefined>,
			this.getSecret("geminiApiKey") as Promise<string | undefined>,
			this.getSecret("openAiNativeApiKey") as Promise<string | undefined>,
			this.getSecret("deepSeekApiKey") as Promise<string | undefined>,
			this.getGlobalState("azureApiVersion") as Promise<string | undefined>,
			this.getGlobalState("openRouterModelId") as Promise<string | undefined>,
			this.getGlobalState("openRouterModelInfo") as Promise<ModelInfo | undefined>,
			this.getGlobalState("lastShownAnnouncementId") as Promise<string | undefined>,
			this.getGlobalState("customInstructions") as Promise<string | undefined>,
			this.getGlobalState("taskHistory") as Promise<HistoryItem[] | undefined>,
			this.getGlobalState("autoApprovalSettings") as Promise<AutoApprovalSettings | undefined>,
		])

		let apiProvider: ApiProvider
		if (storedApiProvider) {
			apiProvider = storedApiProvider
		} else {
			// Either new user or legacy user that doesn't have the apiProvider stored in state
			// (If they're using OpenRouter or Bedrock, then apiProvider state will exist)
			if (apiKey) {
				apiProvider = "anthropic"
			} else {
				// New users should default to openrouter
				apiProvider = "openrouter"
			}
		}

		return {
			apiConfiguration: {
				apiProvider,
				apiModelId,
				apiKey,
				openRouterApiKey,
				awsAccessKey,
				awsSecretKey,
				awsSessionToken,
				awsRegion,
				awsUseCrossRegionInference,
				vertexProjectId,
				vertexRegion,
				openAiBaseUrl,
				openAiApiKey,
				openAiModelId,
				ollamaModelId,
				ollamaBaseUrl,
				lmStudioModelId,
				lmStudioBaseUrl,
				anthropicBaseUrl,
				geminiApiKey,
				openAiNativeApiKey,
				deepSeekApiKey,
				azureApiVersion,
				openRouterModelId,
				openRouterModelInfo,
			},
			lastShownAnnouncementId,
			customInstructions,
			taskHistory,
			autoApprovalSettings: autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS, // default value can be 0 or empty string
		}
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = ((await this.getGlobalState("taskHistory")) as HistoryItem[]) || []
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

	async updateGlobalState(key: GlobalStateKey, value: any) {
		await this.context.globalState.update(key, value)
	}

	async getGlobalState(key: GlobalStateKey) {
		return await this.context.globalState.get(key)
	}

	// workspace

	private async updateWorkspaceState(key: string, value: any) {
		await this.context.workspaceState.update(key, value)
	}

	private async getWorkspaceState(key: string) {
		return await this.context.workspaceState.get(key)
	}

	// private async clearState() {
	// 	this.context.workspaceState.keys().forEach((key) => {
	// 		this.context.workspaceState.update(key, undefined)
	// 	})
	// 	this.context.globalState.keys().forEach((key) => {
	// 		this.context.globalState.update(key, undefined)
	// 	})
	// 	this.context.secrets.delete("apiKey")
	// }

	// secrets

	private async storeSecret(key: SecretKey, value?: string) {
		if (value) {
			await this.context.secrets.store(key, value)
		} else {
			await this.context.secrets.delete(key)
		}
	}

	private async getSecret(key: SecretKey) {
		return await this.context.secrets.get(key)
	}

	// dev

	async resetState() {
		vscode.window.showInformationMessage("Resetting state...")
		for (const key of this.context.globalState.keys()) {
			await this.context.globalState.update(key, undefined)
		}
		const secretKeys: SecretKey[] = [
			"apiKey",
			"openRouterApiKey",
			"awsAccessKey",
			"awsSecretKey",
			"awsSessionToken",
			"openAiApiKey",
			"geminiApiKey",
			"openAiNativeApiKey",
			"deepSeekApiKey",
		]
		for (const key of secretKeys) {
			await this.storeSecret(key, undefined)
		}
		if (this.cline) {
			this.cline.abortTask()
			this.cline = undefined
		}
		vscode.window.showInformationMessage("State reset")
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}
}
