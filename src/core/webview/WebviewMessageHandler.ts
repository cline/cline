import * as vscode from "vscode"
import { WebviewMessage, ClineCheckpointRestore } from "../../shared/WebviewMessage"
import { StateManager } from "../state/StateManager"
import { IClineProvider } from "./IClineProvider"
import { buildApiHandler } from "../../api"
import { selectImages } from "../../integrations/misc/process-images"
import { openFile, openImage } from "../../integrations/misc/open-file"
import { openMention } from "../mentions"
import { downloadTask } from "../../integrations/misc/export-markdown"
import { searchCommits } from "../../utils/git"
import { getTheme } from "../../integrations/theme/getTheme"
import pWaitFor from "p-wait-for"
import crypto from "crypto"
import { ApiConfiguration } from "../../shared/api"
import { ExtensionMessage } from "../../shared/ExtensionMessage"

export class WebviewMessageHandler {
	constructor(
		private provider: IClineProvider,
		private stateManager: StateManager,
	) {}

	async handleMessage(message: WebviewMessage) {
		switch (message.type) {
			case "webviewDidLaunch":
				await this.handleWebviewLaunch()
				break
			case "newTask":
				await this.handleNewTask(message)
				break
			case "apiConfiguration":
				await this.handleApiConfiguration(message)
				break
			case "customInstructions":
				await this.handleCustomInstructions(message)
				break
			case "autoApprovalSettings":
				await this.handleAutoApprovalSettings(message)
				break
			case "browserSettings":
				await this.handleBrowserSettings(message)
				break
			case "chatSettings":
				await this.handleChatSettings(message)
				break
			case "askResponse":
				await this.handleAskResponse(message)
				break
			case "clearTask":
				await this.handleClearTask()
				break
			case "didShowAnnouncement":
				await this.handleDidShowAnnouncement()
				break
			case "selectImages":
				await this.handleSelectImages()
				break
			case "exportCurrentTask":
				await this.handleExportCurrentTask()
				break
			case "showTaskWithId":
				await this.handleShowTaskWithId(message)
				break
			case "deleteTaskWithId":
				await this.handleDeleteTaskWithId(message)
				break
			case "exportTaskWithId":
				await this.handleExportTaskWithId(message)
				break
			case "resetState":
				await this.handleResetState()
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
			case "checkpointDiff":
				await this.handleCheckpointDiff(message)
				break
			case "checkpointRestore":
				await this.handleCheckpointRestore(message)
				break
			case "taskCompletionViewChanges":
				await this.handleTaskCompletionViewChanges(message)
				break
			case "cancelTask":
				await this.provider.cancelTask()
				break
			case "getLatestState":
				await this.provider.postStateToWebview()
				break
			case "accountLoginClicked":
				await this.handleAccountLoginClicked()
				break
			case "accountLogoutClicked":
				await this.provider.handleSignOut()
				break
			case "searchCommits":
				await this.handleSearchCommits(message)
				break
			case "openExtensionSettings":
				await this.handleOpenExtensionSettings(message)
				break
		}
	}

	private async handleWebviewLaunch() {
		await this.provider.postStateToWebview()
		this.provider.workspaceTracker?.populateFilePaths()
		const theme = await getTheme()
		await this.provider.postMessageToWebview({
			type: "theme",
			text: JSON.stringify(theme),
		})
	}

	private async handleNewTask(message: WebviewMessage) {
		await this.provider.initClineWithTask(message.text, message.images)
	}

