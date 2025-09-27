import React from "react"

interface LightMarkdownProps {
	text: string
	compact?: boolean
}

/**
 * Super-lightweight emphasis parser.
 * Scope:
 * - Supported: bold (**text**), italic (*text*)
 * - Not supported: headers, links, code, lists, HTML, full Markdown spec
 * - Underscore-based emphasis is intentionally NOT supported to avoid snake_case false positives
 * - Unmatched markers render literally
 *
 * Design goals:
 * - O(n) single-pass scanning with minimal allocations
 * - No recursive substring tail mutation
 * - Memoize parsed output to avoid recomputation on parent re-renders
 */

// Parse inline emphasis for a single line of text.
// Supports nested emphasis in a simple way by parsing inner segments recursively.
// Returns an array of strings and React elements (<strong>, <em>).
function parseInlineEmphasis(text: string, nextKey: () => string): React.ReactNode[] {
	const out: React.ReactNode[] = []
	const len = text.length

	// Fast path: if no '*' at all, return as a single text segment
	const firstStar = text.indexOf("*")
	if (firstStar === -1) {
		out.push(text)
		return out
	}

	let i = 0
	let segmentStart = 0

	while (i < len) {
		const starIdx = text.indexOf("*", i)
		if (starIdx === -1) {
			// push trailing literal
			if (segmentStart < len) {
				out.push(text.slice(segmentStart, len))
			}
			break
		}

		// Check for bold start (**)
		if (starIdx + 1 < len && text[starIdx + 1] === "*") {
			const contentStart = starIdx + 2
			const endIdx = text.indexOf("**", contentStart)
			if (endIdx !== -1 && endIdx > contentStart) {
				// flush literal before match
				if (segmentStart < starIdx) {
					out.push(text.slice(segmentStart, starIdx))
				}
				const inner = text.slice(contentStart, endIdx)
				// Allow simple nested emphasis by parsing inner content
				const children = parseInlineEmphasis(inner, nextKey)
				out.push(<strong key={nextKey()}>{children}</strong>)
				i = endIdx + 2
				segmentStart = i
				continue
			} else {
				// unmatched bold opener - treat the first '*' as literal and continue
				i = starIdx + 1
				continue
			}
		}

		// Italic start (*)
		const contentStart = starIdx + 1
		const endIdx = text.indexOf("*", contentStart)
		if (endIdx !== -1 && endIdx > contentStart) {
			// flush literal before match
			if (segmentStart < starIdx) {
				out.push(text.slice(segmentStart, starIdx))
			}
			const inner = text.slice(contentStart, endIdx)
			// Allow simple nested emphasis by parsing inner content
			const children = parseInlineEmphasis(inner, nextKey)
			out.push(<em key={nextKey()}>{children}</em>)
			i = endIdx + 1
			segmentStart = i
		} else {
			// unmatched italic opener - treat '*' as literal and continue
			i = starIdx + 1
		}
	}

	return out
}

// Split by lines and compose inline nodes.
// compact=false: each line becomes a block-level span
// compact=true: inline-only across lines, with no additional separators (preserves prior behavior)
function parseTextToNodes(text: string, compact: boolean): React.ReactNode {
	// Global fast path: if no '*' anywhere, short-circuit
	if (text.indexOf("*") === -1) {
		if (compact) {
			// Return as a single text node (no extra wrappers)
			return text
		}
		// Non-compact: render each line as block span for layout consistency
		const lines = text.split(/\r?\n/)
		let keyCounter = 0
		const nextKey = () => `lm-${keyCounter++}`
		return (
			<React.Fragment>
				{lines.map((line) => (
					<span key={nextKey()} style={{ display: "block" }}>
						{line}
					</span>
				))}
			</React.Fragment>
		)
	}

	const lines = text.split(/\r?\n/)
	let keyCounter = 0
	const nextKey = () => `lm-${keyCounter++}`

	if (compact) {
		// Flatten inline nodes across lines; no extra separators to preserve minimalism
		const flat: React.ReactNode[] = []
		for (let li = 0; li < lines.length; li++) {
			const inlineNodes = parseInlineEmphasis(lines[li], nextKey)
			for (let j = 0; j < inlineNodes.length; j++) {
				const node = inlineNodes[j]
				// Ensure each node in the top-level array has a key to avoid React key warnings
				if (React.isValidElement(node)) {
					flat.push(node.key == null ? React.cloneElement(node, { key: nextKey() }) : node)
				} else {
					// Wrap strings in keyed fragment (no extra DOM)
					flat.push(<React.Fragment key={nextKey()}>{node}</React.Fragment>)
				}
			}
		}
		return <>{flat}</>
	} else {
		// Block-level lines; keys applied at line level
		return (
			<React.Fragment>
				{lines.map((line) => (
					<span key={nextKey()} style={{ display: "block" }}>
						{parseInlineEmphasis(line, nextKey)}
					</span>
				))}
			</React.Fragment>
		)
	}
}

const LightMarkdown: React.FC<LightMarkdownProps> = ({ text, compact = false }) => {
	if (!text) {
		return null
	}

	// Memoize parsed output; recompute only when inputs change
	const content = React.useMemo(() => parseTextToNodes(text, compact), [text, compact])

	return <>{content}</>
}

export default React.memo(LightMarkdown)
