import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
	return (
		<div>
			<div className="flex items-center gap-2">
				<VSCodeCheckbox checked={checked} disabled={disabled} onChange={(e: any) => onChange(e.target.checked)}>
					{label}
				</VSCodeCheckbox>

				{description && (
					<Tooltip>
						<TooltipTrigger asChild>
							<i className="codicon codicon-info text-xs opacity-60 cursor-help hover:opacity-100 transition-opacity" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs" side="top">
							{description}
						</TooltipContent>
					</Tooltip>
				)}

				{badge && <SettingsBadge variant={badge.variant}>{badge.text}</SettingsBadge>}
			</div>

			{children}
		</div>
	)
}
