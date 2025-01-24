import { CustomModeSchema } from "../CustomModesSchema"

describe("CustomModeSchema", () => {
	it("validates a basic mode configuration", () => {
		const validMode = {
			slug: "test-mode",
			name: "Test Mode",
			roleDefinition: "Test role definition",
			groups: ["read", "browser"],
		}

		expect(() => CustomModeSchema.parse(validMode)).not.toThrow()
	})

	it("validates a mode with file restrictions", () => {
		const modeWithFileRestrictions = {
			slug: "markdown-editor",
			name: "Markdown Editor",
			roleDefinition: "Markdown editing mode",
			groups: ["read", ["edit", { fileRegex: "\\.md$" }], "browser"],
		}

		expect(() => CustomModeSchema.parse(modeWithFileRestrictions)).not.toThrow()
	})

	it("validates file regex patterns", () => {
		const validPatterns = ["\\.md$", ".*\\.txt$", "[a-z]+\\.js$"]
		const invalidPatterns = ["[", "(unclosed", "\\"]

		validPatterns.forEach((pattern) => {
			const mode = {
				slug: "test",
				name: "Test",
				roleDefinition: "Test",
				groups: ["read", ["edit", { fileRegex: pattern }]],
			}
			expect(() => CustomModeSchema.parse(mode)).not.toThrow()
		})

		invalidPatterns.forEach((pattern) => {
			const mode = {
				slug: "test",
				name: "Test",
				roleDefinition: "Test",
				groups: ["read", ["edit", { fileRegex: pattern }]],
			}
			expect(() => CustomModeSchema.parse(mode)).toThrow()
		})
	})

	it("prevents duplicate groups", () => {
		const modeWithDuplicates = {
			slug: "test",
			name: "Test",
			roleDefinition: "Test",
			groups: ["read", "read", ["edit", { fileRegex: "\\.md$" }], ["edit", { fileRegex: "\\.txt$" }]],
		}

		expect(() => CustomModeSchema.parse(modeWithDuplicates)).toThrow(/Duplicate groups/)
	})

	it("requires at least one group", () => {
		const modeWithNoGroups = {
			slug: "test",
			name: "Test",
			roleDefinition: "Test",
			groups: [],
		}

		expect(() => CustomModeSchema.parse(modeWithNoGroups)).toThrow(/At least one tool group is required/)
	})
})
