import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type TabProps = HTMLAttributes<HTMLDivElement>

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={cn("fixed inset-0 flex flex-col overflow-hidden", className)} {...props}>
		{children}
	</div>
)

export const TabHeader = ({ className, children, ...props }: TabProps) => (
	<div className={cn("px-5 py-2.5 border-b border-vscode-panel-border", className)} {...props}>
		{children}
	</div>
)

export const TabContent = ({ className, children, ...props }: TabProps) => (
	<div className={cn("flex-1 overflow-auto p-5", className)} {...props}>
		{children}
	</div>
)
