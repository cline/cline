// npx vitest core/config/__tests__/CustomModesSettings.spec.ts

import { ZodError } from "zod"

import { type ModeConfig, customModesSettingsSchema } from "@roo-code/types"

describe("CustomModesSettings", () => {
	const validMode = {
		slug: "123e4567-e89b-12d3-a456-426614174000",
		name: "Test Mode",
		roleDefinition: "Test role definition",
		groups: ["read"] as const,
	} satisfies ModeConfig

	describe("schema validation", () => {
		it("accepts valid settings", () => {
			const validSettings = {
				customModes: [validMode],
			}

			expect(() => {
				customModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})

		it("accepts empty custom modes array", () => {
			const validSettings = {
				customModes: [],
			}

			expect(() => {
				customModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})

		it("accepts multiple custom modes", () => {
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
				customModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})

		it("rejects missing customModes field", () => {
			const invalidSettings = {} as any

			expect(() => {
				customModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
		})

		it("rejects invalid mode in array", () => {
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
				customModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
			expect(() => {
				customModesSettingsSchema.parse(invalidSettings)
			}).toThrow("Slug must contain only letters numbers and dashes")
		})

		it("rejects non-array customModes", () => {
			const invalidSettings = {
				customModes: "not an array",
			}

			expect(() => {
				customModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
		})

		it("rejects null or undefined", () => {
			expect(() => {
				customModesSettingsSchema.parse(null)
			}).toThrow(ZodError)

			expect(() => {
				customModesSettingsSchema.parse(undefined)
			}).toThrow(ZodError)
		})

		it("rejects duplicate mode slugs", () => {
			const duplicateSettings = {
				customModes: [
					validMode,
					{ ...validMode }, // Same slug
				],
			}

			expect(() => {
				customModesSettingsSchema.parse(duplicateSettings)
			}).toThrow("Duplicate mode slugs are not allowed")
		})

		it("rejects invalid group configurations in modes", () => {
			const invalidSettings = {
				customModes: [
					{
						...validMode,
						groups: ["invalid_group"] as any,
					},
				],
			}

			expect(() => {
				customModesSettingsSchema.parse(invalidSettings)
			}).toThrow(ZodError)
		})

		it("handles multiple groups", () => {
			const validSettings = {
				customModes: [
					{
						...validMode,
						groups: ["read", "edit", "browser"] as const,
					},
				],
			}

			expect(() => {
				customModesSettingsSchema.parse(validSettings)
			}).not.toThrow()
		})
	})

	describe("type inference", () => {
		it("inferred type includes all required fields", () => {
			const settings = {
				customModes: [validMode],
			}

			// TypeScript compilation will fail if the type is incorrect
			expect(settings.customModes[0].slug).toBeDefined()
			expect(settings.customModes[0].name).toBeDefined()
			expect(settings.customModes[0].roleDefinition).toBeDefined()
			expect(settings.customModes[0].groups).toBeDefined()
		})

		it("inferred type allows optional fields", () => {
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
