import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { isToolAutoApproved } from "./sdk-tool-policies"

const SAFE_COMMANDS_ENABLED = {
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	actions: {
		...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
		executeSafeCommands: true,
	},
}

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("requires executeSafeCommands to be enabled for auto-approval", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	it("auto-approves safe commands when executeSafeCommands is enabled", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "ls -la")).toBe(true)
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git status")).toBe(true)
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "cd /tmp && pwd")).toBe(true)
	})

	it("does not auto-approve git commit --amend", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git commit --amend")).toBe(false)
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git commit -a --amend --no-edit")).toBe(
			false,
		)
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, { commands: ["git commit --amend"] })).toBe(
			false,
		)
		expect(
			isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, {
				commands: [{ command: "git", args: ["commit", "--amend"] }],
			}),
		).toBe(false)
	})

	it("does not auto-approve git push --force", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git push --force")).toBe(false)
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git push -f origin main")).toBe(false)
	})

	it("does not auto-approve git reset --hard", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git reset --hard HEAD~1")).toBe(false)
	})

	it("does not auto-approve git rebase", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "git rebase main")).toBe(false)
	})

	it("does not auto-approve rm -rf", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "rm -rf /tmp/some-dir")).toBe(false)
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED, undefined, "rm -r -f /tmp/some-dir")).toBe(false)
	})

	it("still auto-approves execute_command tool for safe commands", () => {
		expect(isToolAutoApproved("execute_command", SAFE_COMMANDS_ENABLED, undefined, "echo hello")).toBe(true)
	})

	it("does not require input to be provided for safe commands check", () => {
		expect(isToolAutoApproved("run_commands", SAFE_COMMANDS_ENABLED)).toBe(true)
	})
})
