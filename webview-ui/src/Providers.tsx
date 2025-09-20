import { ConfigProvider } from "antd"
import type React from "react"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"

// Ant Design 自定义主题配置，适配 VS Code 主题
const antdTheme = {
	token: {
		colorPrimary: "#007acc", // VS Code 主色调
		colorBgContainer: "var(--vscode-editor-background)",
		colorBgElevated: "var(--vscode-sideBar-background)",
		colorText: "var(--vscode-foreground)",
		colorTextSecondary: "var(--vscode-descriptionForeground)",
		colorBorder: "var(--vscode-focusBorder)",
		colorFillAlter: "var(--vscode-sideBar-background)",
		borderRadius: 4,
	},
	components: {
		Button: {
			colorPrimaryHover: "#005a9e",
			colorPrimaryActive: "#004c87",
		},
		Input: {
			colorBgContainer: "var(--vscode-input-background)",
			colorBorder: "var(--vscode-input-border)",
			colorText: "var(--vscode-input-foreground)",
			colorTextPlaceholder: "var(--vscode-input-placeholderForeground)",
		},
		Select: {
			colorBgContainer: "var(--vscode-input-background)",
			colorBorder: "var(--vscode-input-border)",
			colorText: "var(--vscode-input-foreground)",
		},
		Card: {
			colorBgContainer: "var(--vscode-sideBar-background)",
			colorBorderSecondary: "var(--vscode-panel-border)",
		},
	},
}

interface ProvidersProps {
	children: React.ReactNode
}

export const Providers = ({ children }: ProvidersProps) => {
	return (
		<ConfigProvider theme={antdTheme}>
			<ClineAuthProvider>
				<ExtensionStateContextProvider>{children}</ExtensionStateContextProvider>
			</ClineAuthProvider>
		</ConfigProvider>
	)
}
