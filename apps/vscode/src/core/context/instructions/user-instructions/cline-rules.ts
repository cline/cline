import { resolveGlobalRulesConfigPaths, resolveWorkspaceRulesConfigPaths } from "@cline/shared/storage"
import { combineRuleToggles, synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { getCwd, getDesktopDir } from "@utils/path"
import * as fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { isFrontmatterDisabled, parseYamlFrontmatter, updateUserInstructionMarkdownDisabledState } from "./frontmatter"

/**
 * File types the SDK rule loader actually reads. Anything else that happens to
 * live in a rules directory (images, JSON, editor scratch files) is never
 * injected, so writing frontmatter into it would only corrupt it.
 */
const RULE_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt"])

/**
 * Sub-directories of `.clinerules` that hold non-rule config and must not be
 * surfaced as rules.
 */
const CLINERULES_EXCLUDED_SUBDIRECTORIES: string[][] = [
	[".clinerules", "workflows"],
	[".clinerules", "hooks"],
	[".clinerules", "skills"],
]

function isPathWithin(rootPath: string, candidatePath: string): boolean {
	const relativePath = path.relative(rootPath, candidatePath)
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

/**
 * Every global location a rule may live in: the Documents-based directory the
 * Rules tab creates files in, plus the locations the shared SDK resolver loads
 * from (e.g. ~/.cline/rules).
 */
async function resolveGlobalRuleDirectories(): Promise<string[]> {
	return [...new Set([await ensureRulesDirectoryExists(), ...resolveGlobalRulesConfigPaths()])]
}

/**
 * Roots a rule toggle is allowed to write into for the given scope: the global
 * rule directories, or this window's workspace rule locations.
 */
export async function resolveRuleWriteRoots(scope: "global" | "local"): Promise<string[]> {
	if (scope === "global") {
		return resolveGlobalRuleDirectories()
	}
	return resolveWorkspaceRulesConfigPaths(await getCwd(getDesktopDir()))
}

/**
 * Resolve a toggle's rule path to the real file we may write, or `null` when
 * the path is not a rule document the SDK loads or does not resolve (through
 * symlinks) into one of the allowed roots.
 */
export async function resolveWritableRuleFile(rulePath: string, allowedRoots: ReadonlyArray<string>): Promise<string | null> {
	if (!rulePath || !path.isAbsolute(rulePath)) {
		return null
	}
	const fileName = path.basename(rulePath)
	if (fileName !== GlobalFileNames.clineRules && !RULE_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
		return null
	}

	let realFilePath: string
	try {
		realFilePath = await fs.realpath(rulePath)
		if (!(await fs.stat(realFilePath)).isFile()) {
			return null
		}
	} catch {
		return null
	}

	for (const root of allowedRoots) {
		try {
			if (isPathWithin(await fs.realpath(root), realFilePath)) {
				return realFilePath
			}
		} catch {
			// Root does not exist; nothing under it can be written.
		}
	}
	return null
}

/**
 * Persist a rule's UI toggle in the frontmatter consumed by the SDK rules
 * loader, which reads `disabled` from the rule document itself rather than
 * from the extension's toggle state.
 *
 * Only rule documents inside `allowedRoots` are written; everything else is
 * skipped and reported as `false` (the extension-state toggle still applies).
 */
export async function setRuleDisabledInFrontmatter(
	rulePath: string,
	enabled: boolean,
	allowedRoots: ReadonlyArray<string>,
): Promise<boolean> {
	const filePath = await resolveWritableRuleFile(rulePath, allowedRoots)
	if (!filePath) {
		return false
	}
	try {
		const content = await fs.readFile(filePath, "utf-8")
		const updated = updateUserInstructionMarkdownDisabledState(content, enabled)
		if (updated !== content) {
			await fs.writeFile(filePath, updated)
		}
		return true
	} catch (error) {
		Logger.warn(`Failed to update rule frontmatter at ${filePath}:`, error)
		return false
	}
}

/**
 * Bring extension-state toggles and on-disk frontmatter into agreement.
 *
 * Toggles persisted before the toggle wrote frontmatter are written to the
 * file so SDK sessions honor them. A file whose frontmatter says it is
 * disabled (hand-edited, or toggled from another surface) wins over a stale
 * `true` in state so the panel shows what the model actually gets. Files
 * outside `allowedRoots` are left alone.
 */
export async function reconcileRuleTogglesWithFrontmatter(
	toggles: ClineRulesToggles,
	allowedRoots: ReadonlyArray<string>,
): Promise<ClineRulesToggles> {
	const updated: ClineRulesToggles = { ...toggles }
	for (const [rulePath, enabled] of Object.entries(toggles)) {
		const filePath = await resolveWritableRuleFile(rulePath, allowedRoots)
		if (!filePath) {
			continue
		}
		let content: string
		try {
			content = await fs.readFile(filePath, "utf-8")
		} catch {
			continue
		}
		const { data, parseError } = parseYamlFrontmatter(content)
		if (parseError) {
			continue
		}
		const fileDisabled = isFrontmatterDisabled(data)
		if (!enabled && !fileDisabled) {
			await setRuleDisabledInFrontmatter(rulePath, false, allowedRoots)
		} else if (enabled && fileDisabled) {
			updated[rulePath] = false
		}
	}
	return updated
}

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
	const globalRuleDirectories = await resolveGlobalRuleDirectories()
	const updatedGlobalToggles = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleTogglesAcrossDirectories(globalRuleDirectories, globalClineRulesToggles),
		globalRuleDirectories,
	)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles: both supported workspace layouts — the legacy
	// `.clinerules` directory (or single file) and `.cline/rules` — via the
	// same shared resolver the SDK runtime loads rules with (cline/cline#14186).
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localRuleDirectories = resolveWorkspaceRulesConfigPaths(workingDirectory)
	const updatedLocalToggles = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleTogglesAcrossDirectories(localRuleDirectories, localClineRulesToggles, CLINERULES_EXCLUDED_SUBDIRECTORIES),
		localRuleDirectories,
	)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
