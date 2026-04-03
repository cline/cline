import { describe, expect, it } from "vitest"

describe("SDK Foundation", () => {
	it("can import @clinebot/core", async () => {
		const core = await import("@clinebot/core")
		expect(core).toBeDefined()
	})

	it("can import @clinebot/agents", async () => {
		const agents = await import("@clinebot/agents")
		expect(agents).toBeDefined()
	})

	it("can import @clinebot/llms", async () => {
		const llms = await import("@clinebot/llms")
		expect(llms).toBeDefined()
	})

	it("can import @clinebot/shared", async () => {
		const shared = await import("@clinebot/shared")
		expect(shared).toBeDefined()
	})

	it("can import SDK adapter index", async () => {
		const sdk = await import("@sdk/index")
		expect(sdk).toBeDefined()
	})
})
