/**
 * Tests for HookEvent types and utilities
 */

import { expect } from "chai"
import { describe, it } from "mocha"
import { ClineDefaultTool } from "@/shared/tools"
import {
	getClineToolName,
	HookEventName,
	isHookEvent,
	isNotificationEvent,
	isPostToolUseEvent,
	isPreCompactEvent,
	isPreToolUseEvent,
	isSessionEndEvent,
	isSessionStartEvent,
	isStopEvent,
	isSubagentStopEvent,
	isUserPromptSubmitEvent,
	TOOL_NAME_MAP,
} from "./HookEvent"

describe("HookEvent Type Guards", () => {
	const baseEvent = {
		session_id: "test-session",
		transcript_path: "/path/to/transcript",
		cwd: "/workspace",
		hook_event_name: "",
	}

	describe("isHookEvent", () => {
		it("should return true for valid hook events", () => {
			expect(isHookEvent({ ...baseEvent, hook_event_name: "PreToolUse" })).to.equal(true)
		})

		it("should return false for invalid events", () => {
			expect(isHookEvent(null)).to.equal(false)
			expect(isHookEvent(undefined)).to.equal(false)
			expect(isHookEvent({})).to.equal(false)
			expect(isHookEvent({ session_id: "test" })).to.equal(false)
		})
	})

	describe("isPreToolUseEvent", () => {
		it("should identify PreToolUse events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.PRE_TOOL_USE,
				tool_name: "Read",
				tool_input: { path: "/file.txt" },
			}
			expect(isPreToolUseEvent(event)).to.equal(true)
		})

		it("should reject non-PreToolUse events", () => {
			const event = { ...baseEvent, hook_event_name: HookEventName.POST_TOOL_USE }
			expect(isPreToolUseEvent(event)).to.equal(false)
		})
	})

	describe("isPostToolUseEvent", () => {
		it("should identify PostToolUse events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.POST_TOOL_USE,
				tool_name: "Write",
				tool_input: { path: "/file.txt" },
				tool_response: "Success",
			}
			expect(isPostToolUseEvent(event)).to.equal(true)
		})

		it("should reject non-PostToolUse events", () => {
			const event = { ...baseEvent, hook_event_name: HookEventName.PRE_TOOL_USE }
			expect(isPostToolUseEvent(event)).to.equal(false)
		})
	})

	describe("isNotificationEvent", () => {
		it("should identify Notification events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.NOTIFICATION,
				message: "Test notification",
			}
			expect(isNotificationEvent(event)).to.equal(true)
		})
	})

	describe("isUserPromptSubmitEvent", () => {
		it("should identify UserPromptSubmit events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.USER_PROMPT_SUBMIT,
				prompt: "Test prompt",
			}
			expect(isUserPromptSubmitEvent(event)).to.equal(true)
		})
	})

	describe("isStopEvent", () => {
		it("should identify Stop events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.STOP,
				stop_hook_active: true,
			}
			expect(isStopEvent(event)).to.equal(true)
		})
	})

	describe("isSubagentStopEvent", () => {
		it("should identify SubagentStop events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.SUBAGENT_STOP,
				stop_hook_active: false,
			}
			expect(isSubagentStopEvent(event)).to.equal(true)
		})
	})

	describe("isPreCompactEvent", () => {
		it("should identify PreCompact events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.PRE_COMPACT,
				trigger: "manual" as const,
				custom_instructions: "Test instructions",
			}
			expect(isPreCompactEvent(event)).to.equal(true)
		})
	})

	describe("isSessionStartEvent", () => {
		it("should identify SessionStart events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.SESSION_START,
				source: "startup" as const,
			}
			expect(isSessionStartEvent(event)).to.equal(true)
		})
	})

	describe("isSessionEndEvent", () => {
		it("should identify SessionEnd events", () => {
			const event = {
				...baseEvent,
				hook_event_name: HookEventName.SESSION_END,
			}
			expect(isSessionEndEvent(event)).to.equal(true)
		})
	})
})

describe("Tool Name Mapping", () => {
	it("should map all Cline tools to Claude-compatible names", () => {
		// Verify some key mappings
		expect(TOOL_NAME_MAP[ClineDefaultTool.FILE_READ]).to.equal("Read")
		expect(TOOL_NAME_MAP[ClineDefaultTool.FILE_NEW]).to.equal("Write")
		expect(TOOL_NAME_MAP[ClineDefaultTool.FILE_EDIT]).to.equal("Edit")
		expect(TOOL_NAME_MAP[ClineDefaultTool.BASH]).to.equal("Bash")
		expect(TOOL_NAME_MAP[ClineDefaultTool.SEARCH]).to.equal("Grep")
		expect(TOOL_NAME_MAP[ClineDefaultTool.LIST_FILES]).to.equal("Glob")
		expect(TOOL_NAME_MAP[ClineDefaultTool.WEB_FETCH]).to.equal("WebFetch")
		expect(TOOL_NAME_MAP[ClineDefaultTool.NEW_TASK]).to.equal("Task")
	})

	it("should handle getClineToolName correctly", () => {
		expect(getClineToolName(ClineDefaultTool.FILE_READ)).to.equal("Read")
		expect(getClineToolName(ClineDefaultTool.BASH)).to.equal("Bash")
		expect(getClineToolName(ClineDefaultTool.TODO)).to.equal("TodoWrite")
	})
})
