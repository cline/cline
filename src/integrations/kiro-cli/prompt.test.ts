import { expect } from "chai"
import { describe, it } from "mocha"
import { buildKiroCliPrompt } from "./prompt"

describe("buildKiroCliPrompt", () => {
	it("flattens system prompt and transcript into a single Kiro CLI input", () => {
		const prompt = buildKiroCliPrompt("system", [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "world" },
		] as any)

		expect(prompt).to.include("System instructions:")
		expect(prompt).to.include("USER:\nhello")
		expect(prompt).to.include("ASSISTANT:\nworld")
	})
})
