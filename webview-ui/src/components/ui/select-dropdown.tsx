import * as React from "react"
import { CaretUpIcon } from "@radix-ui/react-icons"

import { cn } from "@/lib/utils"

import { useRooPortal } from "./hooks/useRooPortal"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "./dropdown-menu"
import { Check } from "lucide-react"

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
	triggerClassName?: string
	contentClassName?: string
	sideOffset?: number
	align?: "start" | "center" | "end"
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
			triggerClassName = "",
			contentClassName = "",
			sideOffset = 4,
			align = "start",
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
						"w-full min-w-0 max-w-full inline-flex items-center gap-1 relative whitespace-nowrap pr-1.5 py-1.5 text-xs outline-none",
						"bg-transparent border-none text-vscode-foreground w-auto",
						disabled ? "opacity-50 cursor-not-allowed" : "opacity-80 hover:opacity-100 cursor-pointer",
						triggerClassName,
					)}>
					<CaretUpIcon className="pointer-events-none opacity-80 flex-shrink-0 size-3" />
					<span className="truncate">{displayText}</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align={align}
					sideOffset={sideOffset}
					onEscapeKeyDown={() => setOpen(false)}
					onInteractOutside={() => setOpen(false)}
					container={portalContainer}
					className={contentClassName}>
					{options.map((option, index) => {
						if (option.type === DropdownOptionType.SEPARATOR) {
							return <DropdownMenuSeparator key={`sep-${index}`} />
						}

						if (
							option.type === DropdownOptionType.SHORTCUT ||
							(option.disabled && shortcutText && option.label.includes(shortcutText))
						) {
							return (
								<DropdownMenuItem key={`label-${index}`} disabled>
									{option.label}
								</DropdownMenuItem>
							)
						}

						return (
							<DropdownMenuItem
								key={`item-${option.value}`}
								disabled={option.disabled}
								onClick={() => handleSelect(option)}>
								{option.label}
								{option.value === value && (
									<DropdownMenuShortcut>
										<Check className="size-4 p-0.5" />
									</DropdownMenuShortcut>
								)}
							</DropdownMenuItem>
						)
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		)
	},
)

SelectDropdown.displayName = "SelectDropdown"
