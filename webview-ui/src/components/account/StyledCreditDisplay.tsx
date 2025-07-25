import { useEffect, useRef, useState } from "react"
import { formatCreditsBalance } from "@/utils/format"

// Custom hook for animated credit display with styled decimals
const useAnimatedCredits = (targetValue: number, duration: number = 660) => {
	const [currentValue, setCurrentValue] = useState(0)
	const animationRef = useRef<number>()
	const startTimeRef = useRef<number>()

	useEffect(() => {
		const animate = (timestamp: number) => {
			if (!startTimeRef.current) {
				startTimeRef.current = timestamp
			}

			const elapsed = timestamp - startTimeRef.current
			const progress = Math.min(elapsed / duration, 1)

			// Easing function (ease-out)
			const easedProgress = 1 - (1 - progress) ** 3
			const newValue = easedProgress * targetValue

			setCurrentValue(newValue)

			if (progress < 1) {
				animationRef.current = requestAnimationFrame(animate)
			}
		}

		// Reset and start animation
		startTimeRef.current = undefined
		animationRef.current = requestAnimationFrame(animate)

		return () => {
			if (animationRef.current) {
				cancelAnimationFrame(animationRef.current)
			}
		}
	}, [targetValue, duration])

	return currentValue
}

// Custom component to handle styled credit display
export const StyledCreditDisplay = ({ balance }: { balance: number }) => {
	const animatedValue = useAnimatedCredits(formatCreditsBalance(balance))
	const formatted = animatedValue.toFixed(4)
	const parts = formatted.split(".")
	const wholePart = parts[0]
	const decimalPart = parts[1] || "0000"
	const firstTwoDecimals = decimalPart.slice(0, 2)
	const lastTwoDecimals = decimalPart.slice(2)

	return (
		<span className="font-azeret-mono font-light tabular-nums">
			{wholePart}.{firstTwoDecimals}
			<span className="text-[var(--vscode-descriptionForeground)]">{lastTwoDecimals}</span>
		</span>
	)
}
