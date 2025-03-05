import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
}

export const SectionHeader = ({ description, children, className, ...props }: SectionHeaderProps) => (
	<div className={cn("sticky top-0 z-10 bg-vscode-panel-border px-5 py-4", className)} {...props}>
		<h4 className="m-0">{children}</h4>
		{description && <p className="text-vscode-descriptionForeground text-sm mt-2 mb-0">{description}</p>}
	</div>
)
