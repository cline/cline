import type { Preview } from "@storybook/react-vite"
import React from "react"

// Mock VSCode theme variables for Storybook
const mockVSCodeTheme = {
	"--vscode-editor-background": "#1e1e1e",
	"--vscode-editor-foreground": "#d4d4d4",
	"--vscode-sideBar-background": "#252526",
	"--vscode-editorGroup-border": "#444444",
	"--vscode-descriptionForeground": "#cccccc99",
	"--vscode-button-background": "#0e639c",
	"--vscode-button-foreground": "#ffffff",
	"--vscode-button-secondaryBackground": "#3c3c3c",
	"--vscode-textLink-foreground": "#3794ff",
	"--vscode-errorForeground": "#f48771",
	"--vscode-editorWidget-border": "#454545",
	"--vscode-editorError-foreground": "#f14c4c",
	"--vscode-diffEditor-removedTextBackground": "#9c353520",
	"--vscode-diffEditor-insertedTextBackground": "#9ccc6520",
	"--vscode-editor-font-family": 'Menlo, Monaco, "Courier New", monospace',
	"--vscode-editor-font-size": "12px",
	"--vscode-font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	"--vscode-font-size": "13px",
}

// Global decorator to apply VSCode-like styling
const withVSCodeTheme = (Story) => {
	React.useEffect(() => {
		// Apply CSS variables to the document root
		const root = document.documentElement
		Object.entries(mockVSCodeTheme).forEach(([property, value]) => {
			root.style.setProperty(property, value)
		})

		// Apply dark background to body
		document.body.style.backgroundColor = mockVSCodeTheme["--vscode-editor-background"]
		document.body.style.color = mockVSCodeTheme["--vscode-editor-foreground"]
		document.body.style.fontFamily = mockVSCodeTheme["--vscode-font-family"]
		document.body.style.fontSize = mockVSCodeTheme["--vscode-font-size"]

		return () => {
			// Cleanup on unmount
			Object.keys(mockVSCodeTheme).forEach((property) => {
				root.style.removeProperty(property)
			})
		}
	}, [])

	return React.createElement(
		"div",
		{
			style: {
				backgroundColor: mockVSCodeTheme["--vscode-editor-background"],
				color: mockVSCodeTheme["--vscode-editor-foreground"],
				fontFamily: mockVSCodeTheme["--vscode-font-family"],
				fontSize: mockVSCodeTheme["--vscode-font-size"],
				maxWidth: "80%",
				padding: "20px",
			},
		},
		React.createElement(Story),
	)
}

const preview: Preview = {
	parameters: {
		viewport: {
			viewports: [
				{
					name: "Editor Sidebar",
					styles: { width: "700px", height: "800px" },
					type: "desktop",
				},
			],
			defaultViewport: "Editor Sidebar",
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		backgrounds: {
			default: "vscode-dark",
			values: [
				{
					name: "vscode-dark",
					value: "#1e1e1e",
				},
				{
					name: "vscode-light",
					value: "#ffffff",
				},
			],
		},
		docs: {
			theme: {
				base: "dark",
				colorPrimary: "#3794ff",
				colorSecondary: "#0e639c",
				appBg: "#1e1e1e",
				appContentBg: "#252526",
				textColor: "#d4d4d4",
			},
		},
	},
	decorators: [withVSCodeTheme],
}

export default preview
