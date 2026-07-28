import { describe, expect, it } from "vitest"
import { buildToolApprovalDenialReason, isKnownToolApprovalDenial } from "./tool-approval-denial"

describe("buildToolApprovalDenialReason", () => {
	it("tells the model the rejection was not a failure and to wait for the user", () => {
		expect(buildToolApprovalDenialReason("execute_command", undefined)).toBe(
			"This tool call was rejected by the user and not performed (this was not a tool or system failure). Wait for the user to tell you how to proceed.",
		)
	})

	it("keeps the file-unchanged warning for edit tools", () => {
		expect(buildToolApprovalDenialReason("replace_in_file", undefined)).toBe(
			"This tool call was rejected by the user and not performed (this was not a tool or system failure). The file was NOT modified and still contains its original content. Wait for the user to tell you how to proceed.",
		)
	})

	it("replaces the wait instruction with the user's feedback", () => {
		expect(buildToolApprovalDenialReason("execute_command", "  too risky  ")).toBe(
			"This tool call was rejected by the user and not performed (this was not a tool or system failure). The user provided the following feedback:\n<feedback>\ntoo risky\n</feedback>",
		)
	})

	it("recognizes its own denial reasons, with or without feedback", () => {
		expect(isKnownToolApprovalDenial(buildToolApprovalDenialReason("execute_command", undefined))).toBe(true)
		expect(isKnownToolApprovalDenial(buildToolApprovalDenialReason("replace_in_file", "make them bigger"))).toBe(true)
		expect(isKnownToolApprovalDenial("The tool execution failed with the following error")).toBe(false)
	})
})
