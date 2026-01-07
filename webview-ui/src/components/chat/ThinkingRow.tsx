import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useRef } from "react"
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

	// Only auto-scroll to bottom during streaming (showCursor=true)
	// For expanded collapsed thinking, start at top
	useEffect(() => {
		if (scrollRef.current && isVisible) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [reasoningContent, isVisible])

	if (!isVisible) {
		return null
	}

	return (
		<div className="ml-1">
			{showTitle ? (
				<Button
					className="inline-flex justify-baseline gap-0.5 text-left select-none cursor-pointer text-description px-0 w-full"
					onClick={onToggle}
					variant="icon">
					{isExpanded ? <ChevronDownIcon className="opacity-70" /> : <ChevronRightIcon className="opacity-70" />}
					<span className="font-semibold">Thinking:</span>
					<span className="italic break-words truncate [direction:rtl] w-full">
						{!isExpanded ? reasoningContent : ""}
					</span>
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
					<div
						className={cn(
							"flex max-h-[150px] overflow-y-auto text-description leading-normal truncated whitespace-pre-wrap break-words flex-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [direction:ltr]",
							{
								"pl-2 border-l border-description/50": showTitle,
							},
						)}
						ref={scrollRef}>
						<span>{reasoningContent}</span>
					</div>
				</Button>
			)}
		</div>
	)
})

ThinkingRow.displayName = "ThinkingRow"
