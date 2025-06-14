import React from "react"

interface ChecklistRendererProps {
	text: string
}

interface ChecklistItem {
	checked: boolean
	text: string
}

const ChecklistRenderer: React.FC<ChecklistRendererProps> = ({ text }) => {
	const parseChecklistItems = (text: string): ChecklistItem[] => {
		const lines = text.split("\n").filter((line) => line.trim())
		const items: ChecklistItem[] = []

		for (const line of lines) {
			const trimmedLine = line.trim()
			// Match patterns like "- [x] text" or "- [ ] text"
			const match = trimmedLine.match(/^-\s*\[([ x])\]\s*(.+)$/)
			if (match) {
				const checked = match[1] === "x"
				const text = match[2].trim()
				items.push({ checked, text })
			}
		}

		return items
	}

	const items = parseChecklistItems(text)

	if (items.length === 0) {
		// If no checklist items found, return the original text
		return <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "2px",
				fontSize: "12px",
				lineHeight: "1.3",
			}}>
			{items.map((item, index) => (
				<div
					key={index}
					style={{
						display: "flex",
						alignItems: "flex-start",
						gap: "6px",
						padding: "1px 0",
					}}>
					<span
						style={{
							fontSize: "11px",
							color: item.checked ? "var(--vscode-charts-green)" : "var(--vscode-descriptionForeground)",
							flexShrink: 0,
							marginTop: "1px",
						}}>
						{item.checked ? "✓" : "○"}
					</span>
					<span
						style={{
							color: item.checked ? "var(--vscode-descriptionForeground)" : "inherit",
							textDecoration: item.checked ? "line-through" : "none",
							opacity: item.checked ? 0.7 : 1,
							fontSize: "12px",
							wordBreak: "break-word",
							overflowWrap: "anywhere",
							lineHeight: "1.3",
						}}>
						{item.text}
					</span>
				</div>
			))}
		</div>
	)
}

export default ChecklistRenderer
