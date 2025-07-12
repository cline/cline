import { DictationSettings as ProtoDictationSettings } from "../../proto/state"
import { DictationSettings } from "../../DictationSettings"

/**
 * Converts proto DictationSettings to TypeScript DictationSettings
 */
export function convertProtoDictationSettingsToDictationSettings(
	protoDictationSettings: ProtoDictationSettings,
): DictationSettings {
	return {
		voiceRecordingEnabled: protoDictationSettings.voiceRecordingEnabled,
		dictationLanguage: protoDictationSettings.dictationLanguage,
	}
}

/**
 * Converts TypeScript DictationSettings to proto DictationSettings
 */
export function convertDictationSettingsToProtoDictationSettings(dictationSettings: DictationSettings): ProtoDictationSettings {
	return ProtoDictationSettings.create({
		voiceRecordingEnabled: dictationSettings.voiceRecordingEnabled,
		dictationLanguage: dictationSettings.dictationLanguage,
	})
}
