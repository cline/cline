import {
	type RuleFrontmatterWriteResult,
	resolveRuleWriteRoots,
	setRuleDisabledInFrontmatter,
} from "@core/context/instructions/user-instructions/cline-rules"
import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleClineRuleRequest } from "@shared/proto/cline/file"
import { RuleScope, ToggleClineRules } from "@shared/proto/cline/file"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Cline rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Cline rule toggles
 */
export async function toggleClineRule(controller: Controller, request: ToggleClineRuleRequest): Promise<ToggleClineRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleClineRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleClineRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalClineRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localClineRulesToggles", toggles)
			break
		}
		case RuleScope.REMOTE: {
			const toggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("remoteRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// The SDK rule loader reads the document's `disabled` frontmatter flag, not
	// the extension's toggle state, so file-backed global and workspace rules
	// are written as well. The write is confined to rule documents directly
	// inside the scope's rule roots; anything else keeps only the state toggle.
	// If a rule file cannot be written, the state toggle is reverted so the
	// panel keeps showing what the SDK will actually load. A successful write
	// makes the file authoritative for this rule, so a later hand edit of the
	// file is never overwritten by the one-time back-fill.
	if (scope !== RuleScope.REMOTE) {
		let result: RuleFrontmatterWriteResult = "failed"
		try {
			const allowedRoots = await resolveRuleWriteRoots(scope === RuleScope.GLOBAL ? "global" : "local")
			result = await setRuleDisabledInFrontmatter(rulePath, enabled, allowedRoots)
		} catch (error) {
			Logger.warn(`toggleClineRule: could not persist frontmatter for ${rulePath}`, error)
		}
		if (result === "failed") {
			Logger.warn(`toggleClineRule: reverting toggle for ${rulePath}; the rule file could not be updated`)
			if (scope === RuleScope.GLOBAL) {
				const toggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
				toggles[rulePath] = !enabled
				controller.stateManager.setGlobalState("globalClineRulesToggles", toggles)
			} else {
				const toggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
				toggles[rulePath] = !enabled
				controller.stateManager.setWorkspaceState("localClineRulesToggles", toggles)
			}
		} else if (result === "written") {
			if (scope === RuleScope.GLOBAL) {
				const authoritative = controller.stateManager.getGlobalStateKey("clineRulesFrontmatterAuthoritative")
				controller.stateManager.setGlobalState("clineRulesFrontmatterAuthoritative", {
					...authoritative,
					[rulePath]: true,
				})
			} else {
				const authoritative = controller.stateManager.getWorkspaceStateKey("localClineRulesFrontmatterAuthoritative")
				controller.stateManager.setWorkspaceState("localClineRulesFrontmatterAuthoritative", {
					...authoritative,
					[rulePath]: true,
				})
			}
		}
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleClineRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureClineRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleClineRules.create({
		globalClineRulesToggles: { toggles: globalToggles },
		localClineRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
