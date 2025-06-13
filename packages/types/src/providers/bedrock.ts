import type { ModelInfo } from "../model.js"

// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html

export type BedrockModelId = keyof typeof bedrockModels

export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-sonnet-4-20250514-v1:0"

export const bedrockDefaultPromptRouterModelId: BedrockModelId = "anthropic.claude-3-sonnet-20240229-v1:0"

// March, 12 2025 - updated prices to match US-West-2 list price shown at
// https://aws.amazon.com/bedrock/pricing, including older models that are part
// of the default prompt routers AWS enabled for GA of the promot router
// feature.
export const bedrockModels = {
	"amazon.nova-pro-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: true,
		inputPrice: 0.8,
		outputPrice: 3.2,
		cacheWritesPrice: 0.8, // per million tokens
		cacheReadsPrice: 0.2, // per million tokens
		minTokensPerCachePoint: 1,
		maxCachePoints: 1,
		cachableFields: ["system"],
	},
	"amazon.nova-pro-latency-optimized-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 4.0,
		cacheWritesPrice: 1.0, // per million tokens
		cacheReadsPrice: 0.25, // per million tokens
		description: "Amazon Nova Pro with latency optimized inference",
	},
	"amazon.nova-lite-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: true,
		inputPrice: 0.06,
		outputPrice: 0.24,
		cacheWritesPrice: 0.06, // per million tokens
		cacheReadsPrice: 0.015, // per million tokens
		minTokensPerCachePoint: 1,
		maxCachePoints: 1,
		cachableFields: ["system"],
	},
	"amazon.nova-micro-v1:0": {
		maxTokens: 5000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: true,
		inputPrice: 0.035,
		outputPrice: 0.14,
		cacheWritesPrice: 0.035, // per million tokens
		cacheReadsPrice: 0.00875, // per million tokens
		minTokensPerCachePoint: 1,
		maxCachePoints: 1,
		cachableFields: ["system"],
	},
	"anthropic.claude-sonnet-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		supportsReasoningBudget: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-opus-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		supportsReasoningBudget: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-7-sonnet-20250219-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		supportsReasoningBudget: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-5-sonnet-20241022-v2:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-5-haiku-20241022-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.8,
		outputPrice: 4.0,
		cacheWritesPrice: 1.0,
		cacheReadsPrice: 0.08,
		minTokensPerCachePoint: 2048,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-5-sonnet-20240620-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-opus-20240229-v1:0": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15.0,
		outputPrice: 75.0,
	},
	"anthropic.claude-3-sonnet-20240229-v1:0": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-haiku-20240307-v1:0": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
	"anthropic.claude-2-1-v1:0": {
		maxTokens: 4096,
		contextWindow: 100_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 8.0,
		outputPrice: 24.0,
		description: "Claude 2.1",
	},
	"anthropic.claude-2-0-v1:0": {
		maxTokens: 4096,
		contextWindow: 100_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 8.0,
		outputPrice: 24.0,
		description: "Claude 2.0",
	},
	"anthropic.claude-instant-v1:0": {
		maxTokens: 4096,
		contextWindow: 100_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2.4,
		description: "Claude Instant",
	},
	"deepseek.r1-v1:0": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.35,
		outputPrice: 5.4,
	},
	"meta.llama3-3-70b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
		description: "Llama 3.3 Instruct (70B)",
	},
	"meta.llama3-2-90b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
		description: "Llama 3.2 Instruct (90B)",
	},
	"meta.llama3-2-11b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.16,
		outputPrice: 0.16,
		description: "Llama 3.2 Instruct (11B)",
	},
	"meta.llama3-2-3b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
		description: "Llama 3.2 Instruct (3B)",
	},
	"meta.llama3-2-1b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
		description: "Llama 3.2 Instruct (1B)",
	},
	"meta.llama3-1-405b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 2.4,
		description: "Llama 3.1 Instruct (405B)",
	},
	"meta.llama3-1-70b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
		description: "Llama 3.1 Instruct (70B)",
	},
	"meta.llama3-1-70b-instruct-latency-optimized-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
		description: "Llama 3.1 Instruct (70B) (w/ latency optimized inference)",
	},
	"meta.llama3-1-8b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.22,
		description: "Llama 3.1 Instruct (8B)",
	},
	"meta.llama3-70b-instruct-v1:0": {
		maxTokens: 2048,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 2.65,
		outputPrice: 3.5,
	},
	"meta.llama3-8b-instruct-v1:0": {
		maxTokens: 2048,
		contextWindow: 4_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.6,
	},
	"amazon.titan-text-lite-v1:0": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.2,
		description: "Amazon Titan Text Lite",
	},
	"amazon.titan-text-express-v1:0": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
		description: "Amazon Titan Text Express",
	},
	"amazon.titan-text-embeddings-v1:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		description: "Amazon Titan Text Embeddings",
	},
	"amazon.titan-text-embeddings-v2:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.02,
		description: "Amazon Titan Text Embeddings V2",
	},
} as const satisfies Record<string, ModelInfo>

export const BEDROCK_DEFAULT_TEMPERATURE = 0.3

