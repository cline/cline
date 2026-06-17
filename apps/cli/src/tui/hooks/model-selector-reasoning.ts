import type { Config } from "../../utils/types";
import type { ThinkingLevel } from "../components/model-selector/model-selector";

export function resolveDefaultThinkingLevel(
	config: Pick<Config, "modelId" | "reasoningEffort" | "thinking">,
	selectedModelId: string,
): ThinkingLevel {
	if (config.reasoningEffort) {
		return config.reasoningEffort as ThinkingLevel;
	}

	if (selectedModelId === config.modelId && !config.thinking) {
		return "none";
	}

	return "medium";
}
