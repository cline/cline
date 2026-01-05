import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useRef } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const BlinkingCursor = () => (
	<span className="inline-block w-0.5 h-[1em] bg-current ml-0.5 mt-0.5 align-text-bottom animate-cursor-blink" />
)

interface ThinkingRowProps {
	showTitle: boolean
	reasoningContent?: string
	isVisible: boolean
	showCursor?: boolean
	showIcon?: boolean
	isExpanded: boolean
	onToggle?: () => void
}

export const ThinkingRow = memo(
	({ showTitle, reasoningContent, isVisible, showCursor = true, showIcon = true, isExpanded, onToggle }: ThinkingRowProps) => {
		const scrollRef = useRef<HTMLDivElement>(null)

		// Only auto-scroll to bottom during streaming (showCursor=true)
		// For expanded collapsed thinking, start at top
		useEffect(() => {
			if (scrollRef.current && isVisible && showCursor) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight
			}
		}, [reasoningContent, isVisible, showCursor])

		if (!isVisible) {
			return null
		}

		return (
			<div>
				{showTitle && (
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
				)}

				{isExpanded && (
					<Button
						className={cn(
							"flex gap-2 overflow-hidden w-full min-w-0 max-h-0 opacity-0 items-baseline justify-baseline text-left",
							{
								"max-h-[150px] opacity-100": isVisible,
								"transition-[max-height] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] [transition:max-height_250ms_cubic-bezier(0.4,0,0.2,1),opacity_150ms_ease-out]":
									isVisible,
							},
						)}
						onClick={onToggle}
						variant="text">
						{showIcon ? (
							<div className="inline-flex mt-1 mx-0 flex-shrink-0">
								<ClineLogoWhite className="size-3.5 scale-[0.8]" />
							</div>
						) : null}
						<div
							className={cn(
								"flex max-h-[150px] overflow-y-auto text-description leading-normal truncated whitespace-pre-wrap break-words flex-1 [scrollbar-width:none] [-ms-overflow-style:none] pl-3 border-l border-description/50 [&::-webkit-scrollbar]:hidden [direction:ltr] ml-1",
								{
									"ml-4": !showIcon,
								},
							)}
							ref={scrollRef}>
							<span>
								{reasoningContent}
								{isVisible && showCursor && <BlinkingCursor />}
							</span>
						</div>
					</Button>
				)}
			</div>
		)
	},
)

ThinkingRow.displayName = "ThinkingRow"
