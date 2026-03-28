import type { RuntimeHandlerFactoryDefinition } from "../runtime-handler-factories"
import { ClaudeCodeHandler } from "../../providers/claude-code"

export const claudeCodeRuntimeHandlerFactory: RuntimeHandlerFactoryDefinition = {
	runtimeId: "claude-code",
	buildHandler({ configuration, mode }) {
		return new ClaudeCodeHandler({
			onRetryAttempt: configuration.onRetryAttempt,
			claudeCodePath: configuration.claudeCodePath,
			apiModelId: mode === "plan" ? configuration.planModeApiModelId : configuration.actModeApiModelId,
			thinkingBudgetTokens:
				mode === "plan" ? configuration.planModeThinkingBudgetTokens : configuration.actModeThinkingBudgetTokens,
		})
	},
}
