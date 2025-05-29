import { describe, it } from "mocha"
import { expect } from "chai"
import { z } from "zod"
import { ServerConfigSchema } from "@services/mcp/McpHub"

describe("McpHub Schema Validation Tests", () => {
	it("should correctly parse HTTP config when transportType is explicit", () => {
		// Config with explicit HTTP transportType
		const httpConfig = {
			url: "http://localhost:3000/mcp",
			transportType: "http",
			disabled: false,
			timeout: 60,
			autoApprove: [],
		}

		const result = ServerConfigSchema.safeParse(httpConfig)

		// It should succeed and parse correctly
		expect(result.success).to.be.true

		if (result.success) {
			// It should be parsed as HTTP with the fix
			expect(result.data.transportType).to.equal("http")
		}
	})

	it("should work with configs that omit transportType to fallback to sse", () => {
		// Without explicit transportType, using URL implies it's a remote server
		const httpConfig = {
			url: "http://localhost:3000/mcp",
			disabled: false,
			timeout: 60,
			autoApprove: [],
		}

		const result = ServerConfigSchema.safeParse(httpConfig)

		expect(result.success).to.be.true

		if (result.success) {
			// With our fix, URLs should be treated as HTTP when transportType is not specified
			expect(result.data.transportType).to.equal("sse")
		}
	})

	it("should correctly parse stdio config when transportType is explicit", () => {
		const stdioConfig = {
			command: "node",
			args: ["server.js"],
			transportType: "stdio",
			disabled: false,
			timeout: 60,
			autoApprove: [],
		}

		const result = ServerConfigSchema.safeParse(stdioConfig)

		expect(result.success).to.be.true

		if (result.success) {
			expect(result.data.transportType).to.equal("stdio")
		}
	})

	describe("Validation with incorrect schema", () => {
		it("should reject configs with invalid transportType", () => {
			const invalidConfig = {
				url: "http://localhost:3000/mcp",
				transportType: "invalid", // Not one of the allowed transportTypes
				disabled: false,
				timeout: 60,
				autoApprove: [],
			}

			const result = ServerConfigSchema.safeParse(invalidConfig)
			expect(result.success).to.be.false
		})

		it("should reject configs with missing required fields", () => {
			// Missing both url and command, which means it matches neither HTTP/SSE nor stdio
			const invalidConfig = {
				disabled: false,
				timeout: 60,
				autoApprove: [],
			}

			const result = ServerConfigSchema.safeParse(invalidConfig)
			expect(result.success).to.be.false
		})

		it("should reject configs with invalid field types", () => {
			const invalidConfig = {
				url: "not-a-valid-url", // Invalid URL format
				disabled: false,
				timeout: 60,
				autoApprove: [],
			}

			const result = ServerConfigSchema.safeParse(invalidConfig)
			expect(result.success).to.be.false
		})
	})
})
