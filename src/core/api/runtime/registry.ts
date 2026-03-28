import { type ApiProvider, DEFAULT_RUNTIME_ID, type RuntimeId, getRuntimeIdForProvider } from "@shared/api"
import type { RuntimeCapabilities, RuntimeDefinition } from "./contracts"

function validateCapabilities(capabilities: RuntimeCapabilities, runtimeId: RuntimeId) {
	if (!capabilities.executionKind) {
		throw new Error(`Runtime ${runtimeId} is missing an execution kind`)
	}

	if (typeof capabilities.supportsStreaming !== "boolean") {
		throw new Error(`Runtime ${runtimeId} must declare supportsStreaming explicitly`)
	}

	if (typeof capabilities.supportsToolCalls !== "boolean") {
		throw new Error(`Runtime ${runtimeId} must declare supportsToolCalls explicitly`)
	}
}

function validateDefinition(definition: RuntimeDefinition) {
	if (!definition.runtimeId) {
		throw new Error("Runtime definition is missing runtimeId")
	}

	if (!definition.legacyProvider) {
		throw new Error(`Runtime ${definition.runtimeId} is missing legacyProvider`)
	}

	if (!definition.displayName?.trim()) {
		throw new Error(`Runtime ${definition.runtimeId} is missing displayName`)
	}

	validateCapabilities(definition.capabilities, definition.runtimeId)
}

export class RuntimeRegistry {
	private readonly definitionsByRuntimeId = new Map<RuntimeId, RuntimeDefinition>()
	private readonly definitionsByProvider = new Map<ApiProvider, RuntimeDefinition>()

	constructor(definitions: RuntimeDefinition[] = []) {
		for (const definition of definitions) {
			this.register(definition)
		}
	}

	register(definition: RuntimeDefinition): this {
		validateDefinition(definition)

		if (this.definitionsByRuntimeId.has(definition.runtimeId)) {
			throw new Error(`Runtime ${definition.runtimeId} is already registered`)
		}

		if (this.definitionsByProvider.has(definition.legacyProvider)) {
			throw new Error(`Legacy provider ${definition.legacyProvider} is already registered`)
		}

		this.definitionsByRuntimeId.set(definition.runtimeId, definition)
		this.definitionsByProvider.set(definition.legacyProvider, definition)

		return this
	}

	getRuntime(runtimeId: RuntimeId = DEFAULT_RUNTIME_ID): RuntimeDefinition {
		const definition = this.definitionsByRuntimeId.get(runtimeId)
		if (!definition) {
			throw new Error(`Runtime ${runtimeId} is not registered`)
		}

		return definition
	}

	resolveProvider(provider?: ApiProvider): RuntimeDefinition {
		const runtimeId = getRuntimeIdForProvider(provider)
		return this.getRuntime(runtimeId)
	}

	getByProvider(provider: ApiProvider): RuntimeDefinition | undefined {
		return this.definitionsByProvider.get(provider)
	}

	list(): RuntimeDefinition[] {
		return Array.from(this.definitionsByRuntimeId.values())
	}
}
