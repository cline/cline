import { addCustomInstructions } from "../sections/custom-instructions"
import { getCapabilitiesSection } from "../sections/capabilities"
import { DiffStrategy, DiffResult } from "../../diff/types"

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

describe("getCapabilitiesSection", () => {
	const cwd = "/test/path"
	const mcpHub = undefined
	const mockDiffStrategy: DiffStrategy = {
		getToolDescription: () => "edit_file tool description",
		applyDiff: async (originalContent: string, diffContent: string): Promise<DiffResult> => {
			return { success: true, content: "mock result" }
		},
	}

	test("includes edit_file in capabilities when diffStrategy is provided", () => {
		const result = getCapabilitiesSection(cwd, false, mcpHub, mockDiffStrategy)

		expect(result).toContain("or create_file")
		expect(result).toContain("then use the edit_file or create_file tool")
	})

	test("excludes edit_file from capabilities when diffStrategy is undefined", () => {
		const result = getCapabilitiesSection(cwd, false, mcpHub, undefined)

		expect(result).not.toContain("or edit_file")
		expect(result).toContain("then use the create_file tool")
		expect(result).not.toContain("create_file or edit_file")
	})
})
