import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { buildClaudeCodeProviderConfig } from "./claude-code-config"

describe("buildClaudeCodeProviderConfig", () => {
	it("forwards the configured executable path as the provider's pathToClaudeCodeExecutable", () => {
		const config: ApiConfiguration = { claudeCodePath: "/opt/homebrew/bin/claude" }

		expect(buildClaudeCodeProviderConfig(config)).toEqual({
			claudeCode: {
				defaultSettings: { pathToClaudeCodeExecutable: "/opt/homebrew/bin/claude" },
			},
		})
	})

	it("trims surrounding whitespace pasted into the settings field", () => {
		const config: ApiConfiguration = { claudeCodePath: "  /usr/local/bin/claude\n" }

		expect(buildClaudeCodeProviderConfig(config)).toEqual({
			claudeCode: {
				defaultSettings: { pathToClaudeCodeExecutable: "/usr/local/bin/claude" },
			},
		})
	})

	it("emits no override when the setting is unset", () => {
		expect(buildClaudeCodeProviderConfig({})).toEqual({})
	})

	it("emits no override when the setting was cleared to blank", () => {
		// A blank string must not reach the provider: emitting the key at all
		// suppresses the bundled/PATH fallback, so an empty value would pin the
		// session to an empty executable path.
		expect(buildClaudeCodeProviderConfig({ claudeCodePath: "" })).toEqual({})
		expect(buildClaudeCodeProviderConfig({ claudeCodePath: "   " })).toEqual({})
	})
})
