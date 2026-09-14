import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
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
 * injected on Next, so writing frontmatter into it would only corrupt it.
 */
const RULE_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt"])

function isPathWithin(rootPath: string, candidatePath: string): boolean {
	const relativePath = path.relative(rootPath, candidatePath)
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

/**
 * The directory (or legacy single `.clinerules` file) that workspace rules
 * live in for the given workspace root.
 */
export function getLocalClineRulesPath(workingDirectory: string): string {
	return path.resolve(workingDirectory, GlobalFileNames.clineRules)
}

/**
 * Roots a rule toggle is allowed to write into for the given scope: the global
 * rules directory, or this window's workspace `.clinerules`.
 */
export async function resolveRuleWriteRoots(scope: "global" | "local"): Promise<string[]> {
	if (scope === "global") {
		return [await ensureRulesDirectoryExists()]
	}
	return [getLocalClineRulesPath(await getCwd(getDesktopDir()))]
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
 * loader. The legacy rule loader reads extension state, while the SDK loader
 * reads `disabled` from the rule document itself.
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
 * Toggles persisted before the toggle wrote frontmatter (or by the legacy
 * variant) are written to the file so SDK sessions honor them. A file whose
 * frontmatter says it is disabled (hand-edited, or toggled from another
 * surface) wins over a stale `true` in state so the panel shows what the model
 * actually gets. Files outside `allowedRoots` are left alone.
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

export async function refreshClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleToggles(globalClineRulesFilePath, globalClineRulesToggles),
		[globalClineRulesFilePath],
	)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localClineRulesFilePath = getLocalClineRulesPath(workingDirectory)
	const updatedLocalToggles = await reconcileRuleTogglesWithFrontmatter(
		await synchronizeRuleToggles(localClineRulesFilePath, localClineRulesToggles, "", [
			[".clinerules", "workflows"],
			[".clinerules", "hooks"],
			[".clinerules", "skills"],
		]),
		[localClineRulesFilePath],
	)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
