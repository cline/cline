import { memo, useEffect, useRef, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"

const BlinkingCursor = () => (
	<span className="inline-block w-0.5 h-[1em] bg-current ml-0.5 mt-0.5 align-text-bottom animate-cursor-blink" />
)

export const ThinkingRow = memo(
	({
		reasoningContent,
		isVisible,
		showCursor = true,
		showIcon = true,
		instant = false,
	}: {
		reasoningContent?: string
		isVisible: boolean
		showCursor?: boolean
		showIcon?: boolean
		instant?: boolean
	}) => {
		const scrollRef = useRef<HTMLDivElement>(null)
		const [shouldRender, setShouldRender] = useState(isVisible)

		// Only auto-scroll to bottom during streaming (showCursor=true)
		// For expanded collapsed thinking, start at top
		useEffect(() => {
			if (scrollRef.current && isVisible && showCursor) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight
			}
		}, [reasoningContent, isVisible, showCursor])

		useEffect(() => {
			if (isVisible) {
				setShouldRender(true)
			} else if (instant) {
				// Instant unmount for streaming thinking - no delay
				setShouldRender(false)
			} else {
				// Delayed unmount for user-toggled expanded thinking (animation)
				const timer = setTimeout(() => setShouldRender(false), 250)
				return () => clearTimeout(timer)
			}
		}, [isVisible, instant])

		if (!shouldRender) {
			return null
		}

		return (
			<div
				className={`flex items-start gap-2 overflow-hidden w-full min-w-0 ${
					isVisible ? "max-h-[150px] opacity-100" : "max-h-0 opacity-0"
				} ${instant ? "" : "transition-[max-height] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] [transition:max-height_250ms_cubic-bezier(0.4,0,0.2,1),opacity_150ms_ease-out]"}`}>
				{showIcon && (
					<div className="mt-1 shrink-0">
						<ClineLogoWhite className="size-3.5 scale-110 animate-icon-pulse" />
					</div>
				)}
				<div
					className="flex items-start max-h-[150px] overflow-y-auto text-[var(--vscode-descriptionForeground)] leading-normal whitespace-pre-wrap break-words flex-1 [scrollbar-width:none] [-ms-overflow-style:none] pl-2 border-l border-white/10 [&::-webkit-scrollbar]:hidden"
					ref={scrollRef}>
					{reasoningContent}
					{isVisible && showCursor && <BlinkingCursor />}
				</div>
			</div>
		)
	},
)
