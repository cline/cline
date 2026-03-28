import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const ANTHROPIC_MODELS = getGeneratedModelsForProvider("anthropic");

function pickAnthropicModel(match: (id: string) => boolean): ModelInfo {
	const entry = Object.entries(ANTHROPIC_MODELS).find(([id]) => match(id));
	if (entry) {
		return entry[1];
	}
	return {
		id: "sonnet",
		name: "Claude Sonnet",
		capabilities: ["streaming", "reasoning"],
	};
}

function toClaudeCodeModel(id: "opus" | "sonnet" | "haiku"): ModelInfo {
	const source =
		id === "opus"
			? pickAnthropicModel((modelId) => modelId.includes("opus"))
			: id === "haiku"
				? pickAnthropicModel((modelId) => modelId.includes("haiku"))
				: pickAnthropicModel((modelId) => modelId.includes("sonnet"));
	return {
		...source,
		id,
		name: `Claude ${id.charAt(0).toUpperCase()}${id.slice(1)}`,
	};
}

export const CLAUDE_CODE_MODELS: Record<string, ModelInfo> = {
	opus: toClaudeCodeModel("opus"),
	sonnet: toClaudeCodeModel("sonnet"),
	haiku: toClaudeCodeModel("haiku"),
};

export const CLAUDE_CODE_DEFAULT_MODEL = "sonnet";

export const CLAUDE_CODE_PROVIDER: ModelCollection = {
	provider: {
		id: "claude-code",
		name: "Claude Code",
		description: "Use Claude Code SDK with Claude Pro/Max subscription",
		protocol: "openai-chat",
		baseUrl: "",
		defaultModelId: CLAUDE_CODE_DEFAULT_MODEL,
		capabilities: ["reasoning"],
	},
	models: CLAUDE_CODE_MODELS,
};
