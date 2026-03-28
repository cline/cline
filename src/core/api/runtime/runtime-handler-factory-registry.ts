import { RuntimeHandlerFactoryRegistry } from "./runtime-handler-factories"
import { claudeCodeRuntimeHandlerFactory } from "./factories/claude-code"
import { kiroCliRuntimeHandlerFactory } from "./factories/kiro-cli"

let runtimeHandlerFactoryRegistry: RuntimeHandlerFactoryRegistry | undefined

export const getRuntimeHandlerFactoryRegistry = () => {
	if (!runtimeHandlerFactoryRegistry) {
		runtimeHandlerFactoryRegistry = new RuntimeHandlerFactoryRegistry([
			claudeCodeRuntimeHandlerFactory,
			kiroCliRuntimeHandlerFactory,
		])
	}

	return runtimeHandlerFactoryRegistry
}
