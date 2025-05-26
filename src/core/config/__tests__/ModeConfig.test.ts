// npx jest src/core/config/__tests__/ModeConfig.test.ts

import { ZodError } from "zod"

import { type ModeConfig, modeConfigSchema } from "@roo-code/types"

function validateCustomMode(mode: unknown): asserts mode is ModeConfig {
	modeConfigSchema.parse(mode)
}

describe("CustomModeSchema", () => {
	describe("validateCustomMode", () => {
		test("accepts valid mode configuration", () => {
			const validMode = {
				slug: "test",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				groups: ["read"] as const,
			} satisfies ModeConfig

			expect(() => validateCustomMode(validMode)).not.toThrow()
		})

		test("accepts mode with multiple groups", () => {
			const validMode = {
				slug: "test",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				groups: ["read", "edit", "browser"] as const,
			} satisfies ModeConfig

			expect(() => validateCustomMode(validMode)).not.toThrow()
		})

		test("accepts mode with optional customInstructions", () => {
			const validMode = {
				slug: "test",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				customInstructions: "Custom instructions",
				groups: ["read"] as const,
			} satisfies ModeConfig

			expect(() => validateCustomMode(validMode)).not.toThrow()
		})

		test("rejects missing required fields", () => {
			const invalidModes = [
				{}, // All fields missing
				{ name: "Test" }, // Missing most fields
				{
					name: "Test",
					roleDefinition: "Role",
				}, // Missing slug and groups
			]

			invalidModes.forEach((invalidMode) => {
				expect(() => validateCustomMode(invalidMode)).toThrow(ZodError)
			})
		})

		test("rejects invalid slug format", () => {
			const invalidMode = {
				slug: "not@a@valid@slug",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				groups: ["read"] as const,
			} satisfies Omit<ModeConfig, "slug"> & { slug: string }

			expect(() => validateCustomMode(invalidMode)).toThrow(ZodError)
			expect(() => validateCustomMode(invalidMode)).toThrow("Slug must contain only letters numbers and dashes")
		})

		test("rejects empty strings in required fields", () => {
			const emptyNameMode = {
				slug: "123e4567-e89b-12d3-a456-426614174000",
				name: "",
				roleDefinition: "Test role definition",
				groups: ["read"] as const,
			} satisfies ModeConfig

			const emptyRoleMode = {
				slug: "123e4567-e89b-12d3-a456-426614174000",
				name: "Test Mode",
				roleDefinition: "",
				groups: ["read"] as const,
			} satisfies ModeConfig

			expect(() => validateCustomMode(emptyNameMode)).toThrow("Name is required")
			expect(() => validateCustomMode(emptyRoleMode)).toThrow("Role definition is required")
		})

		test("rejects invalid group configurations", () => {
			const invalidGroupMode = {
				slug: "123e4567-e89b-12d3-a456-426614174000",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				groups: ["not-a-valid-group"] as any,
			}

			expect(() => validateCustomMode(invalidGroupMode)).toThrow(ZodError)
		})

		test("handles null and undefined gracefully", () => {
			expect(() => validateCustomMode(null)).toThrow(ZodError)
			expect(() => validateCustomMode(undefined)).toThrow(ZodError)
		})

		test("rejects non-object inputs", () => {
			const invalidInputs = [42, "string", true, [], () => {}]

			invalidInputs.forEach((input) => {
				expect(() => validateCustomMode(input)).toThrow(ZodError)
			})
		})
	})

	describe("fileRegex", () => {
		it("validates a mode with file restrictions and descriptions", () => {
			const modeWithJustRegex = {
				slug: "markdown-editor",
				name: "Markdown Editor",
				roleDefinition: "Markdown editing mode",
				groups: ["read", ["edit", { fileRegex: "\\.md$" }], "browser"],
			}

			const modeWithDescription = {
				slug: "docs-editor",
				name: "Documentation Editor",
				roleDefinition: "Documentation editing mode",
				groups: [
					"read",
					["edit", { fileRegex: "\\.(md|txt)$", description: "Documentation files only" }],
					"browser",
				],
			}

			expect(() => modeConfigSchema.parse(modeWithJustRegex)).not.toThrow()
			expect(() => modeConfigSchema.parse(modeWithDescription)).not.toThrow()
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
				expect(() => modeConfigSchema.parse(mode)).not.toThrow()
			})

			invalidPatterns.forEach((pattern) => {
				const mode = {
					slug: "test",
					name: "Test",
					roleDefinition: "Test",
					groups: ["read", ["edit", { fileRegex: pattern }]],
				}
				expect(() => modeConfigSchema.parse(mode)).toThrow()
			})
		})

		it("prevents duplicate groups", () => {
			const modeWithDuplicates = {
				slug: "test",
				name: "Test",
				roleDefinition: "Test",
				groups: ["read", "read", ["edit", { fileRegex: "\\.md$" }], ["edit", { fileRegex: "\\.txt$" }]],
			}

			expect(() => modeConfigSchema.parse(modeWithDuplicates)).toThrow(/Duplicate groups/)
		})
	})

	const validBaseMode = {
		slug: "123e4567-e89b-12d3-a456-426614174000",
		name: "Test Mode",
		roleDefinition: "Test role definition",
	}

	describe("group format validation", () => {
		test("accepts single group", () => {
			const mode = {
				...validBaseMode,
				groups: ["read"] as const,
			} satisfies ModeConfig

			expect(() => modeConfigSchema.parse(mode)).not.toThrow()
		})

		test("accepts multiple groups", () => {
			const mode = {
				...validBaseMode,
				groups: ["read", "edit", "browser"] as const,
			} satisfies ModeConfig

			expect(() => modeConfigSchema.parse(mode)).not.toThrow()
		})

		test("accepts all available groups", () => {
			const mode = {
				...validBaseMode,
				groups: ["read", "edit", "browser", "command", "mcp"] as const,
			} satisfies ModeConfig

			expect(() => modeConfigSchema.parse(mode)).not.toThrow()
		})

		test("rejects non-array group format", () => {
			const mode = {
				...validBaseMode,
				groups: "not-an-array" as any,
			}

			expect(() => modeConfigSchema.parse(mode)).toThrow()
		})

		test("rejects invalid group names", () => {
			const mode = {
				...validBaseMode,
				groups: ["invalid_group"] as any,
			}

			expect(() => modeConfigSchema.parse(mode)).toThrow()
		})

		test("rejects duplicate groups", () => {
			const mode = {
				...validBaseMode,
				groups: ["read", "read"] as any,
			}

			expect(() => modeConfigSchema.parse(mode)).toThrow("Duplicate groups are not allowed")
		})

		test("rejects null or undefined groups", () => {
			const modeWithNull = {
				...validBaseMode,
				groups: null as any,
			}

			const modeWithUndefined = {
				...validBaseMode,
				groups: undefined as any,
			}

			expect(() => modeConfigSchema.parse(modeWithNull)).toThrow()
			expect(() => modeConfigSchema.parse(modeWithUndefined)).toThrow()
		})
	})
})
