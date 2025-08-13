import {
	getGlobalClineRules,
	getLocalClineRules,
	refreshClineRulesToggles,
} from "@/core/context/instructions/user-instructions/cline-rules"
import {
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@/core/context/instructions/user-instructions/external-rules"
import { ensureRulesDirectoryExists } from "@/core/storage/disk"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, LanguageDisplay } from "@/shared/Languages"
import { formatResponse } from "../../responses"
import { ClineIgnoreController } from "@/core/ignore/ClineIgnoreController"
import { formatUserInstructions } from "./formatUserInstructions"
import { CacheService } from "@/core/storage/CacheService"

export async function buildUserInstructions(
	preferredLanguage: string,
	cacheService: CacheService,
	cwd: string,
	clineIgnoreController: ClineIgnoreController,
) {
	const preferredLanguageKey = getLanguageKey(preferredLanguage as LanguageDisplay)
	const preferredLanguageInstructions =
		preferredLanguageKey && preferredLanguageKey !== DEFAULT_LANGUAGE_SETTINGS
			? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
			: ""

	const { globalToggles, localToggles } = await refreshClineRulesToggles(cacheService, cwd)
	const { windsurfLocalToggles, cursorLocalToggles } = await refreshExternalRulesToggles(cacheService, cwd)

	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const globalClineRulesFileInstructions = await getGlobalClineRules(globalClineRulesFilePath, globalToggles)

	const localClineRulesFileInstructions = await getLocalClineRules(cwd, localToggles)
	const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(cwd, cursorLocalToggles)
	const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(cwd, windsurfLocalToggles)

	const clineIgnoreContent = clineIgnoreController.clineIgnoreContent
	let clineIgnoreInstructions: string | undefined
	if (clineIgnoreContent) {
		clineIgnoreInstructions = formatResponse.clineIgnoreInstructions(clineIgnoreContent)
	}

	if (
		globalClineRulesFileInstructions ||
		localClineRulesFileInstructions ||
		localCursorRulesFileInstructions ||
		localCursorRulesDirInstructions ||
		localWindsurfRulesFileInstructions ||
		clineIgnoreInstructions ||
		preferredLanguageInstructions
	) {
		// altering the system prompt mid-task will break the prompt cache, but in the grand scheme this will not change often so it's better to not pollute user messages with it the way we have to with <potentially relevant details>
		const userInstructions = formatUserInstructions(
			globalClineRulesFileInstructions,
			localClineRulesFileInstructions,
			localCursorRulesFileInstructions,
			localCursorRulesDirInstructions,
			localWindsurfRulesFileInstructions,
			clineIgnoreInstructions,
			preferredLanguageInstructions,
		)
		return userInstructions
	} else {
		return ""
	}
}
