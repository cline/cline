import React, { useState } from "react"
import { Toggle } from "@/components/ui/toggle"
import { SettingsBadge } from "./SettingsBadge"

type SettingsBadgeVariant = "experimental" | "new" | "dangerous" | "recommended"

interface FeatureItemProps {
	label: string
	checked: boolean | undefined
	disabled?: boolean
	onChange: (checked: boolean) => void
	description?: string
	badge?: {
		text: string
		variant: SettingsBadgeVariant
	}
	children?: React.ReactNode
}

export const FeatureItem: React.FC<FeatureItemProps> = ({
	label,
	checked,
	disabled = false,
	onChange,
	description,
	badge,
	children,
}) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const isExpandable = !!(description || children)

	const handleRowClick = (e: React.MouseEvent) => {
		// Don't toggle if clicking on the toggle switch itself
		if ((e.target as HTMLElement).closest('[role="switch"]')) {
			return
		}
		if (isExpandable) {
			setIsExpanded(!isExpanded)
		}
	}

	return (
		<div>
			<div
				className={`flex items-center justify-between w-full gap-3 py-2 px-2 -mx-2 relative group ${
					isExpandable ? "cursor-pointer" : ""
				}`}
				onClick={handleRowClick}>
				{/* Left side: Label, chevron, badge */}
				<div className="flex items-center gap-2 flex-1 min-w-0">
					{isExpandable && (
						<i
							className={`codicon codicon-chevron-right text-xs transition-transform ${
								isExpanded ? "rotate-90" : ""
							}`}
							style={{ color: "var(--vscode-descriptionForeground)" }}
						/>
					)}

					<span
						className={`text-sm transition-opacity ${isExpandable ? "opacity-60 group-hover:opacity-100" : ""}`}
						style={{ color: "var(--vscode-foreground)" }}>
						{label}
					</span>

					{badge && <SettingsBadge variant={badge.variant}>{badge.text}</SettingsBadge>}
				</div>

				{/* Right side: Toggle switch */}
				<Toggle checked={checked ?? false} disabled={disabled} onCheckedChange={onChange} />
			</div>

			{/* Expanded content */}
			{isExpandable && isExpanded && (
				<div className="mt-2 pl-8 pr-2 pb-2">
					{description && (
						<p
							className="text-xs mb-2"
							style={{
								color: "var(--vscode-descriptionForeground)",
								lineHeight: "1.5",
							}}>
							{description}
						</p>
					)}
					{children}
				</div>
			)}
		</div>
	)
}
