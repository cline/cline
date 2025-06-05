import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import { v4 as uuidv4 } from "uuid"

import fs from "fs/promises"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import pWaitFor from "p-wait-for"
import * as path from "path"
import * as vscode from "vscode"
import { handleGrpcRequest, handleGrpcRequestCancel } from "./grpc-handler"
import { handleModelsServiceRequest } from "./models"
import { EmptyRequest } from "@shared/proto/common"
import { buildApiHandler } from "@api/index"
import { cleanupLegacyCheckpoints } from "@integrations/checkpoints/CheckpointMigration"
import { downloadTask } from "@integrations/misc/export-markdown"
import { fetchOpenGraphData } from "@integrations/misc/link-preview"
import { handleFileServiceRequest } from "./file"
import { getTheme } from "@integrations/theme/getTheme"
import WorkspaceTracker from "@integrations/workspace/WorkspaceTracker"
import { ClineAccountService } from "@services/account/ClineAccountService"
import { BrowserSession } from "@services/browser/BrowserSession"
import { McpHub } from "@services/mcp/McpHub"
import { telemetryService } from "@/services/posthog/telemetry/TelemetryService"
import { ApiProvider, ModelInfo } from "@shared/api"
import { ChatContent } from "@shared/ChatContent"
import { ChatSettings } from "@shared/ChatSettings"
import { ExtensionMessage, ExtensionState, Platform } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { McpDownloadResponse, McpMarketplaceCatalog, McpServer } from "@shared/mcp"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { WebviewMessage } from "@shared/WebviewMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getWorkingState } from "@utils/git"
import { extractCommitMessage } from "@integrations/git/commit-message-generator"
import { getTotalTasksSize } from "@utils/storage"
import {
	ensureMcpServersDirectoryExists,
	ensureSettingsDirectoryExists,
	GlobalFileNames,
	ensureWorkflowsDirectoryExists,
} from "../storage/disk"
import {
	getAllExtensionState,
	getGlobalState,
	getSecret,
	getWorkspaceState,
	resetExtensionState,
	storeSecret,
	updateApiConfiguration,
	updateGlobalState,
	updateWorkspaceState,
} from "../storage/state"
import { Task, cwd } from "../task"
import { ClineRulesToggles } from "@shared/cline-rules"
import { sendStateUpdate } from "./state/subscribeToState"
import { sendAddToInputEvent } from "./ui/subscribeToAddToInput"
import { sendAuthCallbackEvent } from "./account/subscribeToAuthCallback"
import { sendChatButtonClickedEvent } from "./ui/subscribeToChatButtonClicked"
import { sendMcpMarketplaceCatalogEvent } from "./mcp/subscribeToMcpMarketplaceCatalog"
import { refreshClineRulesToggles } from "@core/context/instructions/user-instructions/cline-rules"
import { refreshExternalRulesToggles } from "@core/context/instructions/user-instructions/external-rules"
import { refreshWorkflowToggles } from "@core/context/instructions/user-instructions/workflows"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts

