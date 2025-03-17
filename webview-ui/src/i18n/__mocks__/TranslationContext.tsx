import React, { createContext, useContext, ReactNode } from "react"

// Mock translation function that returns English text for settings or the key itself
const mockTranslate = (key: string, options?: Record<string, any>): string => {
	// Convert the key back to approximate English text for test purposes
	if (key.startsWith("settings.")) {
		// For specific keys the tests are looking for
		if (key === "settings.notifications.sound.label") return "Enable sound effects"
		if (key === "settings.autoApprove.execute.label") return "Always approve allowed execute operations"
		if (key === "settings.autoApprove.execute.allowedCommands") return "Allowed Auto-Execute Commands"
		if (key === "settings.autoApprove.execute.commandPlaceholder") return "Enter command prefix"
		if (key === "settings.autoApprove.execute.addButton") return "Add"
		if (key === "settings.common.save") return "Save"
		if (key === "settings.contextManagement.terminal.label") return "Terminal output limit"
		if (key === "settings.header.title") return "Settings"

		// Default handling of other keys
		return key.split(".").pop() || key
	}

	// For keys that contain variables
	if (options) {
		let result = key
		Object.entries(options).forEach(([varName, value]) => {
			result = result.replace(`{${varName}}`, String(value))
		})
		return result
	}

	return key
}

// Create mock context
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: any
}>({
	t: mockTranslate,
	i18n: {},
})

// Mock translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	return (
		<TranslationContext.Provider
			value={{
				t: mockTranslate,
				i18n: {},
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

// Custom hook for translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider
