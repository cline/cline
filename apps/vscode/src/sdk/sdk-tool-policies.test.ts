import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { buildToolPolicies, isToolAutoApproved } from "./sdk-tool-policies"

describe("buildToolPolicies", () => {
	it("keeps command tools enabled in plan mode", () => {
		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, undefined, "plan")

		expect(policies.run_commands).toEqual({ autoApprove: false })
		expect(policies.execute_command).toEqual({ autoApprove: false })
	})

	it("disables file mutation tools in plan mode", () => {
		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, undefined, "plan")

		expect(policies.editor).toEqual({ enabled: false, autoApprove: false })
		expect(policies.write_to_file).toEqual({ enabled: false, autoApprove: false })
		expect(policies.replace_in_file).toEqual({ enabled: false, autoApprove: false })
		expect(policies.apply_patch).toEqual({ enabled: false, autoApprove: false })
		expect(policies.delete_file).toEqual({ enabled: false, autoApprove: false })
		expect(policies.new_rule).toEqual({ enabled: false, autoApprove: false })
	})

	it("keeps file mutation tools approval-gated in act mode", () => {
		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, undefined, "act")

		expect(policies.editor).toEqual({ autoApprove: false })
		expect(policies.write_to_file).toEqual({ autoApprove: false })
	})
})

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("uses executeSafeCommands as the single command approval flag", () => {
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
})
