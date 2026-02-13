import type { ClineMessage } from "@shared/ExtensionMessage"
import { render } from "ink-testing-library"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage } from "./ChatMessage"

vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({
		columns: 120,
		rows: 40,
		resizeKey: 0,
	}),
}))

describe("ChatMessage subagent rendering", () => {
	it("renders subagent approval prompts as a tree", () => {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "use_subagents",
			text: JSON.stringify({
				prompts: [
					"Find codebase stats and size",
					"Find funny comments and easter eggs",
					"Find unusual patterns and history",
				],
			}),
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain("Cline wants to run subagents")
		expect(frame).toContain("├─   Find codebase stats and size")
		expect(frame).toContain("├─   Find funny comments and easter eggs")
		expect(frame).toContain("└─   Find unusual patterns and history")
	})

	it("renders subagent progress rows with compact token stats and completion checks", () => {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "subagent",
			text: JSON.stringify({
				status: "running",
				total: 3,
				completed: 1,
				successes: 1,
				failures: 0,
				toolCalls: 21,
				inputTokens: 0,
				outputTokens: 0,
				contextWindow: 0,
				maxContextTokens: 0,
				maxContextUsagePercentage: 0,
				items: [
					{
						index: 1,
						prompt: "Find codebase stats and size",
						status: "completed",
						toolCalls: 5,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0.034,
						contextTokens: 24400,
						contextWindow: 200000,
						contextUsagePercentage: 12.2,
					},
					{
						index: 2,
						prompt: "Find funny comments and easter eggs",
						status: "running",
						toolCalls: 11,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0.056,
						contextTokens: 31600,
						contextWindow: 200000,
						contextUsagePercentage: 15.8,
					},
					{
						index: 3,
						prompt: "Find unusual patterns and history",
						status: "pending",
						toolCalls: 5,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						contextTokens: 28900,
						contextWindow: 200000,
						contextUsagePercentage: 14.4,
					},
				],
			}),
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { isStreaming: true, message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain("Cline is running subagents")
		expect(frame).toContain("✓ Find codebase stats and size")
		expect(frame).toContain("5 tool uses · 24.4k tokens · $0.03")
		expect(frame).toContain("11 tool uses · 31.6k tokens · $0.06")
		expect(frame).toContain("5 tool uses · 28.9k tokens · $0.00")
	})
})
