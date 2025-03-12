import React, { ReactNode } from "react"
import i18next from "./setup"

// Create a mock context
export const TranslationContext = React.createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}>({
	t: (key: string, options?: Record<string, any>) => {
		// Handle specific test cases
		if (key === "settings.autoApprove.title") {
			return "Auto-Approve"
		}
		if (key === "notifications.error" && options?.message) {
			return `Operation failed: ${options.message}`
		}
		return key // Default fallback
	},
	i18n: i18next,
})

// Mock translation provider
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	return (
		<TranslationContext.Provider
			value={{
				t: (key: string, options?: Record<string, any>) => {
					// Handle specific test cases
					if (key === "settings.autoApprove.title") {
						return "Auto-Approve"
					}
					if (key === "notifications.error" && options?.message) {
						return `Operation failed: ${options.message}`
					}
					return key // Default fallback
				},
				i18n: i18next,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

// Custom hook for easy translations
export const useAppTranslation = () => React.useContext(TranslationContext)

export default TranslationProvider
