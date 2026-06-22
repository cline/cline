import type { ApiProvider } from "@shared/api"
import { describe, expect, it } from "vitest"
import { convertApiConfigurationToProto, convertProtoToApiConfiguration } from "./api-configuration-conversion"

describe("api configuration provider conversion", () => {
	it("round-trips SDK provider ids added after the legacy enum list", () => {
		const providers: ApiProvider[] = ["poolside", "v0", "xiaomi", "zai-coding-plan"]

		for (const provider of providers) {
			const proto = convertApiConfigurationToProto({
				actModeApiProvider: provider,
				planModeApiProvider: provider,
			})

			expect(convertProtoToApiConfiguration(proto)).toMatchObject({
				actModeApiProvider: provider,
				planModeApiProvider: provider,
			})
		}
	})
})
