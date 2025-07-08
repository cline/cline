import { describe, it, expect } from "vitest"
import { getPromptComponent } from "../system"
import type { CustomModePrompts } from "@roo-code/types"

describe("getPromptComponent", () => {
	it("should return undefined for empty objects", () => {
		const customModePrompts: CustomModePrompts = {
			architect: {},
		}

		const result = getPromptComponent(customModePrompts, "architect")
		expect(result).toBeUndefined()
	})

	it("should return the component for objects with any properties", () => {
		const customModePrompts: CustomModePrompts = {
			architect: {
				foo: "bar",
				baz: 123,
			} as any,
		}

		const result = getPromptComponent(customModePrompts, "architect")
		expect(result).toEqual({ foo: "bar", baz: 123 })
	})

	it("should return undefined for missing mode", () => {
		const customModePrompts: CustomModePrompts = {}

		const result = getPromptComponent(customModePrompts, "architect")
		expect(result).toBeUndefined()
	})

	it("should return undefined when customModePrompts is undefined", () => {
		const result = getPromptComponent(undefined, "architect")
		expect(result).toBeUndefined()
	})

	it.each([
		["roleDefinition", { roleDefinition: "Test role" }],
		["customInstructions", { customInstructions: "Test instructions" }],
		["whenToUse", { whenToUse: "Test when to use" }],
		["description", { description: "Test description" }],
	])("should return the component when it has %s", (property, component) => {
		const customModePrompts: CustomModePrompts = {
			architect: component,
		}

		const result = getPromptComponent(customModePrompts, "architect")
		expect(result).toEqual(component)
	})

	it("should return the component when it has multiple properties", () => {
		const customModePrompts: CustomModePrompts = {
			architect: {
				roleDefinition: "Test role",
				customInstructions: "Test instructions",
				whenToUse: "Test when to use",
				description: "Test description",
			},
		}

		const result = getPromptComponent(customModePrompts, "architect")
		expect(result).toEqual({
			roleDefinition: "Test role",
			customInstructions: "Test instructions",
			whenToUse: "Test when to use",
			description: "Test description",
		})
	})

	it("should return the component when it has both relevant and irrelevant properties", () => {
		const customModePrompts: CustomModePrompts = {
			architect: {
				roleDefinition: "Test role",
				foo: "bar",
				baz: 123,
			} as any,
		}

		const result = getPromptComponent(customModePrompts, "architect")
		expect(result).toEqual({
			roleDefinition: "Test role",
			foo: "bar",
			baz: 123,
		})
	})
})
