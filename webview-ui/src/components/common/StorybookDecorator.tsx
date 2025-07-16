import React from "react"
import { ClineAuthProvider } from "@/context/ClineAuthContext"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import { ExtensionState } from "@shared/ExtensionMessage"
import { Decorator } from "@storybook/react-vite"
import { StorybookThemes } from "../../../.storybook/themes"

// Inner component that uses the context
const StorybookStateUpdater: React.FC<{
	children: React.ReactNode
	mockState?: Partial<ExtensionState>
}> = ({ mockState, children }) => {
	const { setExtensionStateForTest } = useExtensionState()

	// Set state when mockState changes
	React.useEffect(() => {
		if (mockState) {
			setExtensionStateForTest(mockState)
		}
	}, [mockState, setExtensionStateForTest])

	return <div className="container">{children}</div>
}

export const StorybookProvider: React.FC<{
	children: React.ReactNode
	mockState?: Partial<ExtensionState>
}> = ({ mockState, children }) => {
	return <StorybookStateUpdater mockState={mockState}>{children}</StorybookStateUpdater>
}

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

function VSCodeDecorator(className: string | undefined): Decorator {
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

export const VSCodeWebview = VSCodeDecorator("relative")