	private async handleApiConfiguration(message: WebviewMessage) {
		if (message.apiConfiguration) {
			const config = message.apiConfiguration as ApiConfiguration
			await this.stateManager.updateGlobalState("apiProvider", config.apiProvider)
			await this.stateManager.updateGlobalState("apiModelId", config.apiModelId)
			await this.stateManager.storeSecret("apiKey", config.apiKey)
			await this.stateManager.storeSecret("openRouterApiKey", config.openRouterApiKey)
			await this.stateManager.storeSecret("awsAccessKey", config.awsAccessKey)
			await this.stateManager.storeSecret("awsSecretKey", config.awsSecretKey)
			await this.stateManager.storeSecret("awsSessionToken", config.awsSessionToken)
			await this.stateManager.updateGlobalState("awsRegion", config.awsRegion)
			await this.stateManager.updateGlobalState("awsUseCrossRegionInference", config.awsUseCrossRegionInference)
			await this.stateManager.updateGlobalState("awsProfile", config.awsProfile)
			await this.stateManager.updateGlobalState("awsUseProfile", config.awsUseProfile)
			await this.stateManager.updateGlobalState("vertexProjectId", config.vertexProjectId)
			await this.stateManager.updateGlobalState("vertexRegion", config.vertexRegion)
			await this.stateManager.updateGlobalState("openAiBaseUrl", config.openAiBaseUrl)
			await this.stateManager.storeSecret("openAiApiKey", config.openAiApiKey)
			await this.stateManager.updateGlobalState("openAiModelId", config.openAiModelId)
			await this.stateManager.updateGlobalState("openAiModelInfo", config.openAiModelInfo)
			await this.stateManager.updateGlobalState("ollamaModelId", config.ollamaModelId)
			await this.stateManager.updateGlobalState("ollamaBaseUrl", config.ollamaBaseUrl)
			await this.stateManager.updateGlobalState("lmStudioModelId", config.lmStudioModelId)
			await this.stateManager.updateGlobalState("lmStudioBaseUrl", config.lmStudioBaseUrl)
			await this.stateManager.updateGlobalState("anthropicBaseUrl", config.anthropicBaseUrl)
			await this.stateManager.storeSecret("geminiApiKey", config.geminiApiKey)
			await this.stateManager.storeSecret("openAiNativeApiKey", config.openAiNativeApiKey)
			await this.stateManager.storeSecret("deepSeekApiKey", config.deepSeekApiKey)
			await this.stateManager.storeSecret("requestyApiKey", config.requestyApiKey)
			await this.stateManager.storeSecret("togetherApiKey", config.togetherApiKey)
			await this.stateManager.storeSecret("qwenApiKey", config.qwenApiKey)
			await this.stateManager.storeSecret("mistralApiKey", config.mistralApiKey)
			await this.stateManager.updateGlobalState("azureApiVersion", config.azureApiVersion)
			await this.stateManager.updateGlobalState("openRouterModelId", config.openRouterModelId)
			await this.stateManager.updateGlobalState("openRouterModelInfo", config.openRouterModelInfo)
			await this.stateManager.updateGlobalState("vsCodeLmModelSelector", config.vsCodeLmModelSelector)
			await this.stateManager.updateGlobalState("liteLlmBaseUrl", config.liteLlmBaseUrl)
			await this.stateManager.updateGlobalState("liteLlmModelId", config.liteLlmModelId)
			await this.stateManager.storeSecret("liteLlmApiKey", config.liteLlmApiKey)
			await this.stateManager.updateGlobalState("qwenApiLine", config.qwenApiLine)
			await this.stateManager.updateGlobalState("requestyModelId", config.requestyModelId)
			await this.stateManager.updateGlobalState("togetherModelId", config.togetherModelId)

			if (this.provider.getCline()) {
				this.provider.getCline()!.api = buildApiHandler(message.apiConfiguration)
			}
		}
		await this.provider.postStateToWebview()
	}

	private async handleCustomInstructions(message: WebviewMessage) {
		await this.provider.updateCustomInstructions(message.text)
	}

	private async handleAutoApprovalSettings(message: WebviewMessage) {
		if (message.autoApprovalSettings) {
			await this.stateManager.updateGlobalState("autoApprovalSettings", message.autoApprovalSettings)
			const cline = this.provider.getCline()
			if (cline) {
				cline.autoApprovalSettings = message.autoApprovalSettings
			}
			await this.provider.postStateToWebview()
		}
	}

	private async handleBrowserSettings(message: WebviewMessage) {
		if (message.browserSettings) {
			await this.stateManager.updateGlobalState("browserSettings", message.browserSettings)
			const cline = this.provider.getCline()
			if (cline) {
				cline.updateBrowserSettings(message.browserSettings)
			}
			await this.provider.postStateToWebview()
		}
	}

	private async handleChatSettings(message: WebviewMessage) {
		if (message.chatSettings) {
			const didSwitchToActMode = message.chatSettings.mode === "act"
			await this.stateManager.updateGlobalState("chatSettings", message.chatSettings)

			const cline = this.provider.getCline()
			if (cline) {
				cline.updateChatSettings(message.chatSettings)
				if (cline.isAwaitingPlanResponse && didSwitchToActMode) {
					cline.didRespondToPlanAskBySwitchingMode = true
					await this.provider.postMessageToWebview({
						type: "invoke",
						invoke: "sendMessage",
						text: message.chatContent?.message || "PLAN_MODE_TOGGLE_RESPONSE",
						images: message.chatContent?.images,
					})
				} else {
					this.provider.cancelTask()
				}
			}
			await this.provider.postStateToWebview()
		}
	}

