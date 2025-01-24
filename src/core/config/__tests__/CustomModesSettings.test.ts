import { CustomModesSettingsSchema } from "../CustomModesSchema"
import { ModeConfig } from "../../../shared/modes"
import { ZodError } from "zod"

describe("CustomModesSettings", () => {
	const validMode = {
		slug: "123e4567-e89b-12d3-a456-426614174000",
		name: "Test Mode",
		roleDefinition: "Test role definition",
		groups: ["read"] as const,
	} satisfies ModeConfig

	describe("schema validation", () => {
		test("accepts valid settings", () => {
			const validSettings = {
				customModes: [validMode],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})

		test("accepts empty custom modes array", () => {
			const validSettings = {
				customModes: [],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})

		test("accepts multiple custom modes", () => {
			const validSettings = {
				customModes: [
					validMode,
					{
						...validMode,
						slug: "987fcdeb-51a2-43e7-89ab-cdef01234567",
						name: "Another Mode",
					},
				],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})

		test("rejects missing customModes field", () => {
			const invalidSettings = {} as any

			expect(() => {
				CustomModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
		})

		test("rejects invalid mode in array", () => {
			const invalidSettings = {
				customModes: [
					validMode,
					{
						...validMode,
						slug: "not@a@valid@slug", // Invalid slug
					},
				],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
			expect(() => {
				CustomModesSettingsSchema.parse(invalidSettings)
			}).toThrow("Slug must contain only letters numbers and dashes")
		})

		test("rejects non-array customModes", () => {
			const invalidSettings = {
				customModes: "not an array",
			}

			expect(() => {
				CustomModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
		})

		test("rejects null or undefined", () => {
			expect(() => {
				CustomModesSettingsSchema.parse(null)
			}).toThrow(ZodError)

			expect(() => {
				CustomModesSettingsSchema.parse(undefined)
			}).toThrow(ZodError)
		})

		test("rejects duplicate mode slugs", () => {
			const duplicateSettings = {
				customModes: [
					validMode,
					{ ...validMode }, // Same slug
				],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(duplicateSettings)
			}).toThrow("Duplicate mode slugs are not allowed")
		})

		test("rejects invalid group configurations in modes", () => {
			const invalidSettings = {
				customModes: [
					{
						...validMode,
						groups: ["invalid_group"] as any,
					},
				],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
		})

		test("handles multiple groups", () => {
			const validSettings = {
				customModes: [
					{
						...validMode,
						groups: ["read", "edit", "browser"] as const,
					},
				],
			}

			expect(() => {
				CustomModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})
	})

	describe("type inference", () => {
		test("inferred type includes all required fields", () => {
			const settings = {
				customModes: [validMode],
			}

			// TypeScript compilation will fail if the type is incorrect
			expect(settings.customModes[0].slug).toBeDefined()
			expect(settings.customModes[0].name).toBeDefined()
			expect(settings.customModes[0].roleDefinition).toBeDefined()
			expect(settings.customModes[0].groups).toBeDefined()
		})

		test("inferred type allows optional fields", () => {
			const settings = {
				customModes: [
					{
						...validMode,
						customInstructions: "Optional instructions",
					},
				],
			}

			// TypeScript compilation will fail if the type is incorrect
			expect(settings.customModes[0].customInstructions).toBeDefined()
		})
	})
})
