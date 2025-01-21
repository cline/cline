import { addCustomInstructions } from "../sections/custom-instructions"

describe("addCustomInstructions", () => {
	test("adds preferred language to custom instructions", async () => {
		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/test/path",
			"test-mode",
			{ preferredLanguage: "French" },
		)

		expect(result).toContain("Language Preference:")
		expect(result).toContain("You should always speak and think in the French language")
	})

	test("works without preferred language", async () => {
		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/test/path",
			"test-mode",
		)

		expect(result).not.toContain("Language Preference:")
		expect(result).not.toContain("You should always speak and think in")
	})
})
