type ModelOption = {
	title: string
	description: string
	badge: string
	capabilities: string[]
}

type ModelGroup = {
	group: string
	models: ModelOption[]
}

export const ONBOARDING_MODEL_SELECTIONS: Record<"free" | "power", ModelGroup[]> = {
	free: [
		{
			group: "free",
			models: [
				{
					title: "xAI: Grok Code Fast 1",
					description: "Leading model for agentic code",
					badge: "Best",
					capabilities: ["Images", "Tool Calling", "Prompt Caching"],
				},
				{
					title: "Code Supernova 1 million",
					description: "Large 1M context window, great value",
					badge: "Trending",
					capabilities: ["Tool Calling", "Prompt Caching"],
				},
			],
		},
	],
	power: [
		{
			group: "frontier",
			models: [
				{
					title: "Anthropic: Claude Sonnet 4.5",
					description: "Leading model for agentic coding",
					badge: "Best",
					capabilities: ["Images", "Tool Calling", "Prompt Caching"],
				},
			],
		},
		{
			group: "open source",
			models: [
				{
					title: "Z.AI: GLM 4.6",
					description: "Leading model for agentic code",
					badge: "Trending",
					capabilities: ["Images", "Tool Calling", "Prompt Caching"],
				},
				{
					title: "Moonshot AI: Kimi Dev 72B",
					description: "Leading model for agentic coding",
					badge: "Value",
					capabilities: ["Tool Calling", "Prompt Caching"],
				},
			],
		},
	],
}
