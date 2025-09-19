import { cn } from "@/lib/utils"

export const ToolUseBlock = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("overflow-hidden rounded-md p-2 cursor-pointer bg-vscode-editor-background", className)}
		{...props}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex font-mono items-center select-none text-sm text-vscode-descriptionForeground", className)}
		{...props}
	/>
)
