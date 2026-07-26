import { describe, expect, it } from "vitest";
import { getToolApprovalDecision } from "./approval-policy";

describe("getToolApprovalDecision", () => {
	it.each([
		["read workspace files", "read_files", "act", undefined, "allow"],
		["search workspace code", "search_codebase", "act", undefined, "allow"],
		[
			"fetch web content",
			"fetch_web_content",
			"act",
			undefined,
			"allow",
		],
		["edit a file", "editor", "act", {}, "require_approval"],
		["run a command", "run_commands", "act", {}, "require_approval"],
		["call an MCP tool", "docs__search", "act", {}, "require_approval"],
		["call a plugin tool", "deploy_app", "act", {}, "require_approval"],
		[
			"complete without a command",
			"attempt_completion",
			"act",
			{ result: "done" },
			"allow",
		],
		[
			"complete with a command",
			"attempt_completion",
			"act",
			{ result: "done", command: "bun test" },
			"require_approval",
		],
		["edit in plan mode", "editor", "plan", {}, "prohibited"],
		["run a command in plan mode", "run_commands", "plan", {}, "prohibited"],
		["call MCP in plan mode", "docs__search", "plan", {}, "prohibited"],
	] as const)(
		"%s",
		(_label, toolName, mode, input, expected) => {
			expect(
				getToolApprovalDecision({ toolName, mode, input }),
			).toBe(expected);
		},
	);

	it("does not let a plugin borrow a read-only built-in name", () => {
		expect(
			getToolApprovalDecision({
				toolName: "read_files",
				mode: "act",
				source: "plugin",
			}),
		).toBe("require_approval");
	});
});
