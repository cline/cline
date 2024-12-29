import { OpenAiHandler } from "./openai"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { deepSeekModels, deepSeekDefaultModelId } from "../../shared/api"

export class DeepSeekHandler extends OpenAiHandler {
    constructor(options: ApiHandlerOptions) {
        if (!options.deepSeekApiKey) {
            throw new Error("DeepSeek API key is required. Please provide it in the settings.")
        }
        super({
            ...options,
            openAiApiKey: options.deepSeekApiKey,
            openAiModelId: options.deepSeekModelId ?? deepSeekDefaultModelId,
            openAiBaseUrl: options.deepSeekBaseUrl ?? "https://api.deepseek.com/v1",
            includeMaxTokens: true
        })
    }

    override getModel(): { id: string; info: ModelInfo } {
        const modelId = this.options.deepSeekModelId ?? deepSeekDefaultModelId
        return {
            id: modelId,
            info: deepSeekModels[modelId as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId]
        }
    }
}
