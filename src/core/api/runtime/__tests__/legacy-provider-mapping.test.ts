import { describe, it } from "mocha"
import "should"
import type { RuntimeDefinition } from "../contracts.ts"
import {
	createLegacyRuntimeMapping,
	resolveLegacyProviderForRuntime,
	resolveRuntimeIdFromProvider,
} from "../legacy-provider-mapping.ts"
import { RuntimeRegistry } from "../registry.ts"

const runtime = (runtimeId: RuntimeDefinition["runtimeId"], legacyProvider: RuntimeDefinition["legacyProvider"]) =>
	({
		runtimeId,
		legacyProvider,
		displayName: `${runtimeId} runtime`,
		capabilities: {
			executionKind: runtimeId === "claude-code" ? "cli" : "api",
			supportsStreaming: true,
			supportsToolCalls: true,
		},
	}) satisfies RuntimeDefinition

describe("legacy-provider-mapping", () => {
	it("should resolve runtime ids from existing ApiProvider values", () => {
		const registry = new RuntimeRegistry([runtime("openrouter", "openrouter"), runtime("claude-code", "claude-code")])

		resolveRuntimeIdFromProvider("claude-code", registry).should.equal("claude-code")
		resolveLegacyProviderForRuntime("claude-code", registry).should.equal("claude-code")
	})

	it("should create a provider to runtime mapping for brownfield callers", () => {
		const definitions = [runtime("openrouter", "openrouter"), runtime("claude-code", "claude-code")]

		createLegacyRuntimeMapping(definitions).should.deepEqual({
			openrouter: "openrouter",
			"claude-code": "claude-code",
		})
	})

	it("should fail closed for future runtimes without a legacy provider mapping", () => {
		;(() => resolveLegacyProviderForRuntime("kiro-cli")).should.throw("does not have a legacy ApiProvider mapping")
	})
})
