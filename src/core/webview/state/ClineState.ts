import * as vscode from "vscode"
import { ApiProvider, ModelInfo } from "../../../shared/api"
import { HistoryItem } from "../../../shared/HistoryItem"

export type SecretKey =
    | "apiKey"
    | "openRouterApiKey"
    | "awsAccessKey"
    | "awsSecretKey"
    | "awsSessionToken"
    | "openAiApiKey"
    | "geminiApiKey"
    | "openAiNativeApiKey"

export type GlobalStateKey =
    | "apiProvider"
    | "apiModelId"
    | "awsRegion"
    | "awsUseCrossRegionInference"
    | "vertexProjectId"
    | "vertexRegion"
    | "lastShownAnnouncementId"
    | "customInstructions"
    | "alwaysAllowReadOnly"
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

export class ClineState {
    constructor(private readonly context: vscode.ExtensionContext) {}

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
            azureApiVersion,
            openRouterModelId,
            openRouterModelInfo,
            lastShownAnnouncementId,
            customInstructions,
            alwaysAllowReadOnly,
            taskHistory,
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
            this.getGlobalState("azureApiVersion") as Promise<string | undefined>,
            this.getGlobalState("openRouterModelId") as Promise<string | undefined>,
            this.getGlobalState("openRouterModelInfo") as Promise<ModelInfo | undefined>,
            this.getGlobalState("lastShownAnnouncementId") as Promise<string | undefined>,
            this.getGlobalState("customInstructions") as Promise<string | undefined>,
            this.getGlobalState("alwaysAllowReadOnly") as Promise<boolean | undefined>,
            this.getGlobalState("taskHistory") as Promise<HistoryItem[] | undefined>,
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
                azureApiVersion,
                openRouterModelId,
                openRouterModelInfo,
            },
            lastShownAnnouncementId,
            customInstructions,
            alwaysAllowReadOnly: alwaysAllowReadOnly ?? false,
            taskHistory,
        }
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
        ]
        for (const key of secretKeys) {
            await this.storeSecret(key, undefined)
        }
    }
}
