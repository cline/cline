import { memo, useEffect, useState } from "react"
import styled from "styled-components"

// Shimmer text styled component - applies shimmer effect after typing completes
const ShimmerSpan = styled.span`
	background: linear-gradient(
		90deg,
		var(--vscode-descriptionForeground) 40%,
		var(--vscode-foreground) 50%,
		var(--vscode-descriptionForeground) 60%
	);
	background-size: 200% 100%;
	-webkit-background-clip: text;
	background-clip: text;
	color: transparent;
	animation: var(--animate-shimmer);
`

// TypewriterText with shimmer effect after typing completes
export const TypewriterText = memo(({ text, speed = 30 }: { text: string; speed?: number }) => {
	const [displayedLength, setDisplayedLength] = useState(0)
	const [isComplete, setIsComplete] = useState(false)

	useEffect(() => {
		setDisplayedLength(0)
		setIsComplete(false)
		const interval = setInterval(() => {
			setDisplayedLength((prev) => {
				if (prev >= text.length) {
					clearInterval(interval)
					setIsComplete(true)
					return prev
				}
				return prev + 1
			})
		}, speed)

		return () => clearInterval(interval)
	}, [text, speed])

	// After typing completes, show shimmer effect instead of blinking cursor
	if (isComplete) {
		return <ShimmerSpan>{text}</ShimmerSpan>
	}

	return <div>{text.slice(0, displayedLength)}</div>
})
