import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ThinkingRowProps {
	showTitle: boolean
	reasoningContent?: string
	isVisible: boolean
	isExpanded: boolean
	onToggle?: () => void
}

export const ThinkingRow = memo(({ showTitle = false, reasoningContent, isVisible, isExpanded, onToggle }: ThinkingRowProps) => {
	const scrollRef = useRef<HTMLDivElement>(null)
	const [canScrollDown, setCanScrollDown] = useState(false)

	const checkScrollable = useCallback(() => {
		if (scrollRef.current) {
			const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
			setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1)
		}
	}, [])

	// Only auto-scroll to bottom during streaming (showCursor=true)
	// For expanded collapsed thinking, start at top
	useEffect(() => {
		if (scrollRef.current && isVisible) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
		checkScrollable()
	}, [reasoningContent, isVisible, checkScrollable])

	if (!isVisible) {
		return null
	}

	// Don't render anything if collapsed and no title (nothing to show)
	if (!isExpanded && !showTitle) {
		return null
	}

	return (
		<div className="ml-1 pl-0 mb-1 -mt-1.25">
			{showTitle ? (
				<Button
					className="inline-flex justify-baseline gap-0.5 text-left select-none cursor-pointer px-0 w-full"
					onClick={onToggle}
					variant="icon">
					<span>Thoughts</span>
					{isExpanded ? (
						<ChevronDownIcon className="!size-1 text-foreground" />
					) : (
						<ChevronRightIcon className="!size-1 text-foreground" />
					)}
				</Button>
			) : null}

			{isExpanded && (
				<Button
					className={cn(
						"flex gap-0 overflow-hidden w-full min-w-0 max-h-0 opacity-0 items-baseline justify-baseline text-left p-0",
						"disabled:cursor-text disabled:opacity-100",
						{
							"max-h-[200px] opacity-100": isVisible,
							"transition-[max-height] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] [transition:max-height_250ms_cubic-bezier(0.4,0,0.2,1),opacity_150ms_ease-out]":
								isVisible,
						},
					)}
					disabled={!showTitle}
					onClick={onToggle}
					variant="text">
					<div className="relative flex-1">
						<div
							className={cn(
								"flex max-h-[150px] overflow-y-auto text-description leading-normal truncated whitespace-pre-wrap break-words [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [direction:ltr]",
								"pl-2 border-l border-description/50",
							)}
							onScroll={checkScrollable}
							ref={scrollRef}>
							<span className="pb-2 block text-xs">{reasoningContent}</span>
						</div>
						{canScrollDown && (
							<div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-background to-transparent" />
						)}
					</div>
				</Button>
			)}
		</div>
	)
})

ThinkingRow.displayName = "ThinkingRow"
