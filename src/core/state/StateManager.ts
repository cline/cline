import * as vscode from "vscode"
import { SecretKey, GlobalStateKey } from "../../types/state"
import { ApiProvider, ModelInfo } from "../../shared/api"
import { HistoryItem } from "../../shared/HistoryItem"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../shared/AutoApprovalSettings"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "../../shared/BrowserSettings"
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from "../../shared/ChatSettings"
import { UserInfo } from "../../services/auth/FirebaseAuthManager"

export class StateManager {
	constructor(private context: vscode.ExtensionContext) {}

	async updateGlobalState(key: GlobalStateKey, value: any) {
		await this.context.globalState.update(key, value)
	}

	async getGlobalState(key: GlobalStateKey) {
		return await this.context.globalState.get(key)
	}

	async storeSecret(key: SecretKey, value?: string) {
		if (value) {
			await this.context.secrets.store(key, value)
		} else {
			await this.context.secrets.delete(key)
		}
	}

	async getSecret(key: SecretKey) {
		return await this.context.secrets.get(key)
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

	async resetState() {
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
			"requestyApiKey",
			"togetherApiKey",
			"qwenApiKey",
			"mistralApiKey",
			"liteLlmApiKey",
			"authToken",
		]
		for (const key of secretKeys) {
			await this.storeSecret(key, undefined)
		}
	}

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
			awsProfile,
			awsUseProfile,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiApiKey,
			openAiModelId,
			openAiModelInfo,
			ollamaModelId,
			ollamaBaseUrl,
			lmStudioModelId,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiApiKey,
			openAiNativeApiKey,
			deepSeekApiKey,
			requestyApiKey,
			requestyModelId,
			togetherApiKey,
			togetherModelId,
			qwenApiKey,
			mistralApiKey,
			azureApiVersion,
			openRouterModelId,
			openRouterModelInfo,
			lastShownAnnouncementId,
			customInstructions,
			taskHistory,
			autoApprovalSettings,
			browserSettings,
			chatSettings,
			vsCodeLmModelSelector,
			liteLlmBaseUrl,
			liteLlmModelId,
			userInfo,
			authToken,
			previousModeApiProvider,
			previousModeModelId,
			previousModeModelInfo,
			qwenApiLine,
			liteLlmApiKey,
		] = await Promise.all([
			this.getGlobalState("apiProvider") as Promise<ApiProvider | undefined>,
			this.getGlobalState("apiModelId"),
			this.getSecret("apiKey"),
			this.getSecret("openRouterApiKey"),
			this.getSecret("awsAccessKey"),
			this.getSecret("awsSecretKey"),
			this.getSecret("awsSessionToken"),
			this.getGlobalState("awsRegion"),
			this.getGlobalState("awsUseCrossRegionInference"),
			this.getGlobalState("awsProfile"),
			this.getGlobalState("awsUseProfile"),
			this.getGlobalState("vertexProjectId"),
			this.getGlobalState("vertexRegion"),
			this.getGlobalState("openAiBaseUrl"),
			this.getSecret("openAiApiKey"),
			this.getGlobalState("openAiModelId"),
			this.getGlobalState("openAiModelInfo"),
			this.getGlobalState("ollamaModelId"),
			this.getGlobalState("ollamaBaseUrl"),
			this.getGlobalState("lmStudioModelId"),
			this.getGlobalState("lmStudioBaseUrl"),
			this.getGlobalState("anthropicBaseUrl"),
			this.getSecret("geminiApiKey"),
			this.getSecret("openAiNativeApiKey"),
			this.getSecret("deepSeekApiKey"),
			this.getSecret("requestyApiKey"),
			this.getGlobalState("requestyModelId"),
			this.getSecret("togetherApiKey"),
			this.getGlobalState("togetherModelId"),
			this.getSecret("qwenApiKey"),
			this.getSecret("mistralApiKey"),
			this.getGlobalState("azureApiVersion"),
			this.getGlobalState("openRouterModelId"),
			this.getGlobalState("openRouterModelInfo"),
			this.getGlobalState("lastShownAnnouncementId"),
			this.getGlobalState("customInstructions"),
			this.getGlobalState("taskHistory"),
			this.getGlobalState("autoApprovalSettings"),
			this.getGlobalState("browserSettings"),
			this.getGlobalState("chatSettings"),
			this.getGlobalState("vsCodeLmModelSelector"),
			this.getGlobalState("liteLlmBaseUrl"),
			this.getGlobalState("liteLlmModelId"),
			this.getGlobalState("userInfo"),
			this.getSecret("authToken"),
			this.getGlobalState("previousModeApiProvider"),
			this.getGlobalState("previousModeModelId"),
			this.getGlobalState("previousModeModelInfo"),
			this.getGlobalState("qwenApiLine"),
			this.getSecret("liteLlmApiKey"),
		])

		let apiProvider: ApiProvider
		if (storedApiProvider) {
			apiProvider = storedApiProvider
		} else {
			if (apiKey) {
				apiProvider = "anthropic"
			} else {
				apiProvider = "openrouter"
			}
		}

		const o3MiniReasoningEffort = vscode.workspace
			.getConfiguration("cline.modelSettings.o3Mini")
			.get("reasoningEffort", "medium")

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
				awsProfile,
				awsUseProfile,
				vertexProjectId,
				vertexRegion,
				openAiBaseUrl,
				openAiApiKey,
				openAiModelId,
				openAiModelInfo,
				ollamaModelId,
				ollamaBaseUrl,
				lmStudioModelId,
				lmStudioBaseUrl,
				anthropicBaseUrl,
				geminiApiKey,
				openAiNativeApiKey,
				deepSeekApiKey,
				requestyApiKey,
				requestyModelId,
				togetherApiKey,
				togetherModelId,
				qwenApiKey,
				qwenApiLine,
				mistralApiKey,
				azureApiVersion,
				openRouterModelId,
				openRouterModelInfo,
				vsCodeLmModelSelector,
				o3MiniReasoningEffort,
				liteLlmBaseUrl,
				liteLlmModelId,
				liteLlmApiKey,
			},
			lastShownAnnouncementId,
			customInstructions,
			taskHistory,
			autoApprovalSettings: autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS,
			browserSettings: browserSettings || DEFAULT_BROWSER_SETTINGS,
			chatSettings: chatSettings || DEFAULT_CHAT_SETTINGS,
			userInfo,
			authToken,
			previousModeApiProvider,
			previousModeModelId,
			previousModeModelInfo,
		}
	}
}
