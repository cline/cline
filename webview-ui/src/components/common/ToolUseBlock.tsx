import { cn } from "@/lib/utils"

import { CODE_BLOCK_BG_COLOR } from "./CodeBlock"

export const ToolUseBlock = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("overflow-hidden border border-vscode-border rounded-xs p-2 cursor-pointer", className)}
		style={{
			backgroundColor: CODE_BLOCK_BG_COLOR,
		}}
		{...props}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex items-center select-none text-vscode-descriptionForeground", className)} {...props} />
)
