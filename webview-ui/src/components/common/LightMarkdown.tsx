import React from "react"

// Pre-compiled regex patterns to avoid recreation on each render
const BOLD_REGEX = /\*\*(.*?)\*\*|__(.*?)__/g
const ITALIC_REGEX = /\*(.*?)\*|_(.*?)_/g

interface LightMarkdownProps {
	text: string
	compact?: boolean
}

/**
 * Ultra-lightweight markdown renderer that supports bold, italic, and headers.
 * Memory-efficient alternative to MarkdownBlock for simple formatting needs.
 * Uses cached regex patterns and direct React element creation to minimize allocations.
 */
const LightMarkdown: React.FC<LightMarkdownProps> = ({ text, compact = false }) => {
	if (!text) {
		return null
	}

	const parseText = (input: string): React.ReactNode[] => {
		const elements: React.ReactNode[] = []
		let key = 0

		// Split by lines to handle headers
		const lines = input.split("\n")

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			// Check if line is a header
			const headerMatch = line.match(/^(#{1,6})\s+(.*)$/)
			if (headerMatch) {
				const level = headerMatch[1].length
				const headerText = headerMatch[2]
				const HeaderTag = `h${level}` as keyof JSX.IntrinsicElements

				elements.push(
					React.createElement(
						HeaderTag,
						{
							key: key++,
							style: {
								margin: compact ? "0" : undefined,
								fontSize: level === 1 ? "1.2em" : level === 2 ? "1.1em" : "1em",
								fontWeight: "bold",
							},
						},
						parseInlineText(headerText),
					),
				)
			} else {
				// Parse regular line with inline formatting
				const parsedLine = parseInlineText(line)
				if (parsedLine.length > 0) {
					if (compact) {
						elements.push(
							...parsedLine.map((el, idx) => {
								// Handle both React elements and strings
								if (React.isValidElement(el)) {
									return React.cloneElement(el as React.ReactElement, { key: key++ })
								} else {
									return <span key={key++}>{el}</span>
								}
							}),
						)
					} else {
						elements.push(
							<span key={key++} style={{ display: "block" }}>
								{parsedLine}
							</span>,
						)
					}
				}
			}
		}

		return elements
	}

	const parseInlineText = (input: string): React.ReactNode[] => {
		const elements: React.ReactNode[] = []
		let remaining = input
		let key = 0

		// Process bold text first
		while (true) {
			BOLD_REGEX.lastIndex = 0 // Reset regex state
			const boldMatch = BOLD_REGEX.exec(remaining)

			if (!boldMatch) {
				break
			}

			// Add text before match
			if (boldMatch.index > 0) {
				elements.push(remaining.substring(0, boldMatch.index))
			}

			// Add bold element
			const boldText = boldMatch[1] || boldMatch[2]
			elements.push(<strong key={`bold-${key++}`}>{parseItalicText(boldText)}</strong>)

			// Update remaining text
			remaining = remaining.substring(boldMatch.index + boldMatch[0].length)
		}

		// If no bold matches, process the entire remaining text for italics
		if (elements.length === 0) {
			return parseItalicText(remaining)
		} else {
			// Process remaining text for italics
			if (remaining) {
				elements.push(...parseItalicText(remaining))
			}
		}

		return elements
	}

	const parseItalicText = (input: string): React.ReactNode[] => {
		const elements: React.ReactNode[] = []
		let remaining = input
		let key = 0

		while (true) {
			ITALIC_REGEX.lastIndex = 0 // Reset regex state
			const italicMatch = ITALIC_REGEX.exec(remaining)

			if (!italicMatch) {
				break
			}

			// Add text before match
			if (italicMatch.index > 0) {
				elements.push(remaining.substring(0, italicMatch.index))
			}

			// Add italic element
			const italicText = italicMatch[1] || italicMatch[2]
			elements.push(<em key={`italic-${key++}`}>{italicText}</em>)

			// Update remaining text
			remaining = remaining.substring(italicMatch.index + italicMatch[0].length)
		}

		// Add any remaining text
		if (remaining) {
			elements.push(remaining)
		}

		// If no matches found, return original text
		if (elements.length === 0) {
			return [input]
		}

		return elements
	}

	return <>{parseText(text)}</>
}

export default LightMarkdown
