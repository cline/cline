import { describe, it } from "mocha"
import "should"
import { MAX_MCP_SERVER_INSTRUCTIONS_LENGTH, sanitizeMcpServerInstructions } from "../McpHub"

describe("McpHub server instructions", () => {
	it("should trim server instructions before storing them", () => {
		sanitizeMcpServerInstructions("  Use the read-only tools first.\n")!.should.equal("Use the read-only tools first.")
	})

	it("should cap server instructions to the hard maximum", () => {
		const oversizedInstructions = "a".repeat(MAX_MCP_SERVER_INSTRUCTIONS_LENGTH + 100)
		const sanitizedInstructions = sanitizeMcpServerInstructions(oversizedInstructions)

		sanitizedInstructions!.length.should.equal(MAX_MCP_SERVER_INSTRUCTIONS_LENGTH)
		sanitizedInstructions!.should.equal("a".repeat(MAX_MCP_SERVER_INSTRUCTIONS_LENGTH))
	})

	it("should ignore missing or blank server instructions", () => {
		should(sanitizeMcpServerInstructions(undefined)).be.undefined()
		should(sanitizeMcpServerInstructions(" \n\t ")).be.undefined()
	})
})
