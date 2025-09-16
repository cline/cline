import type { Decorator } from "@storybook/react-vite"
import React from "react"
import { ClineAuthProvider } from "@/context/ClineAuthContext"
import {
	ExtensionStateContext,
	ExtensionStateContextProvider,
	ExtensionStateContextType,
	useExtensionState,
} from "@/context/ExtensionStateContext"
import { StorybookThemes } from "../../.storybook/themes"

// Component that handles theme switching
const ThemeHandler: React.FC<{ children: React.ReactNode; theme?: string }> = ({ children, theme }) => {
	React.useEffect(() => {
		const styles = theme?.includes("light") ? StorybookThemes.light : StorybookThemes.dark

		// Apply CSS variables to the document root
		const root = document.documentElement
		Object.entries(styles).forEach(([property, value]) => {
			root.style.setProperty(property, value)
		})

		document.body.style.backgroundColor = styles["--vscode-editor-background"]
		document.body.style.color = styles["--vscode-editor-foreground"]
		document.body.style.fontFamily = styles["--vscode-font-family"]
		document.body.style.fontSize = styles["--vscode-font-size"]

		return () => {
			// Cleanup on unmount
			Object.keys(styles).forEach((property) => {
				root.style.removeProperty(property)
			})
		}
	}, [theme])

	return <>{children}</>
}
function StorybookDecoratorProvider(className = "relative"): Decorator {
	return (story, parameters) => {
		return (
			<div className={className}>
				<ExtensionStateContextProvider>
					<ClineAuthProvider>
						<ThemeHandler theme={parameters?.globals?.theme}>{React.createElement(story)}</ThemeHandler>
					</ClineAuthProvider>
				</ExtensionStateContextProvider>
			</div>
		)
	}
}

export const StorybookWebview = StorybookDecoratorProvider()

export const createStorybookDecorator = (overrideStates?: Partial<ExtensionStateContextType>) => (Story: any) => (
	<ExtensionStateContext.Provider
		value={{
			...useExtensionState(),
			...overrideStates,
		}}>
		<div className="max-w-lg m-x-auto">
			<Story />
		</div>
	</ExtensionStateContext.Provider>
)
