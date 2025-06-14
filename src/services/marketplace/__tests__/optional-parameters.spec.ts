import { describe, it, expect } from "vitest"
import { mcpParameterSchema } from "@roo-code/types"
import type { McpParameter } from "@roo-code/types"

describe("Optional Parameters", () => {
	describe("McpParameter Schema", () => {
		it("should validate parameter with optional field set to true", () => {
			const param = {
				name: "Test Parameter",
				key: "test_key",
				placeholder: "Enter value",
				optional: true,
			}

			const result = mcpParameterSchema.parse(param)
			expect(result.optional).toBe(true)
		})

		it("should validate parameter with optional field set to false", () => {
			const param = {
				name: "Test Parameter",
				key: "test_key",
				placeholder: "Enter value",
				optional: false,
			}

			const result = mcpParameterSchema.parse(param)
			expect(result.optional).toBe(false)
		})

		it("should default optional to false when not provided", () => {
			const param = {
				name: "Test Parameter",
				key: "test_key",
				placeholder: "Enter value",
			}

			const result = mcpParameterSchema.parse(param)
			expect(result.optional).toBe(false)
		})

		it("should validate parameter without placeholder", () => {
			const param = {
				name: "Test Parameter",
				key: "test_key",
				optional: true,
			}

			const result = mcpParameterSchema.parse(param)
			expect(result.optional).toBe(true)
			expect(result.placeholder).toBeUndefined()
		})

		it("should require name and key fields", () => {
			expect(() => {
				mcpParameterSchema.parse({
					key: "test_key",
					optional: true,
				})
			}).toThrow()

			expect(() => {
				mcpParameterSchema.parse({
					name: "Test Parameter",
					optional: true,
				})
			}).toThrow()
		})
	})
})
