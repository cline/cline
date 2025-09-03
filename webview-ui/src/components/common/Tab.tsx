import React, { HTMLAttributes, useCallback, forwardRef } from "react"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"

type TabProps = HTMLAttributes<HTMLDivElement>

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={cn("fixed inset-0 flex flex-col", className)} {...props}>
		{children}
	</div>
)

export const TabHeader = ({ className, children, ...props }: TabProps) => (
	<div className={cn("px-5 py-2.5 border-b border-vscode-panel-border", className)} {...props}>
		{children}
	</div>
)

export const TabContent = forwardRef<HTMLDivElement, TabProps>(({ className, children, ...props }, ref) => {
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
		<div ref={ref} className={cn("flex-1 overflow-auto p-5", className)} onWheel={onWheel} {...props}>
			{children}
		</div>
	)
})
TabContent.displayName = "TabContent"

export const TabList = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement> & {
		value: string
		onValueChange: (value: string) => void
	}
>(({ children, className, value, onValueChange, ...props }, ref) => {
	return (
		<div ref={ref} role="tablist" className={cn("flex", className)} {...props}>
			{React.Children.map(children, (child) => {
				if (React.isValidElement(child)) {
					return React.cloneElement(child as React.ReactElement<any>, {
						isSelected: child.props.value === value,
						onSelect: () => onValueChange(child.props.value),
					})
				}
				return child
			})}
		</div>
	)
})

export const TabTrigger = forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		value: string
		isSelected?: boolean
		onSelect?: () => void
	}
>(({ children, className, value: _value, isSelected, onSelect, ...props }, ref) => {
	return (
		<button
			ref={ref}
			role="tab"
			aria-selected={isSelected}
			tabIndex={isSelected ? 0 : -1}
			className={cn("focus:outline-none focus:ring-2 focus:ring-vscode-focusBorder", className)}
			onClick={onSelect}
			{...props}>
			{children}
		</button>
	)
})