https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class Controller {
	readonly id: string = uuidv4()
	private postMessage: (message: ExtensionMessage) => Thenable<boolean> | undefined

	private disposables: vscode.Disposable[] = []
	task?: Task
	workspaceTracker: WorkspaceTracker
	mcpHub: McpHub
	accountService: ClineAccountService
	latestAnnouncementId = "may-22-2025_16:11:00" // update to some unique identifier when we add a new announcement

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		postMessage: (message: ExtensionMessage) => Thenable<boolean> | undefined,
	) {
		this.outputChannel.appendLine("ClineProvider instantiated")
		this.postMessage = postMessage

		this.workspaceTracker = new WorkspaceTracker((msg) => this.postMessageToWebview(msg))
		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			() => ensureSettingsDirectoryExists(this.context),
			(msg) => this.postMessageToWebview(msg),
			this.context.extension?.packageJSON?.version ?? "1.0.0",
		)
		this.accountService = new ClineAccountService(
			(msg) => this.postMessageToWebview(msg),
			async () => {
				const { apiConfiguration } = await this.getStateToPostToWebview()
				return apiConfiguration?.clineApiKey
			},
		)

		// Clean up legacy checkpoints
		cleanupLegacyCheckpoints(this.context.globalStorageUri.fsPath, this.outputChannel).catch((error) => {
			console.error("Failed to cleanup legacy checkpoints:", error)
		})
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		await this.clearTask()
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		this.workspaceTracker.dispose()
		this.mcpHub.dispose()

		console.error("Controller disposed")
	}

	// Auth methods
	async handleSignOut() {
		try {
			await storeSecret(this.context, "clineApiKey", undefined)
			await updateGlobalState(this.context, "userInfo", undefined)
			await updateGlobalState(this.context, "apiProvider", "openrouter")
			await this.postStateToWebview()
			vscode.window.showInformationMessage("Successfully logged out of Cline")
		} catch (error) {
			vscode.window.showErrorMessage("Logout failed")
		}
	}

	async setUserInfo(info?: { displayName: string | null; email: string | null; photoURL: string | null }) {
		await updateGlobalState(this.context, "userInfo", info)
	}

	async initTask(task?: string, images?: string[], files?: string[], historyItem?: HistoryItem) {
		await this.clearTask() // ensures that an existing task doesn't exist before starting a new one, although this shouldn't be possible since user must clear task before starting a new one
		const {
			apiConfiguration,
			customInstructions,
			autoApprovalSettings,
			browserSettings,
			chatSettings,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			enableCheckpointsSetting,
			isNewUser,
			taskHistory,
		} = await getAllExtensionState(this.context)

		const NEW_USER_TASK_COUNT_THRESHOLD = 10

		// Check if the user has completed enough tasks to no longer be considered a "new user"
		if (isNewUser && !historyItem && taskHistory && taskHistory.length >= NEW_USER_TASK_COUNT_THRESHOLD) {
			await updateGlobalState(this.context, "isNewUser", false)
			await this.postStateToWebview()
		}

		if (autoApprovalSettings) {
			const updatedAutoApprovalSettings = {
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
			}
			await updateGlobalState(this.context, "autoApprovalSettings", updatedAutoApprovalSettings)
		}
		this.task = new Task(
			this.context,
			this.mcpHub,
			this.workspaceTracker,
			(historyItem) => this.updateTaskHistory(historyItem),
			() => this.postStateToWebview(),
			(message) => this.postMessageToWebview(message),
			(taskId) => this.reinitExistingTaskFromId(taskId),
			() => this.cancelTask(),
			apiConfiguration,
			autoApprovalSettings,
			browserSettings,
			chatSettings,
			shellIntegrationTimeout,
			terminalReuseEnabled ?? true,
			enableCheckpointsSetting ?? true,
			customInstructions,
			task,
			images,
			files,
			historyItem,
		)
	}

	async reinitExistingTaskFromId(taskId: string) {
		const history = await this.getTaskWithId(taskId)
		if (history) {
			await this.initTask(undefined, undefined, undefined, history.historyItem)
		}
	}

	// Send any JSON serializable data to the react app
	async postMessageToWebview(message: ExtensionMessage) {
		await this.postMessage(message)
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	async handleWebviewMessage(message: WebviewMessage) {
		switch (message.type) {
			case "authStateChanged":
				await this.setUserInfo(message.user || undefined)
				await this.postStateToWebview()
				break
			case "webviewDidLaunch":
				this.postStateToWebview()
				this.workspaceTracker?.populateFilePaths() // don't await
				// post last cached models in case the call to endpoint fails
				this.readOpenRouterModels().then((openRouterModels) => {
					if (openRouterModels) {
						this.postMessageToWebview({
							type: "openRouterModels",
							openRouterModels,
						})
					}
				})
				// gui relies on model info to be up-to-date to provide the most accurate pricing, so we need to fetch the latest details on launch.
				// we do this for all users since many users switch between api providers and if they were to switch back to openrouter it would be showing outdated model info if we hadn't retrieved the latest at this point
				// (see normalizeApiConfiguration > openrouter)
				// Prefetch marketplace and OpenRouter models

				getGlobalState(this.context, "mcpMarketplaceCatalog").then((mcpMarketplaceCatalog) => {
					if (mcpMarketplaceCatalog) {
						sendMcpMarketplaceCatalogEvent(mcpMarketplaceCatalog as McpMarketplaceCatalog)
					}
				})
				this.silentlyRefreshMcpMarketplace()
				handleModelsServiceRequest(this, "refreshOpenRouterModels", EmptyRequest.create()).then(async (response) => {
					if (response && response.models) {
						// update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
						const { apiConfiguration } = await getAllExtensionState(this.context)
						if (apiConfiguration.openRouterModelId && response.models[apiConfiguration.openRouterModelId]) {
							await updateGlobalState(
								this.context,
								"openRouterModelInfo",
								response.models[apiConfiguration.openRouterModelId],
							)
							await this.postStateToWebview()
						}
					}
				})

				// Initialize telemetry service with user's current setting
				this.getStateToPostToWebview().then((state) => {
					const { telemetrySetting } = state
					const isOptedIn = telemetrySetting !== "disabled"
					telemetryService.updateTelemetryState(isOptedIn)
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
				await this.initTask(message.text, message.images, message.files)
				break
			case "apiConfiguration":
				if (message.apiConfiguration) {
					await updateApiConfiguration(this.context, message.apiConfiguration)
					if (this.task) {
						this.task.api = buildApiHandler(message.apiConfiguration)
					}
				}
				await this.postStateToWebview()
				break
			case "fetchUserCreditsData": {
				await this.fetchUserCreditsData()
				break
			}
			case "fetchMcpMarketplace": {
				await this.fetchMcpMarketplace(message.bool)
				break
			}
			// case "openMcpMarketplaceServerDetails": {
			// 	if (message.text) {
			// 		const response = await fetch(`https://api.cline.bot/v1/mcp/marketplace/item?mcpId=${message.mcpId}`)
			// 		const details: McpDownloadResponse = await response.json()

			// 		if (details.readmeContent) {
			// 			// Disable markdown preview markers
			// 			const config = vscode.workspace.getConfiguration("markdown")
			// 			await config.update("preview.markEditorSelection", false, true)

			// 			// Create URI with base64 encoded markdown content
			// 			const uri = vscode.Uri.parse(
			// 				`${DIFF_VIEW_URI_SCHEME}:${details.name} README?${Buffer.from(details.readmeContent).toString("base64")}`,
			// 			)

			// 			// close existing
			// 			const tabs = vscode.window.tabGroups.all
			// 				.flatMap((tg) => tg.tabs)
			// 				.filter((tab) => tab.label && tab.label.includes("README") && tab.label.includes("Preview"))
			// 			for (const tab of tabs) {
			// 				await vscode.window.tabGroups.close(tab)
			// 			}

			// 			// Show only the preview
			// 			await vscode.commands.executeCommand("markdown.showPreview", uri, {
			// 				sideBySide: true,
			// 				preserveFocus: true,
			// 			})
			// 		}
			// 	}

			// 	this.postMessageToWebview({ type: "relinquishControl" })

			// 	break
			// }
			case "toggleWorkflow": {
				const { workflowPath, enabled, isGlobal } = message
				if (workflowPath && typeof enabled === "boolean" && typeof isGlobal === "boolean") {
					if (isGlobal) {
						const globalWorkflowToggles =
							((await getGlobalState(this.context, "globalWorkflowToggles")) as ClineRulesToggles) || {}
						globalWorkflowToggles[workflowPath] = enabled
						await updateGlobalState(this.context, "globalWorkflowToggles", globalWorkflowToggles)
						await this.postStateToWebview()
					} else {
						const toggles = ((await getWorkspaceState(this.context, "workflowToggles")) as ClineRulesToggles) || {}
						toggles[workflowPath] = enabled
						await updateWorkspaceState(this.context, "workflowToggles", toggles)
						await this.postStateToWebview()
					}
				}
				break
			}
			case "fetchLatestMcpServersFromHub": {
				this.mcpHub?.sendLatestMcpServers()
				break
			}
			// telemetry
			case "telemetrySetting": {
				if (message.telemetrySetting) {
					await this.updateTelemetrySetting(message.telemetrySetting)
				}
				await this.postStateToWebview()
				break
			}
			case "updateSettings": {
				// api config
				if (message.apiConfiguration) {
					await updateApiConfiguration(this.context, message.apiConfiguration)
					if (this.task) {
						this.task.api = buildApiHandler(message.apiConfiguration)
					}
				}

				// custom instructions
				await this.updateCustomInstructions(message.customInstructionsSetting)

				// telemetry setting
				if (message.telemetrySetting) {
					await this.updateTelemetrySetting(message.telemetrySetting)
				}

				// plan act setting
				await updateGlobalState(this.context, "planActSeparateModelsSetting", message.planActSeparateModelsSetting)

				if (typeof message.enableCheckpointsSetting === "boolean") {
					await updateGlobalState(this.context, "enableCheckpointsSetting", message.enableCheckpointsSetting)
				}

				if (typeof message.mcpMarketplaceEnabled === "boolean") {
					await updateGlobalState(this.context, "mcpMarketplaceEnabled", message.mcpMarketplaceEnabled)
				}

				// chat settings (including preferredLanguage and openAIReasoningEffort)
				if (message.chatSettings) {
					await updateGlobalState(this.context, "chatSettings", message.chatSettings)
					if (this.task) {
						this.task.chatSettings = message.chatSettings
					}
				}

				// terminal settings
				if (typeof message.shellIntegrationTimeout === "number") {
					await updateGlobalState(this.context, "shellIntegrationTimeout", message.shellIntegrationTimeout)
				}

				if (typeof message.terminalReuseEnabled === "boolean") {
					await updateGlobalState(this.context, "terminalReuseEnabled", message.terminalReuseEnabled)
				}

				// after settings are updated, post state to webview
				await this.postStateToWebview()

				await this.postMessageToWebview({ type: "didUpdateSettings" })
				break
			}
			case "clearAllTaskHistory": {
				const answer = await vscode.window.showWarningMessage(
					"What would you like to delete?",
					{ modal: true },
					"Delete All Except Favorites",
					"Delete Everything",
					"Cancel",
				)

				if (answer === "Delete All Except Favorites") {
					await this.deleteNonFavoriteTaskHistory()
					await this.postStateToWebview()
				} else if (answer === "Delete Everything") {
					await this.deleteAllTaskHistory()
					await this.postStateToWebview()
				}
				this.postMessageToWebview({ type: "relinquishControl" })
				break
			}
			case "grpc_request": {
				if (message.grpc_request) {
					await handleGrpcRequest(this, message.grpc_request)
				}
				break
			}
			case "grpc_request_cancel": {
				if (message.grpc_request_cancel) {
					await handleGrpcRequestCancel(this, message.grpc_request_cancel)
				}
				break
			}
			case "executeQuickWin":
				if (message.payload) {
					const { command, title } = message.payload
					this.outputChannel.appendLine(`Received executeQuickWin: command='${command}', title='${title}'`)
					await this.initTask(title)
				}
				break

			// Add more switch case statements here as more webview message commands
			// are created within the webview context (i.e. inside media/main.js)
		}
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting) {
		await updateGlobalState(this.context, "telemetrySetting", telemetrySetting)
		const isOptedIn = telemetrySetting !== "disabled"
		telemetryService.updateTelemetryState(isOptedIn)
	}

	async togglePlanActModeWithChatSettings(chatSettings: ChatSettings, chatContent?: ChatContent) {
		const didSwitchToActMode = chatSettings.mode === "act"

		// Capture mode switch telemetry | Capture regardless of if we know the taskId
		telemetryService.captureModeSwitch(this.task?.taskId ?? "0", chatSettings.mode)

		// Get previous model info that we will revert to after saving current mode api info
		const {
			apiConfiguration,
			previousModeApiProvider: newApiProvider,
			previousModeModelId: newModelId,
			previousModeModelInfo: newModelInfo,
			previousModeVsCodeLmModelSelector: newVsCodeLmModelSelector,
			previousModeThinkingBudgetTokens: newThinkingBudgetTokens,
			previousModeReasoningEffort: newReasoningEffort,
			previousModeAwsBedrockCustomSelected: newAwsBedrockCustomSelected,
			previousModeAwsBedrockCustomModelBaseId: newAwsBedrockCustomModelBaseId,
			planActSeparateModelsSetting,
		} = await getAllExtensionState(this.context)

		const shouldSwitchModel = planActSeparateModelsSetting === true

		if (shouldSwitchModel) {
			// Save the last model used in this mode
			await updateGlobalState(this.context, "previousModeApiProvider", apiConfiguration.apiProvider)
			await updateGlobalState(this.context, "previousModeThinkingBudgetTokens", apiConfiguration.thinkingBudgetTokens)
			await updateGlobalState(this.context, "previousModeReasoningEffort", apiConfiguration.reasoningEffort)
			switch (apiConfiguration.apiProvider) {
				case "anthropic":
				case "vertex":
				case "gemini":
				case "asksage":
				case "openai-native":
				case "qwen":
				case "deepseek":
				case "xai":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.apiModelId)
					break
				case "bedrock":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.apiModelId)
					await updateGlobalState(
						this.context,
						"previousModeAwsBedrockCustomSelected",
						apiConfiguration.awsBedrockCustomSelected,
					)
					await updateGlobalState(
						this.context,
						"previousModeAwsBedrockCustomModelBaseId",
						apiConfiguration.awsBedrockCustomModelBaseId,
					)
					break
				case "openrouter":
				case "cline":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.openRouterModelId)
					await updateGlobalState(this.context, "previousModeModelInfo", apiConfiguration.openRouterModelInfo)
					break
				case "vscode-lm":
					// Important we don't set modelId to this, as it's an object not string (webview expects model id to be a string)
					await updateGlobalState(
						this.context,
						"previousModeVsCodeLmModelSelector",
						apiConfiguration.vsCodeLmModelSelector,
					)
					break
				case "openai":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.openAiModelId)
					await updateGlobalState(this.context, "previousModeModelInfo", apiConfiguration.openAiModelInfo)
					break
				case "ollama":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.ollamaModelId)
					break
				case "lmstudio":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.lmStudioModelId)
					break
				case "litellm":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.liteLlmModelId)
					await updateGlobalState(this.context, "previousModeModelInfo", apiConfiguration.liteLlmModelInfo)
					break
				case "requesty":
					await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.requestyModelId)
					await updateGlobalState(this.context, "previousModeModelInfo", apiConfiguration.requestyModelInfo)
					break
			}

			// Restore the model used in previous mode
			if (
				newApiProvider ||
				newModelId ||
				newThinkingBudgetTokens !== undefined ||
				newReasoningEffort ||
				newVsCodeLmModelSelector
			) {
				await updateGlobalState(this.context, "apiProvider", newApiProvider)
				await updateGlobalState(this.context, "thinkingBudgetTokens", newThinkingBudgetTokens)
				await updateGlobalState(this.context, "reasoningEffort", newReasoningEffort)
				switch (newApiProvider) {
					case "anthropic":
					case "vertex":
					case "gemini":
					case "asksage":
					case "openai-native":
					case "qwen":
					case "deepseek":
					case "xai":
						await updateGlobalState(this.context, "apiModelId", newModelId)
						break
					case "bedrock":
						await updateGlobalState(this.context, "apiModelId", newModelId)
						await updateGlobalState(this.context, "awsBedrockCustomSelected", newAwsBedrockCustomSelected)
						await updateGlobalState(this.context, "awsBedrockCustomModelBaseId", newAwsBedrockCustomModelBaseId)
						break
					case "openrouter":
					case "cline":
						await updateGlobalState(this.context, "openRouterModelId", newModelId)
						await updateGlobalState(this.context, "openRouterModelInfo", newModelInfo)
						break
					case "vscode-lm":
						await updateGlobalState(this.context, "vsCodeLmModelSelector", newVsCodeLmModelSelector)
						break
					case "openai":
						await updateGlobalState(this.context, "openAiModelId", newModelId)
						await updateGlobalState(this.context, "openAiModelInfo", newModelInfo)
						break
					case "ollama":
						await updateGlobalState(this.context, "ollamaModelId", newModelId)
						break
					case "lmstudio":
						await updateGlobalState(this.context, "lmStudioModelId", newModelId)
						break
					case "litellm":
						await updateGlobalState(this.context, "previousModeModelId", apiConfiguration.liteLlmModelId)
						await updateGlobalState(this.context, "previousModeModelInfo", apiConfiguration.liteLlmModelInfo)
						break
					case "requesty":
						await updateGlobalState(this.context, "requestyModelId", newModelId)
						await updateGlobalState(this.context, "requestyModelInfo", newModelInfo)
						break
				}

				if (this.task) {
					const { apiConfiguration: updatedApiConfiguration } = await getAllExtensionState(this.context)
					this.task.api = buildApiHandler(updatedApiConfiguration)
				}
			}
		}

		await updateGlobalState(this.context, "chatSettings", chatSettings)
		await this.postStateToWebview()

		if (this.task) {
			this.task.chatSettings = chatSettings
			if (this.task.isAwaitingPlanResponse && didSwitchToActMode) {
				this.task.didRespondToPlanAskBySwitchingMode = true
				// Use chatContent if provided, otherwise use default message
				await this.task.handleWebviewAskResponse(
					"messageResponse",
					chatContent?.message || "PLAN_MODE_TOGGLE_RESPONSE",
					chatContent?.images || [],
					chatContent?.files || [],
				)
			} else {
				this.cancelTask()
			}
		}
	}

	async cancelTask() {
		if (this.task) {
			const { historyItem } = await this.getTaskWithId(this.task.taskId)
			try {
				await this.task.abortTask()
			} catch (error) {
				console.error("Failed to abort task", error)
			}
			await pWaitFor(
				() =>
					this.task === undefined ||
					this.task.isStreaming === false ||
					this.task.didFinishAbortingStream ||
					this.task.isWaitingForFirstChunk, // if only first chunk is processed, then there's no need to wait for graceful abort (closes edits, browser, etc)
				{
					timeout: 3_000,
				},
			).catch(() => {
				console.error("Failed to abort task")
			})
			if (this.task) {
				// 'abandoned' will prevent this cline instance from affecting future cline instance gui. this may happen if its hanging on a streaming request
				this.task.abandoned = true
			}
			await this.initTask(undefined, undefined, undefined, historyItem) // clears task again, so we need to abortTask manually above
			// await this.postStateToWebview() // new Cline instance will post state when it's ready. having this here sent an empty messages array to webview leading to virtuoso having to reload the entire list
		}
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field
		await updateGlobalState(this.context, "customInstructions", instructions || undefined)
		if (this.task) {
			this.task.customInstructions = instructions || undefined
		}
	}

	// Account

	async fetchUserCreditsData() {
		try {
			await Promise.all([
				this.accountService?.fetchBalance(),
				this.accountService?.fetchUsageTransactions(),
				this.accountService?.fetchPaymentTransactions(),
			])
		} catch (error) {
			console.error("Failed to fetch user credits data:", error)
		}
	}

	// Auth

	public async validateAuthState(state: string | null): Promise<boolean> {
		const storedNonce = await getSecret(this.context, "authNonce")
		if (!state || state !== storedNonce) {
			return false
		}
		await storeSecret(this.context, "authNonce", undefined) // Clear after use
		return true
	}

	async handleAuthCallback(customToken: string, apiKey: string) {
		try {
			// Store API key for API calls
			await storeSecret(this.context, "clineApiKey", apiKey)

			// Send custom token to webview for Firebase auth
			await sendAuthCallbackEvent(customToken)

			const clineProvider: ApiProvider = "cline"
			await updateGlobalState(this.context, "apiProvider", clineProvider)

			// Update API configuration with the new provider and API key
			const { apiConfiguration } = await getAllExtensionState(this.context)
			const updatedConfig = {
				...apiConfiguration,
				apiProvider: clineProvider,
				clineApiKey: apiKey,
			}

			if (this.task) {
				this.task.api = buildApiHandler(updatedConfig)
			}

			await this.postStateToWebview()
			// vscode.window.showInformationMessage("Successfully logged in to Cline")
		} catch (error) {
			console.error("Failed to handle auth callback:", error)
			vscode.window.showErrorMessage("Failed to log in to Cline")
			// Even on login failure, we preserve any existing tokens
			// Only clear tokens on explicit logout
		}
	}

	// MCP Marketplace

	private async fetchMcpMarketplaceFromApi(silent: boolean = false): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const response = await axios.get("https://api.cline.bot/v1/mcp/marketplace", {
				headers: {
					"Content-Type": "application/json",
				},
			})

			if (!response.data) {
				throw new Error("Invalid response from MCP marketplace API")
			}

			const catalog: McpMarketplaceCatalog = {
				items: (response.data || []).map((item: any) => ({
					...item,
					githubStars: item.githubStars ?? 0,
					downloadCount: item.downloadCount ?? 0,
					tags: item.tags ?? [],
				})),
			}

			// Store in global state
			await updateGlobalState(this.context, "mcpMarketplaceCatalog", catalog)
			return catalog
		} catch (error) {
			console.error("Failed to fetch MCP marketplace:", error)
			if (!silent) {
				const errorMessage = error instanceof Error ? error.message : "Failed to fetch MCP marketplace"
				vscode.window.showErrorMessage(errorMessage)
			}
			return undefined
		}
	}

	private async fetchMcpMarketplaceFromApiRPC(silent: boolean = false): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const response = await axios.get("https://api.cline.bot/v1/mcp/marketplace", {
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "cline-vscode-extension",
				},
			})

			if (!response.data) {
				throw new Error("Invalid response from MCP marketplace API")
			}

			const catalog: McpMarketplaceCatalog = {
				items: (response.data || []).map((item: any) => ({
					...item,
					githubStars: item.githubStars ?? 0,
					downloadCount: item.downloadCount ?? 0,
					tags: item.tags ?? [],
				})),
			}

			// Store in global state
			await updateGlobalState(this.context, "mcpMarketplaceCatalog", catalog)
			return catalog
		} catch (error) {
			console.error("Failed to fetch MCP marketplace:", error)
			if (!silent) {
				const errorMessage = error instanceof Error ? error.message : "Failed to fetch MCP marketplace"
				throw new Error(errorMessage)
			}
			return undefined
		}
	}

	async silentlyRefreshMcpMarketplace() {
		try {
			const catalog = await this.fetchMcpMarketplaceFromApi(true)
			if (catalog) {
				await sendMcpMarketplaceCatalogEvent(catalog)
			}
		} catch (error) {
			console.error("Failed to silently refresh MCP marketplace:", error)
		}
	}

	/**
	 * RPC variant that silently refreshes the MCP marketplace catalog and returns the result
	 * Unlike silentlyRefreshMcpMarketplace, this doesn't post a message to the webview
	 * @returns MCP marketplace catalog or undefined if refresh failed
	 */
	async silentlyRefreshMcpMarketplaceRPC() {
		try {
			return await this.fetchMcpMarketplaceFromApiRPC(true)
		} catch (error) {
			console.error("Failed to silently refresh MCP marketplace (RPC):", error)
			return undefined
		}
	}

	private async fetchMcpMarketplace(forceRefresh: boolean = false) {
		try {
			// Check if we have cached data
			const cachedCatalog = (await getGlobalState(this.context, "mcpMarketplaceCatalog")) as
				| McpMarketplaceCatalog
				| undefined
			if (!forceRefresh && cachedCatalog?.items) {
				await sendMcpMarketplaceCatalogEvent(cachedCatalog)
				return
			}

			const catalog = await this.fetchMcpMarketplaceFromApi(false)
			if (catalog) {
				await sendMcpMarketplaceCatalogEvent(catalog)
			}
		} catch (error) {
			console.error("Failed to handle cached MCP marketplace:", error)
			const errorMessage = error instanceof Error ? error.message : "Failed to handle cached MCP marketplace"
			vscode.window.showErrorMessage(errorMessage)
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
		await updateGlobalState(this.context, "apiProvider", openrouter)
		await storeSecret(this.context, "openRouterApiKey", apiKey)
		await this.postStateToWebview()
		if (this.task) {
			this.task.api = buildApiHandler({
				apiProvider: openrouter,
				openRouterApiKey: apiKey,
			})
		}
		// await this.postMessageToWebview({ type: "action", action: "settingsButtonClicked" }) // bad ux if user is on welcome
	}

	private async ensureCacheDirectoryExists(): Promise<string> {
		const cacheDir = path.join(this.context.globalStorageUri.fsPath, "cache")
		await fs.mkdir(cacheDir, { recursive: true })
		return cacheDir
	}

	// Read OpenRouter models from disk cache
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		const openRouterModelsFilePath = path.join(await this.ensureCacheDirectoryExists(), GlobalFileNames.openRouterModels)
		const fileExists = await fileExistsAtPath(openRouterModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		}
		return undefined
	}

	// Context menus and code actions

	getFileMentionFromPath(filePath: string) {
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (!cwd) {
			return "@/" + filePath
		}
		const relativePath = path.relative(cwd, filePath)
		return "@/" + relativePath
	}

	// 'Add to Cline' context menu in editor and code action
	async addSelectedCodeToChat(code: string, filePath: string, languageId: string, diagnostics?: vscode.Diagnostic[]) {
		// Ensure the sidebar view is visible
		await vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
		await setTimeoutPromise(100)

		// Post message to webview with the selected code
		const fileMention = this.getFileMentionFromPath(filePath)

		let input = `${fileMention}\n\`\`\`\n${code}\n\`\`\``
		if (diagnostics) {
			const problemsString = this.convertDiagnosticsToProblemsString(diagnostics)
			input += `\nProblems:\n${problemsString}`
		}

		await sendAddToInputEvent(input)

		console.log("addSelectedCodeToChat", code, filePath, languageId)
	}

	// 'Add to Cline' context menu in Terminal
	async addSelectedTerminalOutputToChat(output: string, terminalName: string) {
		// Ensure the sidebar view is visible
		await vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
		await setTimeoutPromise(100)

		// Post message to webview with the selected terminal output
		// await this.postMessageToWebview({
		//     type: "addSelectedTerminalOutput",
		//     output,
		//     terminalName
		// })

		await sendAddToInputEvent(`Terminal output:\n\`\`\`\n${output}\n\`\`\``)

		console.log("addSelectedTerminalOutputToChat", output, terminalName)
	}

	// 'Fix with Cline' in code actions
	async fixWithCline(code: string, filePath: string, languageId: string, diagnostics: vscode.Diagnostic[]) {
		// Ensure the sidebar view is visible
		await vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
		await setTimeoutPromise(100)

		const fileMention = this.getFileMentionFromPath(filePath)
		const problemsString = this.convertDiagnosticsToProblemsString(diagnostics)
		await this.initTask(`Fix the following code in ${fileMention}\n\`\`\`\n${code}\n\`\`\`\n\nProblems:\n${problemsString}`)

		console.log("fixWithCline", code, filePath, languageId, diagnostics, problemsString)
	}

	convertDiagnosticsToProblemsString(diagnostics: vscode.Diagnostic[]) {
		let problemsString = ""
		for (const diagnostic of diagnostics) {
			let label: string
			switch (diagnostic.severity) {
				case vscode.DiagnosticSeverity.Error:
					label = "Error"
					break
				case vscode.DiagnosticSeverity.Warning:
					label = "Warning"
					break
				case vscode.DiagnosticSeverity.Information:
					label = "Information"
					break
				case vscode.DiagnosticSeverity.Hint:
					label = "Hint"
					break
				default:
					label = "Diagnostic"
			}
			const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
			const source = diagnostic.source ? `${diagnostic.source} ` : ""
			problemsString += `\n- [${source}${label}] Line ${line}: ${diagnostic.message}`
		}
		problemsString = problemsString.trim()
		return problemsString
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = ((await getGlobalState(this.context, "taskHistory")) as HistoryItem[] | undefined) || []
		const historyItem = history.find((item) => item.id === id)
		if (historyItem) {
			const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks", id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}
		// if we tried to get a task that doesn't exist, remove it from state
		// FIXME: this seems to happen sometimes when the json file doesn't save to disk for some reason
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		await downloadTask(historyItem.ts, apiConversationHistory)
	}

	async deleteAllTaskHistory() {
		await this.clearTask()
		await updateGlobalState(this.context, "taskHistory", undefined)
		try {
			// Remove all contents of tasks directory
			const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks")
			if (await fileExistsAtPath(taskDirPath)) {
				await fs.rm(taskDirPath, { recursive: true, force: true })
			}
			// Remove checkpoints directory contents
			const checkpointsDirPath = path.join(this.context.globalStorageUri.fsPath, "checkpoints")
			if (await fileExistsAtPath(checkpointsDirPath)) {
				await fs.rm(checkpointsDirPath, { recursive: true, force: true })
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Encountered error while deleting task history, there may be some files left behind. Error: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		// await this.postStateToWebview()
	}

	async deleteNonFavoriteTaskHistory() {
		await this.clearTask()

		const taskHistory = ((await getGlobalState(this.context, "taskHistory")) as HistoryItem[]) || []
		const favoritedTasks = taskHistory.filter((task) => task.isFavorited === true)

		// If user has no favorited tasks, show a warning message
		if (favoritedTasks.length === 0) {
			vscode.window.showWarningMessage("No favorited tasks found. Please favorite tasks before using this option.")
			await this.postStateToWebview()
			return
		}

		await updateGlobalState(this.context, "taskHistory", favoritedTasks)

		// Delete non-favorited task directories
		try {
			const preserveTaskIds = favoritedTasks.map((task) => task.id)
			const taskDirPath = path.join(this.context.globalStorageUri.fsPath, "tasks")

			if (await fileExistsAtPath(taskDirPath)) {
				const taskDirs = await fs.readdir(taskDirPath)
				for (const taskDir of taskDirs) {
					if (!preserveTaskIds.includes(taskDir)) {
						await fs.rm(path.join(taskDirPath, taskDir), { recursive: true, force: true })
					}
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Error deleting task history: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		await this.postStateToWebview()
	}

	async deleteTaskWithId(id: string) {
		console.info("deleteTaskWithId: ", id)

		try {
			if (id === this.task?.taskId) {
				await this.clearTask()
				console.debug("cleared task")
			}

			const {
				taskDirPath,
				apiConversationHistoryFilePath,
				uiMessagesFilePath,
				contextHistoryFilePath,
				taskMetadataFilePath,
			} = await this.getTaskWithId(id)
			const legacyMessagesFilePath = path.join(taskDirPath, "claude_messages.json")
			const updatedTaskHistory = await this.deleteTaskFromState(id)

			// Delete the task files
			for (const filePath of [
				apiConversationHistoryFilePath,
				uiMessagesFilePath,
				contextHistoryFilePath,
				taskMetadataFilePath,
				legacyMessagesFilePath,
			]) {
				const fileExists = await fileExistsAtPath(filePath)
				if (fileExists) {
					await fs.unlink(filePath)
				}
			}

			await fs.rmdir(taskDirPath) // succeeds if the dir is empty

			if (updatedTaskHistory.length === 0) {
				await this.deleteAllTaskHistory()
			}
		} catch (error) {
			console.debug(`Error deleting task:`, error)
		}

		await this.postStateToWebview()
	}

	async deleteTaskFromState(id: string) {
		// Remove the task from history
		const taskHistory = ((await getGlobalState(this.context, "taskHistory")) as HistoryItem[] | undefined) || []
		const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
		await updateGlobalState(this.context, "taskHistory", updatedTaskHistory)

		// Notify the webview that the task has been deleted
		await this.postStateToWebview()

		return updatedTaskHistory
	}

	async postStateToWebview() {
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		const {
			apiConfiguration,
			lastShownAnnouncementId,
			customInstructions,
			taskHistory,
			autoApprovalSettings,
			browserSettings,
			chatSettings,
			userInfo,
			mcpMarketplaceEnabled,
			telemetrySetting,
			planActSeparateModelsSetting,
			enableCheckpointsSetting,
			globalClineRulesToggles,
			globalWorkflowToggles,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			isNewUser,
		} = await getAllExtensionState(this.context)

		const localClineRulesToggles =
			((await getWorkspaceState(this.context, "localClineRulesToggles")) as ClineRulesToggles) || {}

		const localWindsurfRulesToggles =
			((await getWorkspaceState(this.context, "localWindsurfRulesToggles")) as ClineRulesToggles) || {}

		const localCursorRulesToggles =
			((await getWorkspaceState(this.context, "localCursorRulesToggles")) as ClineRulesToggles) || {}

		const localWorkflowToggles = ((await getWorkspaceState(this.context, "workflowToggles")) as ClineRulesToggles) || {}

		return {
			version: this.context.extension?.packageJSON?.version ?? "",
			apiConfiguration,
			customInstructions,
			uriScheme: vscode.env.uriScheme,
			currentTaskItem: this.task?.taskId ? (taskHistory || []).find((item) => item.id === this.task?.taskId) : undefined,
			checkpointTrackerErrorMessage: this.task?.checkpointTrackerErrorMessage,
			clineMessages: this.task?.clineMessages || [],
			taskHistory: (taskHistory || [])
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
				.slice(0, 100), // for now we're only getting the latest 100 tasks, but a better solution here is to only pass in 3 for recent task history, and then get the full task history on demand when going to the task history view (maybe with pagination?)
			shouldShowAnnouncement: lastShownAnnouncementId !== this.latestAnnouncementId,
			platform: process.platform as Platform,
			autoApprovalSettings,
			browserSettings,
			chatSettings,
			userInfo,
			mcpMarketplaceEnabled,
			telemetrySetting,
			planActSeparateModelsSetting,
			enableCheckpointsSetting: enableCheckpointsSetting ?? true,
			distinctId: telemetryService.distinctId,
			globalClineRulesToggles: globalClineRulesToggles || {},
			localClineRulesToggles: localClineRulesToggles || {},
			localWindsurfRulesToggles: localWindsurfRulesToggles || {},
			localCursorRulesToggles: localCursorRulesToggles || {},
			localWorkflowToggles: localWorkflowToggles || {},
			globalWorkflowToggles: globalWorkflowToggles || {},
			shellIntegrationTimeout,
			terminalReuseEnabled,
			isNewUser,
		}
	}

	async clearTask() {
		if (this.task) {
			await telemetryService.sendCollectedEvents(this.task.taskId)
		}
		this.task?.abortTask()
		this.task = undefined // removes reference to it, so once promises end it will be garbage collected
	}

	// Caching mechanism to keep track of webview messages + API conversation history per provider instance

	/*
	Now that we use retainContextWhenHidden, we don't have to store a cache of cline messages in the user's state, but we could to reduce memory footprint in long conversations.

	- We have to be careful of what state is shared between ClineProvider instances since there could be multiple instances of the extension running at once. For example when we cached cline messages using the same key, two instances of the extension could end up using the same key and overwriting each other's messages.
	- Some state does need to be shared between the instances, i.e. the API key--however there doesn't seem to be a good way to notify the other instances that the API key has changed.

	We need to use a unique identifier for each ClineProvider instance's message cache since we could be running several instances of the extension outside of just the sidebar i.e. in editor panels.

	// conversation history to send in API requests

	/*
	It seems that some API messages do not comply with vscode state requirements. Either the Anthropic library is manipulating these values somehow in the backend in a way that's creating cyclic references, or the API returns a function or a Symbol as part of the message content.
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

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = ((await getGlobalState(this.context, "taskHistory")) as HistoryItem[]) || []
		const existingItemIndex = history.findIndex((h) => h.id === item.id)
		if (existingItemIndex !== -1) {
			history[existingItemIndex] = item
		} else {
			history.push(item)
		}
		await updateGlobalState(this.context, "taskHistory", history)
		return history
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

	// Git commit message generation

	async generateGitCommitMessage() {
		try {
			// Check if there's a workspace folder open
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!cwd) {
				vscode.window.showErrorMessage("No workspace folder open")
				return
			}

			// Get the git diff
			const gitDiff = await getWorkingState(cwd)
			if (gitDiff === "No changes in working directory") {
				vscode.window.showInformationMessage("No changes in workspace for commit message")
				return
			}

			// Show a progress notification
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Generating commit message...",
					cancellable: false,
				},
				async (progress, token) => {
					try {
						// Format the git diff into a prompt
						const prompt = `Based on the following git diff, generate a concise and descriptive commit message:

${gitDiff.length > 5000 ? gitDiff.substring(0, 5000) + "\n\n[Diff truncated due to size]" : gitDiff}

The commit message should:
1. Start with a short summary (50-72 characters)
2. Use the imperative mood (e.g., "Add feature" not "Added feature")
3. Describe what was changed and why
4. Be clear and descriptive

Commit message:`

						// Get the current API configuration
						const { apiConfiguration } = await getAllExtensionState(this.context)

						// Build the API handler
						const apiHandler = buildApiHandler(apiConfiguration)

						// Create a system prompt
						const systemPrompt =
							"You are a helpful assistant that generates concise and descriptive git commit messages based on git diffs."

						// Create a message for the API
						const messages = [
							{
								role: "user" as const,
								content: prompt,
							},
						]

						// Call the API directly
						const stream = apiHandler.createMessage(systemPrompt, messages)

						// Collect the response
						let response = ""
						for await (const chunk of stream) {
							if (chunk.type === "text") {
								response += chunk.text
							}
						}

						// Extract the commit message
						const commitMessage = extractCommitMessage(response)

						// Apply the commit message to the Git input box
						if (commitMessage) {
							// Get the Git extension API
							const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports
							if (gitExtension) {
								const api = gitExtension.getAPI(1)
								if (api && api.repositories.length > 0) {
									const repo = api.repositories[0]
									repo.inputBox.value = commitMessage
									vscode.window.showInformationMessage("Commit message generated and applied")
								} else {
									vscode.window.showErrorMessage("No Git repositories found")
								}
							} else {
								vscode.window.showErrorMessage("Git extension not found")
							}
						} else {
							vscode.window.showErrorMessage("Failed to generate commit message")
						}
					} catch (innerError) {
						const innerErrorMessage = innerError instanceof Error ? innerError.message : String(innerError)
						vscode.window.showErrorMessage(`Failed to generate commit message: ${innerErrorMessage}`)
					}
				},
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			vscode.window.showErrorMessage(`Failed to generate commit message: ${errorMessage}`)
		}
	}

	// dev
}
