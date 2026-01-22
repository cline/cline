import { McpDisplayMode } from "@shared/McpDisplayMode"
import React from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface McpDisplayModeDropdownProps {
	value: McpDisplayMode
	onChange: (mode: McpDisplayMode) => void
	id?: string
	className?: string
	style?: React.CSSProperties
	onClick?: (e: React.MouseEvent) => void
}

const McpDisplayModeDropdown: React.FC<McpDisplayModeDropdownProps> = ({ value, onChange, id, className, style, onClick }) => {
	return (
		<Select onValueChange={onChange} value={value}>
			<SelectTrigger className={className} id={id} onClick={onClick} style={style}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="plain">Plain Text</SelectItem>
				<SelectItem value="rich">Rich Display</SelectItem>
				<SelectItem value="markdown">Markdown</SelectItem>
			</SelectContent>
		</Select>
	)
}

export default McpDisplayModeDropdown
