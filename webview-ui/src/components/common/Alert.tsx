import { cn } from "@/lib/utils"
import { HTMLAttributes } from "react"

type AlertProps = HTMLAttributes<HTMLDivElement>

export const Alert = ({ className, children, ...props }: AlertProps) => (
	<div
		className={cn(
			"text-vscode-inputValidation-infoForeground bg-vscode-inputValidation-infoBackground border border-vscode-inputValidation-infoBorder rounded-xs p-2",
			className,
		)}
		{...props}>
		{children}
	</div>
)
