import type { ApiProvider } from "@shared/api"
import { describe, expect, it } from "vitest"
import { convertApiConfigurationToProto, convertProtoToApiConfiguration } from "./api-configuration-conversion"

describe("api configuration provider conversion", () => {
	it("round-trips SDK provider ids added after the legacy enum list", () => {
		const providers: ApiProvider[] = ["poolside", "v0", "xiaomi", "zai-coding-plan", "atomic-chat"]

		for (const provider of providers) {
			const proto = convertApiConfigurationToProto({
				actModeApiProvider: provider,
				planModeApiProvider: provider,
			})

			// Assert field-by-field instead of toMatchObject: this file is also picked up by
			// the mocha integration runner (.vscode-test.mjs globs src/shared/**/*.test.js),
			// where vitest's jest-compat matchers like toMatchObject are not available.
			const result = convertProtoToApiConfiguration(proto)
			expect(result.actModeApiProvider).toBe(provider)
			expect(result.planModeApiProvider).toBe(provider)
		}
	})
})
