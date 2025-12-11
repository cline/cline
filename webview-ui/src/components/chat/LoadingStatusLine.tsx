import React, { memo, useMemo } from "react"
import styled, { css, keyframes } from "styled-components"

// Animations
const pulse = keyframes`
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
`

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`

// State types
export type LoadingState = "pre" | "thinking" | "final" | "error"

interface LoadingStatusLineProps {
	state: LoadingState
	text: string
	mode?: "plan" | "act"
}

// Styled components
const Line = styled.div<{ $state: LoadingState }>`
	display: flex;
	align-items: flex-start;
	gap: 10px;
	min-height: 20px;
	position: relative;
`

const Text = styled.div<{ $state: LoadingState }>`
	flex: 1;
	min-width: 0;
	position: relative;
	color: var(--vscode-descriptionForeground);
	font-style: italic;
	line-height: 1.4;

	${({ $state }) =>
		$state === "pre" &&
		css`
			animation: ${pulse} 1.8s ease-in-out infinite;
		`}

	${({ $state }) =>
		$state === "thinking" &&
		css`
			background: linear-gradient(
				90deg,
				var(--vscode-descriptionForeground) 0%,
				var(--vscode-descriptionForeground) 40%,
				rgba(255, 255, 255, 0.3) 50%,
				var(--vscode-descriptionForeground) 60%,
				var(--vscode-descriptionForeground) 100%
			);
			background-size: 200% 100%;
			-webkit-background-clip: text;
			background-clip: text;
			animation: ${shimmer} 2s infinite linear;
		`}
`

/**
 * Parse thinking text to extract only the latest sentence or fragment.
 * This creates a rolling single-sentence display effect.
 */
export function parseThinkingText(raw: string): string {
	if (!raw) return ""

	const text = raw
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/_([^_]+)_/g, "$1")
		.replace(/\s+/g, " ")
		.trim()

	if (!text) return ""

	const sentences = text.split(/(?<=[.!?])\s+/)

	for (let i = sentences.length - 1; i >= 0; i--) {
		const sentence = sentences[i].trim()
		if (sentence) {
			return sentence
		}
	}

	return text
}

/**
 * Single-line loading status component for thinking tokens.
 * Shows only the latest sentence from the thinking stream.
 * States: pre (waiting) → thinking (streaming) → final/error (done)
 */
const LoadingStatusLine: React.FC<LoadingStatusLineProps> = ({ state, text, mode = "act" }) => {
	const displayText = useMemo(() => {
		if (state === "pre") {
			return mode === "plan" ? "Planning…" : "Acting…"
		}
		if (state === "thinking") {
			return parseThinkingText(text) || (mode === "plan" ? "Planning…" : "Acting…")
		}
		// For final state, show the last sentence (static, no animation)
		if (state === "final" && text) {
			return parseThinkingText(text)
		}
		return ""
	}, [state, text, mode])

	// Don't render for error state (error row handles that)
	// Don't render if final and no text
	if (state === "error" || (state === "final" && !text)) {
		return null
	}

	return (
		<Line $state={state}>
			<Text $state={state}>{displayText}</Text>
		</Line>
	)
}

export default memo(LoadingStatusLine)
