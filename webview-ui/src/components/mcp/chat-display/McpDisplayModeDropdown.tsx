import { McpDisplayMode } from "@shared/McpDisplayMode"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React from "react"

interface McpDisplayModeDropdownProps {
	value: McpDisplayMode
	onChange: (mode: McpDisplayMode) => void
	id?: string
	className?: string
	style?: React.CSSProperties
	onClick?: (e: React.MouseEvent) => void
}

const McpDisplayModeDropdown: React.FC<McpDisplayModeDropdownProps> = ({ value, onChange, id, className, style, onClick }) => {
	const handleChange = (e: any) => {
		const newMode = e.target.value as McpDisplayMode
		onChange(newMode)
	}

	return (
		<VSCodeDropdown className={className} id={id} onChange={handleChange} onClick={onClick} style={style} value={value}>
			<VSCodeOption value="plain">Plain Text</VSCodeOption>
			<VSCodeOption value="rich">Rich Display</VSCodeOption>
			<VSCodeOption value="markdown">Markdown</VSCodeOption>
		</VSCodeDropdown>
	)
}

export default McpDisplayModeDropdown
