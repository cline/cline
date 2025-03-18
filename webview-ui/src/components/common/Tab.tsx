import { HTMLAttributes, useCallback } from "react"

import { useExtensionState } from "@/context/ExtensionStateContext"
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

export const TabContent = ({ className, children, ...props }: TabProps) => {
	const { renderContext } = useExtensionState()

	const onWheel = useCallback(
		(e: React.WheelEvent<HTMLDivElement>) => {
			if (renderContext !== "editor") {
				return
			}

			const target = e.target as HTMLElement

			// Prevent scrolling if the target is a listbox or option
			// (e.g. selects, dropdowns, etc).
			if (target.role === "listbox" || target.role === "option") {
				return
			}

			e.currentTarget.scrollTop += e.deltaY
		},
		[renderContext],
	)

	return (
		<div className={cn("flex-1 overflow-auto p-5", className)} onWheel={onWheel} {...props}>
			{children}
		</div>
	)
}
