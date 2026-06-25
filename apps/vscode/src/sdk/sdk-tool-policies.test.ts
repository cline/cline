import { describe, expect, it } from "bun:test"
import {
	DEFAULT_AUTO_APPROVAL_SETTINGS,
	mergeAutoApprovalSettings,
	normalizeAutoApprovalSettings,
} from "@shared/AutoApprovalSettings"
import { isToolAutoApproved } from "./sdk-tool-policies"

describe("isToolAutoApproved", () => {
	it("uses executeAllCommands as the single command approval flag", () => {
		const settings = normalizeAutoApprovalSettings({
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		})

		expect(isToolAutoApproved("run_commands", settings)).toBe(true)
	})

	it("migrates old executeSafeCommands approval to executeAllCommands", () => {
		const settings = normalizeAutoApprovalSettings({
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: true,
				executeAllCommands: false,
			},
		})

		expect(settings.actions.executeAllCommands).toBe(true)
		expect(isToolAutoApproved("run_commands", settings)).toBe(true)
	})

	it("preserves disabled command approval", () => {
		const settings = normalizeAutoApprovalSettings({
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: false,
			},
		})

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	it("lets explicit executeAllCommands updates override legacy executeSafeCommands", () => {
		const settings = mergeAutoApprovalSettings(
			{
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				actions: {
					...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
					executeSafeCommands: true,
					executeAllCommands: true,
				},
			},
			{
				actions: {
					executeAllCommands: false,
				},
			},
		)

		expect(settings.actions.executeSafeCommands).toBe(false)
		expect(settings.actions.executeAllCommands).toBe(false)
		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})
})
