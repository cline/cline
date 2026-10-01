import { resolveGlobalRulesConfigPaths, resolveWorkspaceRulesConfigPaths } from "@cline/shared/storage"
import { combineRuleToggles, synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists, ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
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
 * Bring extension-state toggles and on-disk frontmatter into agreement, one
 * rule at a time.
 *
 * Once a rule is in `authoritative`, its file is the source of truth, since it
 * is what the SDK loads: frontmatter that disables it shows as off in the
 * panel, and removing `disabled` from the file shows it as on again.
 *
 * A rule not yet in `authoritative` gets a one-time back-fill: a toggle turned
 * off before the toggle wrote frontmatter (cline/cline#13695) is written into
 * its file. When that write does not succeed (read-only file, malformed
 * frontmatter) the rule stays off and stays pending, so the next refresh
 * retries just that rule. Any other pending rule joins `authoritative`
 * immediately: state and file either agree, or the file disables a rule state
 * still shows as on, in which case the file wins.
 *
 * Files outside `allowedRoots` are left alone, and paths no longer in
 * `toggles` are dropped from the returned `authoritative`.
 */
export async function reconcileRuleTogglesWithFrontmatter(
	toggles: ClineRulesToggles,
	allowedRoots: ReadonlyArray<string>,
	authoritative: Readonly<Record<string, boolean>> = {},
): Promise<{ toggles: ClineRulesToggles; authoritative: Record<string, boolean> }> {
	const updated: ClineRulesToggles = { ...toggles }
	const nextAuthoritative: Record<string, boolean> = {}
	for (const [rulePath, enabled] of Object.entries(toggles)) {
		const wasAuthoritative = authoritative[rulePath] === true
		if (wasAuthoritative) {
			nextAuthoritative[rulePath] = true
		}
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
		const fileEnabled = !isFrontmatterDisabled(data)
		if (!wasAuthoritative && !enabled && fileEnabled) {
			if ((await setRuleDisabledInFrontmatter(rulePath, false, allowedRoots)) === "written") {
				nextAuthoritative[rulePath] = true
			}
			continue
		}
		updated[rulePath] = fileEnabled
		nextAuthoritative[rulePath] = true
	}
	return { toggles: updated, authoritative: nextAuthoritative }
}

const GLOBAL_RULE_AUTHORITY_FILE_NAME = "cline-rules-frontmatter-authority.json"

async function globalRuleAuthorityFilePath(): Promise<string> {
	return path.join(await ensureSettingsDirectoryExists(), GLOBAL_RULE_AUTHORITY_FILE_NAME)
}

/**
 * Read the global rule paths whose file frontmatter is authoritative (see
 * reconcileRuleTogglesWithFrontmatter) straight from disk.
 *
 * They are kept in their own file rather than in global state because every
 * window holds its own cached copy of global state and persists that whole
 * snapshot, so another window's progress could be overwritten and a stale
 * window could back-fill a rule the user has since re-enabled by hand.
 */
export async function readGlobalRuleAuthority(): Promise<Record<string, boolean>> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(await globalRuleAuthorityFilePath(), "utf-8"))
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {}
		}
		return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === true)) as Record<string, boolean>
	} catch {
		return {}
	}
}

/**
 * Add global rule paths to the authority file. The file is re-read and merged
 * on every call, so concurrent windows only ever add to it; entries whose rule
 * file no longer exists are dropped.
 */
export async function recordGlobalRuleAuthority(rulePaths: Iterable<string>): Promise<void> {
	try {
		const current = await readGlobalRuleAuthority()
		const merged: Record<string, boolean> = { ...current }
		for (const rulePath of rulePaths) {
			merged[rulePath] = true
		}
		for (const rulePath of Object.keys(merged)) {
			try {
				await fs.stat(rulePath)
			} catch {
				delete merged[rulePath]
			}
		}
		const unchanged =
			Object.keys(merged).length === Object.keys(current).length && Object.keys(merged).every((key) => current[key])
		if (unchanged) {
			return
		}
		const filePath = await globalRuleAuthorityFilePath()
		const temporaryPath = `${filePath}.${process.pid}.tmp`
		await fs.writeFile(temporaryPath, JSON.stringify(merged, null, 2))
		await fs.rename(temporaryPath, filePath)
	} catch (error) {
		Logger.warn("Failed to record global rule frontmatter authority:", error)
	}
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
	// Each scope tracks, per rule, whether its file has become authoritative
	// (see reconcileRuleTogglesWithFrontmatter): the global set in its own
	// settings file, re-read on every refresh, and the workspace set in this
	// workspace's state.
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalRuleDirectories = await resolveGlobalRuleDirectories()
	const globalResult = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleTogglesAcrossDirectories(globalRuleDirectories, globalClineRulesToggles),
		globalRuleDirectories,
		await readGlobalRuleAuthority(),
	)
	const updatedGlobalToggles = globalResult.toggles
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)
	await recordGlobalRuleAuthority(Object.keys(globalResult.authoritative))

	// Local toggles: both supported workspace layouts — the legacy
	// `.clinerules` directory (or single file) and `.cline/rules` — via the
	// same shared resolver the SDK runtime loads rules with (cline/cline#14186).
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localRuleDirectories = resolveWorkspaceRulesConfigPaths(workingDirectory)
	const localResult = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleTogglesAcrossDirectories(
			localRuleDirectories,
			localClineRulesToggles,
			CLINERULES_EXCLUDED_SUBDIRECTORIES,
		),
		localRuleDirectories,
		controller.stateManager.getWorkspaceStateKey("localClineRulesFrontmatterAuthoritative"),
	)
	const updatedLocalToggles = localResult.toggles
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)
	controller.stateManager.setWorkspaceState("localClineRulesFrontmatterAuthoritative", localResult.authoritative)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
