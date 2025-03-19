import { addCustomInstructions } from "../sections/custom-instructions"
import { getCapabilitiesSection } from "../sections/capabilities"
import { DiffStrategy, DiffResult } from "../../diff/types"

describe("addCustomInstructions", () => {
	test("adds vscode language to custom instructions", async () => {
		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/test/path",
			"test-mode",
			{ language: "fr" },
		)

		expect(result).toContain("Language Preference:")
		expect(result).toContain('You should always speak and think in the "Français" (fr) language')
	})

	test("works without vscode language", async () => {
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
		getName: () => "MockStrategy",
		getToolDescription: () => "apply_diff tool description",
		applyDiff: async (originalContent: string, diffContent: string): Promise<DiffResult> => {
			return { success: true, content: "mock result" }
		},
	}

	test("includes apply_diff in capabilities when diffStrategy is provided", () => {
		const result = getCapabilitiesSection(cwd, false, mcpHub, mockDiffStrategy)

		expect(result).toContain("apply_diff or")
		expect(result).toContain("then use the apply_diff or write_to_file tool")
	})

	test("excludes apply_diff from capabilities when diffStrategy is undefined", () => {
		const result = getCapabilitiesSection(cwd, false, mcpHub, undefined)

		expect(result).not.toContain("apply_diff or")
		expect(result).toContain("then use the write_to_file tool")
		expect(result).not.toContain("apply_diff or write_to_file")
	})
})
