import type { ModelInfo } from "../model.js"
import { ZaiApiLine } from "../provider-settings.js"

// Z AI
// https://docs.z.ai/guides/llm/glm-4.5
// https://docs.z.ai/guides/overview/pricing

export type InternationalZAiModelId = keyof typeof internationalZAiModels
export const internationalZAiDefaultModelId: InternationalZAiModelId = "glm-4.5"
export const internationalZAiModels = {
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
	},
	"glm-4.5-air": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		outputPrice: 1.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.03,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
	},
} as const satisfies Record<string, ModelInfo>

export type MainlandZAiModelId = keyof typeof mainlandZAiModels
export const mainlandZAiDefaultModelId: MainlandZAiModelId = "glm-4.5"
export const mainlandZAiModels = {
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
		tiers: [
			{
				contextWindow: 32_000,
				inputPrice: 0.21,
				outputPrice: 1.0,
				cacheReadsPrice: 0.043,
			},
			{
				contextWindow: 128_000,
				inputPrice: 0.29,
				outputPrice: 1.14,
				cacheReadsPrice: 0.057,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.29,
				outputPrice: 1.14,
				cacheReadsPrice: 0.057,
			},
		],
	},
	"glm-4.5-air": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.1,
		outputPrice: 0.6,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.02,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
		tiers: [
			{
				contextWindow: 32_000,
				inputPrice: 0.07,
				outputPrice: 0.4,
				cacheReadsPrice: 0.014,
			},
			{
				contextWindow: 128_000,
				inputPrice: 0.1,
				outputPrice: 0.6,
				cacheReadsPrice: 0.02,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.1,
				outputPrice: 0.6,
				cacheReadsPrice: 0.02,
			},
		],
	},
} as const satisfies Record<string, ModelInfo>

export const ZAI_DEFAULT_TEMPERATURE = 0

export const zaiApiLineConfigs = {
	international_coding: {
		name: "International Coding Plan",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		isChina: false,
	},
	international: { name: "International Standard", baseUrl: "https://api.z.ai/api/paas/v4", isChina: false },
	china_coding: { name: "China Coding Plan", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", isChina: true },
	china: { name: "China Standard", baseUrl: "https://open.bigmodel.cn/api/paas/v4", isChina: true },
} satisfies Record<ZaiApiLine, { name: string; baseUrl: string; isChina: boolean }>
