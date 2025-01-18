export function highlightFzfMatch(
	text: string,
	positions: number[],
	highlightClassName: string = "history-item-highlight",
) {
	if (!positions.length) return text

	const parts: { text: string; highlight: boolean }[] = []
	let lastIndex = 0

	// Sort positions to ensure we process them in order
	positions.sort((a, b) => a - b)

	positions.forEach((pos) => {
		// Add non-highlighted text before this position
		if (pos > lastIndex) {
			parts.push({
				text: text.substring(lastIndex, pos),
				highlight: false,
			})
		}

		// Add highlighted character
		parts.push({
			text: text[pos],
			highlight: true,
		})

		lastIndex = pos + 1
	})

	// Add any remaining text
	if (lastIndex < text.length) {
		parts.push({
			text: text.substring(lastIndex),
			highlight: false,
		})
	}

	// Build final string
	return parts
		.map((part) => (part.highlight ? `<span class="${highlightClassName}">${part.text}</span>` : part.text))
		.join("")
}
