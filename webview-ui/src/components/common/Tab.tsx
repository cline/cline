import React, { forwardRef, HTMLAttributes, useCallback } from "react"

type TabProps = HTMLAttributes<HTMLDivElement>

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={`fixed inset-0 flex flex-col ${className}`} {...props}>
		{children}
	</div>
)

export const TabHeader = ({ className, children, ...props }: TabProps) => (
	<div className={`px-5 py-2.5 border-b border-(--vscode-panel-border) ${className}`} {...props}>
		{children}
	</div>
)

export const TabContent = ({ className, children, ...props }: TabProps) => {
	const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement

		// Prevent scrolling if the target is a listbox or option
		// (e.g. selects, dropdowns, etc).
		if (target.role === "listbox" || target.role === "option") {
			return
		}

		e.currentTarget.scrollTop += e.deltaY
	}, [])

	return (
		<div className={`flex-1 overflow-auto ${className}`} onWheel={onWheel} {...props}>
			{children}
		</div>
	)
}

export const TabList = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement> & {
		value: string
		onValueChange: (value: string) => void
	}
>(({ children, className, value, onValueChange, ...props }, ref) => {
	const handleTabSelect = useCallback(
		(tabValue: string) => {
			console.log("Tab selected:", tabValue)
			onValueChange(tabValue)
		},
		[onValueChange],
	)

	return (
		<div className={`flex ${className}`} ref={ref} role="tablist" {...props}>
			{React.Children.map(children, (child) => {
				if (React.isValidElement(child)) {
					// Make sure we're passing the correct props to the TabTrigger
					return React.cloneElement(child as React.ReactElement<any>, {
						isSelected: child.props.value === value,
						onSelect: () => handleTabSelect(child.props.value),
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
>(({ children, className, value, isSelected, onSelect, ...props }, ref) => {
	// Ensure we're using the value prop correctly
	return (
		<button
			aria-selected={isSelected}
			className={`focus:outline-none ${className}`}
			data-value={value}
			onClick={onSelect}
			ref={ref}
			role="tab"
			tabIndex={isSelected ? 0 : -1} // Add data-value attribute for debugging
			{...props}>
			{children}
		</button>
	)
})
