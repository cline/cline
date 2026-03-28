import { describe, it } from "mocha"
import "should"
import type { RuntimeDefinition } from "../contracts.ts"
import { RuntimeRegistry } from "../registry.ts"

const apiRuntime = (runtimeId: RuntimeDefinition["runtimeId"], legacyProvider: RuntimeDefinition["legacyProvider"]) =>
	({
		runtimeId,
		legacyProvider,
		displayName: `${runtimeId} runtime`,
		capabilities: {
			executionKind: "api",
			supportsStreaming: true,
			supportsToolCalls: true,
		},
	}) satisfies RuntimeDefinition

describe("RuntimeRegistry", () => {
	it("should resolve a registered provider through its canonical runtime id", () => {
		const registry = new RuntimeRegistry([apiRuntime("openrouter", "openrouter"), apiRuntime("claude-code", "claude-code")])

		const definition = registry.resolveProvider("claude-code")

		definition.runtimeId.should.equal("claude-code")
		definition.legacyProvider.should.equal("claude-code")
	})

	it("should reject duplicate runtime registrations", () => {
		;(() => {
			new RuntimeRegistry([apiRuntime("openrouter", "openrouter"), apiRuntime("openrouter", "anthropic")])
		}).should.throw("already registered")
	})

	it("should reject missing explicit capability declarations", () => {
		;(() => {
			new RuntimeRegistry([
				{
					runtimeId: "openrouter",
					legacyProvider: "openrouter",
					displayName: "OpenRouter",
					capabilities: {
						executionKind: "api",
						supportsToolCalls: true,
					},
				} as RuntimeDefinition,
			])
		}).should.throw("supportsStreaming")
	})
})
