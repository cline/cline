import i18next from "i18next"
import { initReactI18next } from "react-i18next"

/**
 * Sets up i18next for testing with pre-defined translations.
 * Use this in test files to ensure consistent translation handling.
 */
export const setupI18nForTests = () => {
	i18next.use(initReactI18next).init({
		lng: "en",
		fallbackLng: "en",
		debug: false,
		interpolation: {
			escapeValue: false,
		},
		// Pre-define all translations needed for tests
		resources: {
			en: {
				settings: {
					autoApprove: {
						title: "Auto-Approve",
					},
				},
				common: {
					notifications: {
						error: "Operation failed: {{message}}",
					},
				},
				chat: {
					test: "Test",
				},
			},
		},
	})

	return i18next
}
