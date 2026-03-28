import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { RuntimeId } from "@shared/api"
import type { ApiHandler } from ".."

export interface RuntimeHandlerFactoryInput {
	configuration: ApiConfiguration
	mode: Mode
}

export interface RuntimeHandlerFactoryDefinition {
	runtimeId: RuntimeId
	buildHandler(input: RuntimeHandlerFactoryInput): ApiHandler
}

export class RuntimeHandlerFactoryRegistry {
	private readonly factories = new Map<RuntimeId, RuntimeHandlerFactoryDefinition>()

	constructor(definitions: RuntimeHandlerFactoryDefinition[] = []) {
		for (const definition of definitions) {
			this.register(definition)
		}
	}

	register(definition: RuntimeHandlerFactoryDefinition): this {
		if (this.factories.has(definition.runtimeId)) {
			throw new Error(`Runtime handler factory ${definition.runtimeId} is already registered`)
		}

		this.factories.set(definition.runtimeId, definition)
		return this
	}

	get(runtimeId: RuntimeId): RuntimeHandlerFactoryDefinition | undefined {
		return this.factories.get(runtimeId)
	}

	list(): RuntimeHandlerFactoryDefinition[] {
		return Array.from(this.factories.values())
	}
}
