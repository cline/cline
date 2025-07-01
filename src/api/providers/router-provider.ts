import OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import { ApiHandlerOptions, RouterName, ModelRecord } from "../../shared/api"

import { BaseProvider } from "./base-provider"
import { getModels } from "./fetchers/modelCache"

import { DEFAULT_HEADERS } from "./constants"

type RouterProviderOptions = {
	name: RouterName
	baseURL: string
	apiKey?: string
	modelId?: string
	defaultModelId: string
	defaultModelInfo: ModelInfo
	options: ApiHandlerOptions
}

export abstract class RouterProvider extends BaseProvider {
	protected readonly options: ApiHandlerOptions
	protected readonly name: RouterName
	protected models: ModelRecord = {}
	protected readonly modelId?: string
	protected readonly defaultModelId: string
	protected readonly defaultModelInfo: ModelInfo
	protected readonly client: OpenAI

	constructor({
		options,
		name,
		baseURL,
		apiKey = "not-provided",
		modelId,
		defaultModelId,
		defaultModelInfo,
	}: RouterProviderOptions) {
		super()

		this.options = options
		this.name = name
		this.modelId = modelId
		this.defaultModelId = defaultModelId
		this.defaultModelInfo = defaultModelInfo

		this.client = new OpenAI({
			baseURL,
			apiKey,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				...(options.openAiHeaders || {}),
			},
		})
	}

	public async fetchModel() {
		this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey, baseUrl: this.client.baseURL })
		return this.getModel()
	}

	override getModel(): { id: string; info: ModelInfo } {
		const id = this.modelId ?? this.defaultModelId

		return this.models[id]
			? { id, info: this.models[id] }
			: { id: this.defaultModelId, info: this.defaultModelInfo }
	}

	protected supportsTemperature(modelId: string): boolean {
		return !modelId.startsWith("openai/o3-mini")
	}
}
