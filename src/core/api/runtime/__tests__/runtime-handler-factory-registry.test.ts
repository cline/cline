import { describe, it } from "mocha"
import "should"
import { ClaudeCodeHandler } from "../../providers/claude-code"
import { getRuntimeHandlerFactoryRegistry } from "../runtime-handler-factory-registry"

describe("RuntimeHandlerFactoryRegistry", () => {
	it("should expose the Claude Code runtime factory as the first runtime-backed reference implementation", () => {
		const registry = getRuntimeHandlerFactoryRegistry()
		const factory = registry.get("claude-code")

		should.exist(factory)

		const handler = factory!.buildHandler({
			mode: "act",
			configuration: {
				actModeApiProvider: "claude-code",
				planModeApiProvider: "claude-code",
				actModeApiModelId: "claude-opus-4-1-20250805",
				planModeApiModelId: "claude-opus-4-1-20250805",
				claudeCodePath: "/mock/path",
			},
		})

		handler.should.be.instanceOf(ClaudeCodeHandler)
	})
})
