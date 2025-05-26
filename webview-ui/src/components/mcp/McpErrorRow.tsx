import { useMemo } from "react"
import { formatRelative } from "date-fns"

import type { McpErrorEntry } from "@roo/mcp"

type McpErrorRowProps = {
	error: McpErrorEntry
}

export const McpErrorRow = ({ error }: McpErrorRowProps) => {
	const color = useMemo(() => {
		switch (error.level) {
			case "error":
				return "var(--vscode-testing-iconFailed)"
			case "warn":
				return "var(--vscode-charts-yellow)"
			case "info":
				return "var(--vscode-testing-iconPassed)"
		}
	}, [error.level])

	return (
		<div className="text-sm bg-vscode-textCodeBlock-background border-l-2 p-2" style={{ borderColor: color }}>
			<div className="mb-1" style={{ color }}>
				{error.message}
			</div>
			<div className="text-xs text-vscode-descriptionForeground">
				{formatRelative(error.timestamp, new Date())}
			</div>
		</div>
	)
}
