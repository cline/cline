import { memo, useEffect, useState } from "react"

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
		return <span className="!bg-clip-text text-transparent bg-linear-to-r animate-shimmer"> {text}</span>
	}

	return <div>{text.slice(0, displayedLength)}</div>
})

TypewriterText.displayName = "TypewriterText"
