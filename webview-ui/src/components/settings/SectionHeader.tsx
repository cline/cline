import { cn } from "@heroui/theme"
import { HTMLAttributes } from "react"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
	variant?: "page" | "category"
}

export const SectionHeader = ({ description, children, className, variant = "page", ...props }: SectionHeaderProps) => {
	if (variant === "category") {
		return (
			<div className={cn("mb-4 mt-6 first:mt-0", className)} {...props}>
				<h4
					className="text-[11px] font-semibold uppercase tracking-wide mb-2"
					style={{ color: "var(--vscode-descriptionForeground)" }}>
					{children}
				</h4>
				{description && (
					<p className="text-xs mt-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
						{description}
					</p>
				)}
			</div>
		)
	}

	// Default page header variant
	return (
		<div className={cn("text-foreground px-5 py-3", className)} {...props}>
			<h2 className="m-0 text-base">{children}</h2>
			{description && <p className="text-description text-sm mt-2 mb-0">{description}</p>}
		</div>
	)
}

export default SectionHeader
