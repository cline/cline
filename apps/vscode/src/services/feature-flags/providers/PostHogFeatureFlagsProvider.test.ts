import { describe, expect, it, mock } from "bun:test"

mock.module("@/services/logging/distinctId", () => ({
	getDistinctId: () => "newer-global-identity",
}))

describe("PostHogFeatureFlagsProvider", () => {
	it("uses the identity captured by the poll", async () => {
		const getAllFlagsAndPayloads = mock(async () => ({}))
		const { PostHogFeatureFlagsProvider } = await import("./PostHogFeatureFlagsProvider")
		const provider = new PostHogFeatureFlagsProvider({ getAllFlagsAndPayloads } as never)

		await provider.getAllFlagsAndPayloads({
			distinctId: "polled-account",
			flagKeys: ["ext-cloud-sessions"],
		})

		expect(getAllFlagsAndPayloads).toHaveBeenCalledWith("polled-account", {
			flagKeys: ["ext-cloud-sessions"],
		})
	})
})
