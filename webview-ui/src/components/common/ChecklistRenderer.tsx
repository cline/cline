import { parseFocusChainItem } from "@shared/focus-chain-utils"
import React, { useCallback, useEffect, useRef, useState } from "react"

interface ChecklistRendererProps {
	text: string
}

interface ChecklistItem {
	checked: boolean
	text: string
}

const ChecklistRenderer: React.FC<ChecklistRendererProps> = ({ text }) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const [lastCompletedIndex, setLastCompletedIndex] = useState(-1)
	const [isUserScrolling, setIsUserScrolling] = useState(false)
	const scrollTimeoutRef = useRef<NodeJS.Timeout>()

	const parseChecklistItems = (text: string): ChecklistItem[] => {
		const lines = text.split("\n").filter((line) => line.trim())
		const items: ChecklistItem[] = []

		for (const line of lines) {
			const trimmedLine = line.trim()
			const parsed = parseFocusChainItem(trimmedLine)
			if (parsed) {
				items.push({ checked: parsed.checked, text: parsed.text })
			}
		}

		return items
	}

	const items = parseChecklistItems(text)

	// Handle user scroll detection
	// This prevents jumpy scrolling when the task is streaming and users are viewing the focus chain list
	const handleScroll = useCallback(() => {
		setIsUserScrolling(true)
		if (scrollTimeoutRef.current) {
			clearTimeout(scrollTimeoutRef.current)
		}
		scrollTimeoutRef.current = setTimeout(() => {
			setIsUserScrolling(false)
		}, 1000) // Reset after 1 second of no scrolling
	}, [])

	// Auto-scroll to show the most recently completed item when in scroll mode
	useEffect(() => {
		if (items.length >= 10 && containerRef.current && !isUserScrolling) {
			// Find the last completed item
			let currentLastCompletedIndex = -1
			for (let i = items.length - 1; i >= 0; i--) {
				if (items[i].checked) {
					currentLastCompletedIndex = i
					break
				}
			}

			// Only auto-scroll if there's a new completion or first time
			if (currentLastCompletedIndex >= 0 && currentLastCompletedIndex !== lastCompletedIndex) {
				setLastCompletedIndex(currentLastCompletedIndex)

				// Use scrollIntoView for more accurate positioning
				const container = containerRef.current
				const itemElements = container.children
				if (itemElements[currentLastCompletedIndex]) {
					itemElements[currentLastCompletedIndex].scrollIntoView({
						behavior: "smooth",
						block: "start",
					})
				}
			}
		}
	}, [items, lastCompletedIndex, isUserScrolling])

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current)
			}
		}
	}, [])

	if (items.length === 0) {
		// If no checklist items found, return the original text
		return <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
	}

	return (
		<div
			onScroll={handleScroll}
			ref={containerRef}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "2px",
				fontSize: "12px",
				lineHeight: "1.3",
				maxHeight: items.length >= 10 ? "200px" : "auto",
				overflowY: items.length >= 10 ? "auto" : "visible",
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
