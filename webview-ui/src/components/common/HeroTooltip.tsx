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
	showArrow = true,
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
					"bg-code-background text-code-foreground/80 border border-code-foreground/20 rounded shadow-md max-w-[250px] text-sm",
					className,
					"px-2 py-1 bg-menu text-xs m-0",
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
				base: "p-0 m-0",
			}}
			closeDelay={closeDelay}
			content={formattedContent} // Immediate close when cursor moves away
			delay={delay}
			isDisabled={disabled}
			placement={placement} // Disable animation for immediate appearance/disappearance
			showArrow={showArrow}>
			<div className="m-0">{children}</div>
		</Tooltip>
	)
}

export default HeroTooltip
