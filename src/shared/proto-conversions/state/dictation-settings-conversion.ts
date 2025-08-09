import { DictationSettings as ProtoDictationSettings } from "../../proto/cline/state"
import { DictationSettings } from "../../DictationSettings"

/**
 * Converts proto DictationSettings to TypeScript DictationSettings
 */
export function convertProtoDictationSettingsToDictationSettings(
	protoDictationSettings: ProtoDictationSettings,
): DictationSettings {
	return {
		dictationEnabled: protoDictationSettings.dictationEnabled,
		dictationLanguage: protoDictationSettings.dictationLanguage,
	}
}

/**
 * Converts TypeScript DictationSettings to proxto DictationSettings
 */
export function convertDictationSettingsToProtoDictationSettings(dictationSettings: DictationSettings): ProtoDictationSettings {
	return ProtoDictationSettings.create({
		dictationEnabled: dictationSettings.dictationEnabled,
		dictationLanguage: dictationSettings.dictationLanguage,
	})
}
