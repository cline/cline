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

/**
 * The SDK loader reads only the files directly inside a rules directory (or
 * the root itself when it is the single legacy `.clinerules` file); nested
 * files never reach the model, so they are never written either.
 */
function isRuleFileOfRoot(rootPath: string, filePath: string): boolean {
	return filePath === rootPath || path.dirname(filePath) === rootPath
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
 * symlinks) to a direct child of one of the allowed roots.
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
			if (isRuleFileOfRoot(await fs.realpath(root), realFilePath)) {
				return realFilePath
			}
		} catch {
			// Root does not exist; nothing under it can be written.
		}
	}
	return null
}

/**
 * Outcome of persisting a toggle to a rule file:
 * - `written`: the file now carries the requested state (or already did);
 * - `skipped`: the path is not a rule document the SDK loads, so there was
 *   nothing to write;
 * - `failed`: the file is a rule document but could not be read, written, or
 *   safely edited (malformed frontmatter), so the SDK will keep loading its
 *   previous state.
 */
export type RuleFrontmatterWriteResult = "written" | "skipped" | "failed"

/**
 * Persist a rule's UI toggle in the frontmatter consumed by the SDK rules
 * loader, which reads `disabled` from the rule document itself rather than
 * from the extension's toggle state. Only rule documents directly inside
 * `allowedRoots` are written.
 */
export async function setRuleDisabledInFrontmatter(
	rulePath: string,
	enabled: boolean,
	allowedRoots: ReadonlyArray<string>,
): Promise<RuleFrontmatterWriteResult> {
	const filePath = await resolveWritableRuleFile(rulePath, allowedRoots)
	if (!filePath) {
		return "skipped"
	}
	try {
		const content = await fs.readFile(filePath, "utf-8")
		const updated = updateUserInstructionMarkdownDisabledState(content, enabled)
		if (updated !== content) {
			await fs.writeFile(filePath, updated)
			return "written"
		}
		// An unchanged document either already carried the requested state or
		// could not be edited safely (malformed frontmatter); only the former is
		// a success, otherwise the panel would claim a state the SDK never sees.
		const { data, parseError } = parseYamlFrontmatter(content)
		if (parseError || isFrontmatterDisabled(data) !== !enabled) {
			Logger.warn(`Rule frontmatter at ${filePath} could not be updated; leaving the document untouched`)
			return "failed"
		}
		return "written"
	} catch (error) {
		Logger.warn(`Failed to update rule frontmatter at ${filePath}:`, error)
		return "failed"
	}
}

/**
 * Bring extension-state toggles and on-disk frontmatter into agreement. The
 * file is the source of truth, since it is what the SDK loads: a rule whose
 * frontmatter disables it shows as off in the panel, and a rule whose
 * frontmatter was hand-edited back to enabled shows as on.
 *
 * With `backfillFromState`, toggles turned off before the toggle wrote
 * frontmatter are written to their files first, so they keep taking effect
 * after upgrading. Run once; afterwards a `false` in state with no `disabled`
 * in the file means the user re-enabled the rule by editing it.
 *
 * Files outside `allowedRoots` are left alone.
 */
export async function reconcileRuleTogglesWithFrontmatter(
	toggles: ClineRulesToggles,
	allowedRoots: ReadonlyArray<string>,
	options: { backfillFromState?: boolean } = {},
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
		if (enabled === !fileDisabled) {
			continue
		}
		if (!enabled && options.backfillFromState) {
			if ((await setRuleDisabledInFrontmatter(rulePath, false, allowedRoots)) === "written") {
				continue
			}
		}
		updated[rulePath] = !fileDisabled
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
	// Toggles saved before the toggle wrote frontmatter (cline/cline#13695) are
	// pushed into the files once per scope; from then on the files are the
	// source of truth for that scope. The global marker is a global flag; the
	// workspace marker lives in this window's workspace state, keyed by
	// workspace path, so windows cannot clobber each other's marker through
	// their separate copies of global state.
	const globalBackfilled = controller.stateManager.getGlobalStateKey("clineRulesTogglesWrittenToFrontmatter") === true
	const backfilledWorkspaces = controller.stateManager.getWorkspaceStateKey("localClineRulesTogglesWrittenToFrontmatter")
	const workspaceBackfilled = backfilledWorkspaces[workingDirectory] === true

	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalRuleDirectories = await resolveGlobalRuleDirectories()
	const updatedGlobalToggles = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleTogglesAcrossDirectories(globalRuleDirectories, globalClineRulesToggles),
		globalRuleDirectories,
		{ backfillFromState: !globalBackfilled },
	)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)
	if (!globalBackfilled) {
		controller.stateManager.setGlobalState("clineRulesTogglesWrittenToFrontmatter", true)
	}

	// Local toggles: both supported workspace layouts — the legacy
	// `.clinerules` directory (or single file) and `.cline/rules` — via the
	// same shared resolver the SDK runtime loads rules with (cline/cline#14186).
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localRuleDirectories = resolveWorkspaceRulesConfigPaths(workingDirectory)
	const updatedLocalToggles = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleTogglesAcrossDirectories(
			localRuleDirectories,
			localClineRulesToggles,
			CLINERULES_EXCLUDED_SUBDIRECTORIES,
		),
		localRuleDirectories,
		{ backfillFromState: !workspaceBackfilled },
	)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)
	if (!workspaceBackfilled) {
		controller.stateManager.setWorkspaceState("localClineRulesTogglesWrittenToFrontmatter", {
			...backfilledWorkspaces,
			[workingDirectory]: true,
		})
	}

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