export const BEDROCK_MAX_TOKENS = 4096

export const BEDROCK_DEFAULT_CONTEXT = 128_000

export const BEDROCK_REGION_INFO: Record<
	string,
	{
		regionId: string
		description: string
		pattern?: string
		multiRegion?: boolean
	}
> = {
	/*
	 * This JSON generated by AWS's AI assistant - Amazon Q on March 29, 2025
	 *
	 *  - Africa (Cape Town) region does not appear to support Amazon Bedrock at this time.
	 *  - Some Asia Pacific regions, such as Asia Pacific (Hong Kong) and Asia Pacific (Jakarta), are not listed among the supported regions for Bedrock services.
	 *  - Middle East regions, including Middle East (Bahrain) and Middle East (UAE), are not mentioned in the list of supported regions for Bedrock. [3]
	 *  - China regions (Beijing and Ningxia) are not listed as supported for Amazon Bedrock.
	 *  - Some newer or specialized AWS regions may not have Bedrock support yet.
	 */
	"us.": { regionId: "us-east-1", description: "US East (N. Virginia)", pattern: "us-", multiRegion: true },
	"use.": { regionId: "us-east-1", description: "US East (N. Virginia)" },
	"use1.": { regionId: "us-east-1", description: "US East (N. Virginia)" },
	"use2.": { regionId: "us-east-2", description: "US East (Ohio)" },
	"usw.": { regionId: "us-west-2", description: "US West (Oregon)" },
	"usw2.": { regionId: "us-west-2", description: "US West (Oregon)" },
	"ug.": {
		regionId: "us-gov-west-1",
		description: "AWS GovCloud (US-West)",
		pattern: "us-gov-",
		multiRegion: true,
	},
	"uge1.": { regionId: "us-gov-east-1", description: "AWS GovCloud (US-East)" },
	"ugw1.": { regionId: "us-gov-west-1", description: "AWS GovCloud (US-West)" },
	"eu.": { regionId: "eu-west-1", description: "Europe (Ireland)", pattern: "eu-", multiRegion: true },
	"euw1.": { regionId: "eu-west-1", description: "Europe (Ireland)" },
	"euw2.": { regionId: "eu-west-2", description: "Europe (London)" },
	"euw3.": { regionId: "eu-west-3", description: "Europe (Paris)" },
	"euc1.": { regionId: "eu-central-1", description: "Europe (Frankfurt)" },
	"euc2.": { regionId: "eu-central-2", description: "Europe (Zurich)" },
	"eun1.": { regionId: "eu-north-1", description: "Europe (Stockholm)" },
	"eus1.": { regionId: "eu-south-1", description: "Europe (Milan)" },
	"eus2.": { regionId: "eu-south-2", description: "Europe (Spain)" },
	"ap.": {
		regionId: "ap-southeast-1",
		description: "Asia Pacific (Singapore)",
		pattern: "ap-",
		multiRegion: true,
	},
	"ape1.": { regionId: "ap-east-1", description: "Asia Pacific (Hong Kong)" },
	"apne1.": { regionId: "ap-northeast-1", description: "Asia Pacific (Tokyo)" },
	"apne2.": { regionId: "ap-northeast-2", description: "Asia Pacific (Seoul)" },
	"apne3.": { regionId: "ap-northeast-3", description: "Asia Pacific (Osaka)" },
	"aps1.": { regionId: "ap-south-1", description: "Asia Pacific (Mumbai)" },
	"aps2.": { regionId: "ap-south-2", description: "Asia Pacific (Hyderabad)" },
	"apse1.": { regionId: "ap-southeast-1", description: "Asia Pacific (Singapore)" },
	"apse2.": { regionId: "ap-southeast-2", description: "Asia Pacific (Sydney)" },
	"ca.": { regionId: "ca-central-1", description: "Canada (Central)", pattern: "ca-", multiRegion: true },
	"cac1.": { regionId: "ca-central-1", description: "Canada (Central)" },
	"sa.": { regionId: "sa-east-1", description: "South America (São Paulo)", pattern: "sa-", multiRegion: true },
	"sae1.": { regionId: "sa-east-1", description: "South America (São Paulo)" },

	// These are not official - they weren't generated by Amazon Q nor were
	// found in the AWS documentation but another Roo contributor found apac.
	// Was needed so I've added the pattern of the other geo zones.
	"apac.": { regionId: "ap-southeast-1", description: "Default APAC region", pattern: "ap-", multiRegion: true },
	"emea.": { regionId: "eu-west-1", description: "Default EMEA region", pattern: "eu-", multiRegion: true },
	"amer.": { regionId: "us-east-1", description: "Default Americas region", pattern: "us-", multiRegion: true },
}

export const BEDROCK_REGIONS = Object.values(BEDROCK_REGION_INFO)
	// Extract all region IDs
	.map((info) => ({ value: info.regionId, label: info.regionId }))
	// Filter to unique region IDs (remove duplicates)
	.filter((region, index, self) => index === self.findIndex((r) => r.value === region.value))
	// Sort alphabetically by region ID
	.sort((a, b) => a.value.localeCompare(b.value))