	private async handleAskResponse(message: WebviewMessage) {
		const cline = this.provider.getCline()
		if (cline) {
			cline.handleWebviewAskResponse(message.askResponse!, message.text, message.images)
		}
	}

	private async handleClearTask() {
		await this.provider.clearTask()
		await this.provider.postStateToWebview()
	}

	private async handleDidShowAnnouncement() {
		await this.stateManager.updateGlobalState("lastShownAnnouncementId", this.provider.getLatestAnnouncementId())
		await this.provider.postStateToWebview()
	}

	private async handleSelectImages() {
		const images = await selectImages()
		await this.provider.postMessageToWebview({
			type: "selectedImages",
			images,
		})
	}

	private async handleExportCurrentTask() {
		const currentTaskId = this.provider.getCline()?.taskId
		if (currentTaskId) {
			await this.handleExportTaskWithId({ type: "exportTaskWithId", text: currentTaskId })
		}
	}

	private async handleShowTaskWithId(message: WebviewMessage) {
		const cline = this.provider.getCline()
		if (message.text !== cline?.taskId) {
			const { historyItem } = await this.provider.getTaskWithId(message.text!)
			await this.provider.initClineWithHistoryItem(historyItem)
		}
		await this.provider.postMessageToWebview({
			type: "action",
			action: "chatButtonClicked",
		})
	}

	private async handleDeleteTaskWithId(message: WebviewMessage) {
		await this.provider.deleteTaskWithId(message.text!)
	}

	private async handleExportTaskWithId(message: WebviewMessage) {
		const { historyItem, apiConversationHistory } = await this.provider.getTaskWithId(message.text!)
		await downloadTask(historyItem.ts, apiConversationHistory)
	}

	private async handleResetState() {
		await this.stateManager.resetState()
		const cline = this.provider.getCline()
		if (cline) {
			cline.abortTask()
			this.provider.setCline(undefined)
		}
		await this.provider.postStateToWebview()
		await this.provider.postMessageToWebview({
			type: "action",
			action: "chatButtonClicked",
		})
	}

	private async handleCheckpointDiff(message: WebviewMessage) {
		if (message.number) {
			const cline = this.provider.getCline()
			if (cline) {
				await cline.presentMultifileDiff(message.number, false)
			}
		}
	}

	private async handleCheckpointRestore(message: WebviewMessage) {
		await this.provider.cancelTask()
		if (message.number) {
			const cline = this.provider.getCline()
			await pWaitFor(() => cline?.isInitialized === true, {
				timeout: 3_000,
			}).catch(() => {
				console.error("Failed to init new cline instance")
			})
			if (cline) {
				const restore: ClineCheckpointRestore = {
					checkpointNumber: message.number,
					restoreMode: (message.text || "task") as "task" | "workspace" | "taskAndWorkspace",
				}
				await cline.restoreCheckpoint(message.number, restore)
			}
		}
	}

	private async handleTaskCompletionViewChanges(message: WebviewMessage) {
		if (message.number) {
			const cline = this.provider.getCline()
			if (cline) {
				await cline.presentMultifileDiff(message.number, true)
			}
		}
	}

	private async handleAccountLoginClicked() {
		const nonce = crypto.randomBytes(32).toString("hex")
		await this.stateManager.storeSecret("authNonce", nonce)

		const uriScheme = vscode.env.uriScheme
		const authUrl = vscode.Uri.parse(
			`https://app.cline.bot/auth?state=${encodeURIComponent(nonce)}&callback_url=${encodeURIComponent(
				`${uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
			)}`,
		)
		vscode.env.openExternal(authUrl)
	}

	private async handleSearchCommits(message: WebviewMessage) {
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (cwd) {
			try {
				const commits = await searchCommits(message.text || "", cwd)
				await this.provider.postMessageToWebview({
					type: "commitSearchResults",
					commits,
				})
			} catch (error) {
				console.error(`Error searching commits: ${JSON.stringify(error)}`)
			}
		}
	}

	private async handleOpenExtensionSettings(message: WebviewMessage) {
		const settingsFilter = message.text || ""
		await vscode.commands.executeCommand(
			"workbench.action.openSettings",
			`@ext:saoudrizwan.claude-dev ${settingsFilter}`.trim(),
		)
	}
}
