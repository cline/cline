import { resolveGlobalRulesConfigPaths, resolveWorkspaceRulesConfigPaths } from "@cline/shared/storage"
import { combineRuleToggles, synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { Controller } from "@/core/controller"

/**
 * Sub-directories of `.clinerules` that hold non-rule config and must not be
 * surfaced as rules.
 */
const CLINERULES_EXCLUDED_SUBDIRECTORIES: string[][] = [
	[".clinerules", "workflows"],
	[".clinerules", "hooks"],
	[".clinerules", "skills"],
]

/**
 * Synchronizes rule toggles across every directory a rule may live in.
 * `synchronizeRuleToggles` prunes toggles for files outside the directory it
 * scans, so each directory is synchronized against the same starting state and
 * the results are combined (mirroring the multi-location handling for Cursor
 * rules in external-rules.ts).
 */
async function synchronizeRuleTogglesAcrossDirectories(
	directories: string[],
	currentToggles: ClineRulesToggles,
	excludedPaths: string[][] = [],
): Promise<ClineRulesToggles> {
	let combined: ClineRulesToggles = {}
	for (const directory of directories) {
		const synchronized = await synchronizeRuleToggles(directory, currentToggles, "", excludedPaths)
		combined = combineRuleToggles(combined, synchronized)
	}
	return combined
}

export async function refreshClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles: the Documents-based directory the Rules tab creates files
	// in (resolved through the OS, so it follows redirected Documents folders),
	// plus every global location the shared SDK resolver loads rules from
	// (e.g. ~/.cline/rules), so the panel shows what actually reaches the model.
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const globalRuleDirectories = [...new Set([globalClineRulesFilePath, ...resolveGlobalRulesConfigPaths()])]
	const updatedGlobalToggles = await synchronizeRuleTogglesAcrossDirectories(globalRuleDirectories, globalClineRulesToggles)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles: both supported workspace layouts — the legacy
	// `.clinerules` directory (or single file) and `.cline/rules` — via the
	// same shared resolver the SDK runtime loads rules with (cline/cline#14186).
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const updatedLocalToggles = await synchronizeRuleTogglesAcrossDirectories(
		resolveWorkspaceRulesConfigPaths(workingDirectory),
		localClineRulesToggles,
		CLINERULES_EXCLUDED_SUBDIRECTORIES,
	)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
