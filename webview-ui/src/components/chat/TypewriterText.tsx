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
		return (
			<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-base font-regular text-transparent">
				{text}
			</span>
		)
	}

	return <div>{text.slice(0, displayedLength)}</div>
})

TypewriterText.displayName = "TypewriterText"
