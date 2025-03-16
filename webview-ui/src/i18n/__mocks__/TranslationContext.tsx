import React from "react"

// Create a mock for the useAppTranslation hook
export const useAppTranslation = () => {
	return {
		t: (key: string, options?: Record<string, any>) => {
			const translations: Record<string, string> = {
				// History translations
				"history:recentTasks": "Recent Tasks",
				"history:viewAll": "View All",
				"history:history": "History",
				"history:done": "Done",
				"history:searchPlaceholder": "Fuzzy search history...",
				"history:newest": "Newest",
				"history:oldest": "Oldest",
				"history:mostExpensive": "Most Expensive",
				"history:mostTokens": "Most Tokens",
				"history:mostRelevant": "Most Relevant",
				"history:deleteTaskTitle": "Delete Task (Shift + Click to skip confirmation)",
				"history:tokensLabel": "Tokens:",
				"history:cacheLabel": "Cache:",
				"history:apiCostLabel": "API Cost:",
				"history:copyPrompt": "Copy Prompt",
				"history:exportTask": "Export Task",
				"history:deleteTask": "Delete Task",
				"history:deleteTaskMessage": "Are you sure you want to delete this task? This action cannot be undone.",
				"history:cancel": "Cancel",
				"history:delete": "Delete",
			}

			// Handle interpolation
			if (options && key === "history:tokens") {
				return `Tokens: ↑${options.in} ↓${options.out}`
			}

			if (options && key === "history:cache") {
				return `Cache: +${options.writes} → ${options.reads}`
			}

			if (options && key === "history:apiCost") {
				return `API Cost: $${options.cost}`
			}

			return translations[key] || key
		},
		i18n: {
			language: "en",
			changeLanguage: jest.fn(),
		},
	}
}

export const withTranslation = (Component: React.ComponentType<any>) => {
	return (props: any) => <Component {...props} />
}

// Mock provider component
export const AppTranslationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <>{children}</>
}

const TranslationContext = { AppTranslationProvider, useAppTranslation, withTranslation }
export default TranslationContext
