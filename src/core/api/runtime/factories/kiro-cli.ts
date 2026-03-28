import { KiroCliHandler } from "../../providers/kiro-cli"
import type { RuntimeHandlerFactoryDefinition } from "../runtime-handler-factories"

export const kiroCliRuntimeHandlerFactory: RuntimeHandlerFactoryDefinition = {
	runtimeId: "kiro-cli",
	buildHandler({ configuration, mode }) {
		return new KiroCliHandler({
			onRetryAttempt: configuration.onRetryAttempt,
			kiroCliPath: configuration.kiroCliPath,
			apiModelId: mode === "plan" ? configuration.planModeApiModelId : configuration.actModeApiModelId,
		})
	},
}
