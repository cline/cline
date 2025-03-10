import * as React from "react"

import { cn } from "@/lib/utils"

import { useRooPortal } from "./hooks/useRooPortal"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
} from "./dropdown-menu"

export enum DropdownOptionType {
	ITEM = "item",
	SEPARATOR = "separator",
	SHORTCUT = "shortcut",
	ACTION = "action",
}
export interface DropdownOption {
	value: string
	label: string
	disabled?: boolean
	type?: DropdownOptionType
}

export interface SelectDropdownProps {
	value: string
	options: DropdownOption[]
	onChange: (value: string) => void
	disabled?: boolean
	title?: string
	className?: string
	triggerClassName?: string
	contentClassName?: string
	sideOffset?: number
	align?: "start" | "center" | "end"
	shouldShowCaret?: boolean
	placeholder?: string
	shortcutText?: string
}

export const SelectDropdown = React.forwardRef<React.ElementRef<typeof DropdownMenuTrigger>, SelectDropdownProps>(
	(
		{
			value,
			options,
			onChange,
			disabled = false,
			title = "",
			className = "",
			triggerClassName = "",
			contentClassName = "",
			sideOffset = 4,
			align = "start",
			shouldShowCaret = true,
			placeholder = "",
			shortcutText = "",
		},
		ref,
	) => {
		const [open, setOpen] = React.useState(false)
		const portalContainer = useRooPortal("roo-portal")

		const selectedOption = options.find((option) => option.value === value)
		const displayText = selectedOption?.label || placeholder || ""

		const handleSelect = (option: DropdownOption) => {
			if (option.type === DropdownOptionType.ACTION) {
				window.postMessage({ type: "action", action: option.value })
				setOpen(false)
				return
			}

			onChange(option.value)
			setOpen(false)
		}

		return (
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger
					ref={ref}
					disabled={disabled}
					title={title}
					className={cn(
						"inline-flex items-center gap-1 relative whitespace-nowrap rounded pr-1.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-vscode-focusBorder",
						"bg-transparent border-none text-vscode-foreground w-auto",
						disabled ? "opacity-50 cursor-not-allowed" : "opacity-80 cursor-pointer hover:opacity-100",
						triggerClassName,
					)}
					style={{
						width: "100%", // Take full width of parent.
						minWidth: "0",
						maxWidth: "100%",
					}}>
					{shouldShowCaret && (
						<div className="pointer-events-none opacity-80 flex-shrink-0">
							<svg
								fill="none"
								height="10"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
								width="10">
								<polyline points="18 15 12 9 6 15" />
							</svg>
						</div>
					)}
					<span className="truncate">{displayText}</span>
				</DropdownMenuTrigger>

				<DropdownMenuContent
					align={align}
					sideOffset={sideOffset}
					onEscapeKeyDown={() => setOpen(false)}
					onInteractOutside={() => setOpen(false)}
					container={portalContainer}
					className={cn(
						"bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border z-50",
						contentClassName,
					)}>
					{options.map((option, index) => {
						if (option.type === DropdownOptionType.SEPARATOR) {
							return <DropdownMenuSeparator key={`sep-${index}`} />
						}

						if (
							option.type === DropdownOptionType.SHORTCUT ||
							(option.disabled && shortcutText && option.label.includes(shortcutText))
						) {
							return (
								<div key={`label-${index}`} className="px-2 py-1.5 text-xs opacity-50">
									{option.label}
								</div>
							)
						}

						return (
							<DropdownMenuItem
								key={`item-${option.value}`}
								disabled={option.disabled}
								className={cn(
									"cursor-pointer text-xs focus:bg-vscode-list-hoverBackground focus:text-vscode-list-hoverForeground",
									option.value === value && "bg-vscode-list-focusBackground",
								)}
								onClick={() => handleSelect(option)}>
								{option.label}
							</DropdownMenuItem>
						)
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		)
	},
)

SelectDropdown.displayName = "SelectDropdown"
