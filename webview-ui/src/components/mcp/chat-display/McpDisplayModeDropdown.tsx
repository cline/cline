import { McpDisplayMode } from "@shared/McpDisplayMode"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { useTranslation } from "react-i18next"

interface McpDisplayModeDropdownProps {
	value: McpDisplayMode
	onChange: (mode: McpDisplayMode) => void
	id?: string
	className?: string
	style?: React.CSSProperties
	onClick?: (e: React.MouseEvent) => void
}

const McpDisplayModeDropdown: React.FC<McpDisplayModeDropdownProps> = ({ value, onChange, id, className, style, onClick }) => {
	const { t } = useTranslation()

	const handleChange = (e: any) => {
		const newMode = e.target.value as McpDisplayMode
		onChange(newMode)
	}

	return (
		<VSCodeDropdown className={className} id={id} onChange={handleChange} onClick={onClick} style={style} value={value}>
			<VSCodeOption value="plain">{t("mcp.chat_display.plain_text")}</VSCodeOption>
			<VSCodeOption value="rich">{t("mcp.chat_display.rich_display")}</VSCodeOption>
			<VSCodeOption value="markdown">{t("mcp.chat_display.markdown")}</VSCodeOption>
		</VSCodeDropdown>
	)
}

export default McpDisplayModeDropdown
