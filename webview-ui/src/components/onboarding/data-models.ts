import { NEW_USER_TYPE } from "./data-steps"

type ModelOption = {
	id: string
	title: string
	description: string
	badge: string
	capabilities: string[]
	overview: string
	speed: string
	context: number
}

type ModelGroup = {
	group: string
	models: ModelOption[]
}

export const ONBOARDING_MODEL_SELECTIONS: Record<"free" | "power", ModelGroup[]> = {
	[NEW_USER_TYPE.FREE]: [
		{
			group: "free",
			models: [
				{
					id: "x-ai/grok-code-fast-1",
					title: "xAI: Grok Code Fast 1",
					description: "Leading model for agentic code",
					badge: "Best",
					capabilities: ["Images", "Browser", "Prompt Caching"],
					overview: "97% (Top Performer)",
					speed: "Ultra Fast",
					context: 256000,
				},
				{
					id: "cline/code-supernova-1m",
					title: "Code Supernova 1 million",
					description: "Large 1M context window, great value",
					badge: "Trending",
					capabilities: ["Tool Calling", "Prompt Caching"],
					overview: "97% (Top Performer)",
					speed: "Fast",
					context: 1000000,
				},
			],
		},
	],
	[NEW_USER_TYPE.POWER]: [
		{
			group: "frontier",
			models: [
				{
					id: "claude-sonnet-4-5-20250929",
					title: "Anthropic: Claude Sonnet 4.5",
					description: "Leading model for agentic coding",
					badge: "Best",
					capabilities: ["Images", "Tool Calling", "Prompt Caching"],
					overview: "90%",
					speed: "Fast",
					context: 256000,
				},
			],
		},
		{
			group: "open source",
			models: [
				{
					id: "z-ai/glm-4.6:exacto",
					title: "Z.AI: GLM 4.6",
					description: "Leading model for agentic code",
					badge: "Trending",
					capabilities: ["Images", "Tool Calling", "Prompt Caching"],
					overview: "90%",
					speed: "Average",
					context: 256000,
				},
				{
					id: "moonshotai/kimi-dev-72b",
					title: "Moonshot AI: Kimi Dev 72B",
					description: "Leading model for agentic coding",
					badge: "Value",
					capabilities: ["Tool Calling", "Prompt Caching"],
					overview: "70%",
					speed: "Fast",
					context: 256000,
				},
			],
		},
	],
}
