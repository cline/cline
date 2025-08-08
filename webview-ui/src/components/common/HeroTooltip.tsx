import React from "react"
import { Tooltip } from "@heroui/react"

interface HeroTooltipProps {
	content: React.ReactNode
	children: React.ReactNode
	className?: string
	delay?: number
	closeDelay?: number
	placement?: "top" | "bottom" | "left" | "right"
}

/**
 * HeroTooltip component that wraps the HeroUI tooltip with styling
 * similar to TaskTimelineTooltip
 */
const HeroTooltip: React.FC<HeroTooltipProps> = ({
	content,
	children,
	className,
	delay = 0,
	closeDelay = 500,
	placement = "top",
}) => {
	// If content is a simple string, wrap it in the tailwind styled divs
	const formattedContent =
		typeof content === "string" ? (
			<div
				className={`bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] 
      border border-[var(--vscode-widget-border)] rounded p-2 w-full shadow-md text-xs max-w-[250px] ${className}`}>
				<div
					className="whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto text-[11px] 
        font-[var(--vscode-editor-font-family)]  p-1 rounded">
					{content}
				</div>
			</div>
		) : (
			// If content is already a React node, assume it's pre-formatted
			content
		)

	return (
		<Tooltip
			content={formattedContent}
			delay={delay}
			closeDelay={0} // Immediate close when cursor moves away
			placement={placement}
			isDisabled={false}
			showArrow={false}
			disableAnimation={true} // Disable animation for immediate appearance/disappearance
			classNames={{
				content: "hero-tooltip-content pointer-events-none", // Prevent hovering over tooltip
			}}>
			{children}
		</Tooltip>
	)
}

export default HeroTooltip
