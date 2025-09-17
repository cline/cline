import { heroui } from "@heroui/react"

export default heroui({
	defaultExtendTheme: "dark",
	themes: {
		light: {
			colors: {
				background: "var(--vscode-sidebar-background)",
				foreground: "var(--vscode-foreground)",
			},
		},
		dark: {
			colors: {
				background: "var(--vscode-sidebar-background)",
				foreground: "var(--vscode-foreground)",
			},
		},
	},
})
