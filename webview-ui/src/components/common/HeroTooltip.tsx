import { cn, Tooltip } from "@heroui/react"
import React, { useMemo } from "react"

interface HeroTooltipProps {
	content: React.ReactNode
	children: React.ReactNode
	className?: string
	delay?: number
	closeDelay?: number
	placement?: "top" | "bottom" | "left" | "right"
	showArrow?: boolean
	disabled?: boolean
}

/**
 * HeroTooltip component that wraps the HeroUI tooltip with styling
 * similar to TaskTimelineTooltip
 */
const HeroTooltip: React.FC<HeroTooltipProps> = ({
	content,
	children,
	className,
	showArrow = false,
	delay = 0,
	closeDelay = 500,
	placement = "top",
	disabled = false,
}) => {
	// If content is a simple string, wrap it in the tailwind styled divs
	const formattedContent = useMemo(() => {
		return typeof content === "string" ? (
			<div
				className={cn(
					"bg-code-background text-code-foreground border border-code-foreground/20 rounded shadow-md max-w-[250px] text-sm",
					className,
					"p-2",
				)}>
				<span className="whitespace-pre-wrap break-words overflow-y-auto">{content}</span>
			</div>
		) : (
			// If content is already a React node, assume it's pre-formatted
			content
		)
	}, [content, className])

	return (
		<Tooltip
			classNames={{
				content: "hero-tooltip-content pointer-events-none", // Prevent hovering over tooltip
			}}
			closeDelay={closeDelay}
			content={formattedContent} // Immediate close when cursor moves away
			delay={delay}
			disableAnimation={true}
			isDisabled={disabled}
			placement={placement} // Disable animation for immediate appearance/disappearance
			showArrow={showArrow}>
			{children}
		</Tooltip>
	)
}

export default HeroTooltip
