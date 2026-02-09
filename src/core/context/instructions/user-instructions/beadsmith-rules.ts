import {
	ActivatedConditionalRule,
	getRemoteRulesTotalContentWithMetadata,
	getRuleFilesTotalContentWithMetadata,
	RULE_SOURCE_PREFIX,
	RuleLoadResultWithInstructions,
	synchronizeRuleToggles,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/prompts/responses"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { BeadsmithRulesToggles } from "@shared/beadsmith-rules"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"
import { evaluateRuleConditionals, type RuleEvaluationContext } from "./rule-conditionals"

export const getGlobalBeadsmithRules = async (
	globalBeadsmithRulesFilePath: string,
	toggles: BeadsmithRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	let combinedContent = ""
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	// 1. Get file-based rules
	if (await fileExistsAtPath(globalBeadsmithRulesFilePath)) {
		if (await isDirectory(globalBeadsmithRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalBeadsmithRulesFilePath)
				// Note: ruleNamePrefix explicitly set to "global" for clarity (matches the default)
				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(
					rulesFilePaths,
					globalBeadsmithRulesFilePath,
					toggles,
					{
						evaluationContext: opts?.evaluationContext,
						ruleNamePrefix: "global",
					},
				)
				if (rulesFilesTotal.content) {
					combinedContent = rulesFilesTotal.content
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .beadsmithrules directory at ${globalBeadsmithRulesFilePath}`)
			}
		} else {
			Logger.error(`${globalBeadsmithRulesFilePath} is not a directory`)
		}
	}

	// 2. Append remote config rules
	const stateManager = StateManager.get()
	const remoteConfigSettings = stateManager.getRemoteConfigSettings()
	const remoteRules = remoteConfigSettings.remoteGlobalRules || []
	const remoteToggles = stateManager.getGlobalStateKey("remoteRulesToggles") || {}
	const remoteResult = getRemoteRulesTotalContentWithMetadata(remoteRules, remoteToggles, {
		evaluationContext: opts?.evaluationContext,
	})
	if (remoteResult.content) {
		if (combinedContent) combinedContent += "\n\n"
		combinedContent += remoteResult.content
		activatedConditionalRules.push(...remoteResult.activatedConditionalRules)
	}

	// 3. Return formatted instructions
	if (!combinedContent) {
		return { instructions: undefined, activatedConditionalRules: [] }
	}

	return {
		instructions: formatResponse.beadsmithRulesGlobalDirectoryInstructions(globalBeadsmithRulesFilePath, combinedContent),
		activatedConditionalRules,
	}
}

export const getLocalBeadsmithRules = async (
	cwd: string,
	toggles: BeadsmithRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	const beadsmithRulesFilePath = path.resolve(cwd, GlobalFileNames.beadsmithRules)

	let instructions: string | undefined
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	if (await fileExistsAtPath(beadsmithRulesFilePath)) {
		if (await isDirectory(beadsmithRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(beadsmithRulesFilePath, [
					[".beadsmithrules", "workflows"],
					[".beadsmithrules", "hooks"],
					[".beadsmithrules", "skills"],
				])

				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(rulesFilePaths, cwd, toggles, {
					evaluationContext: opts?.evaluationContext,
					ruleNamePrefix: "workspace",
				})
				if (rulesFilesTotal.content) {
					instructions = formatResponse.beadsmithRulesLocalDirectoryInstructions(cwd, rulesFilesTotal.content)
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .beadsmithrules directory at ${beadsmithRulesFilePath}`)
			}
		} else {
			try {
				if (beadsmithRulesFilePath in toggles && toggles[beadsmithRulesFilePath] !== false) {
					const raw = (await fs.readFile(beadsmithRulesFilePath, "utf8")).trim()
					if (raw) {
						// Keep single-file .beadsmithrules behavior consistent with directory/remote rules:
						// - Parse YAML frontmatter (fail-open on parse errors)
						// - Evaluate conditionals against the request's evaluation context
						const parsed = parseYamlFrontmatter(raw)
						if (parsed.hadFrontmatter && parsed.parseError) {
							// Fail-open: preserve the raw contents so the LLM can still see the author's intent.
							instructions = formatResponse.beadsmithRulesLocalFileInstructions(cwd, raw)
						} else {
							const { passed, matchedConditions } = evaluateRuleConditionals(
								parsed.data,
								opts?.evaluationContext ?? {},
							)
							if (passed) {
								instructions = formatResponse.beadsmithRulesLocalFileInstructions(cwd, parsed.body.trim())
								if (parsed.hadFrontmatter && Object.keys(matchedConditions).length > 0) {
									activatedConditionalRules.push({
										name: `${RULE_SOURCE_PREFIX.workspace}:${GlobalFileNames.beadsmithRules}`,
										matchedConditions,
									})
								}
							}
						}
					}
				}
			} catch {
				Logger.error(`Failed to read .beadsmithrules file at ${beadsmithRulesFilePath}`)
			}
		}
	}

	return { instructions, activatedConditionalRules }
}

export async function refreshBeadsmithRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: BeadsmithRulesToggles
	localToggles: BeadsmithRulesToggles
}> {
	// Global toggles
	const globalBeadsmithRulesToggles = controller.stateManager.getGlobalSettingsKey("globalBeadsmithRulesToggles")
	const globalBeadsmithRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalBeadsmithRulesFilePath, globalBeadsmithRulesToggles)
	controller.stateManager.setGlobalState("globalBeadsmithRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localBeadsmithRulesToggles = controller.stateManager.getWorkspaceStateKey("localBeadsmithRulesToggles")
	const localBeadsmithRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.beadsmithRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localBeadsmithRulesFilePath, localBeadsmithRulesToggles, "", [
		[".beadsmithrules", "workflows"],
		[".beadsmithrules", "hooks"],
		[".beadsmithrules", "skills"],
	])
	controller.stateManager.setWorkspaceState("localBeadsmithRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
