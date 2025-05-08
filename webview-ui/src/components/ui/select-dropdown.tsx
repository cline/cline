import * as React from "react"
import { CaretUpIcon } from "@radix-ui/react-icons"
import { Check, X } from "lucide-react"
import { Fzf } from "fzf"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { useRooPortal } from "./hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui"

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
	pinned?: boolean
}

export interface SelectDropdownProps {
	value: string
	options: DropdownOption[]
	onChange: (value: string) => void
	disabled?: boolean
	title?: string
	triggerClassName?: string
	contentClassName?: string
	itemClassName?: string
	sideOffset?: number
	align?: "start" | "center" | "end"
	placeholder?: string
	shortcutText?: string
	renderItem?: (option: DropdownOption) => React.ReactNode
}

export const SelectDropdown = React.memo(
	React.forwardRef<React.ElementRef<typeof PopoverTrigger>, SelectDropdownProps>(
		(
			{
				value,
				options,
				onChange,
				disabled = false,
				title = "",
				triggerClassName = "",
				contentClassName = "",
				itemClassName = "",
				sideOffset = 4,
				align = "start",
				placeholder = "",
				shortcutText = "",
				renderItem,
			},
			ref,
		) => {
			const { t } = useTranslation()
			const [open, setOpen] = React.useState(false)
			const [searchValue, setSearchValue] = React.useState("")
			const searchInputRef = React.useRef<HTMLInputElement>(null)
			const portalContainer = useRooPortal("roo-portal")

			// Memoize the selected option to prevent unnecessary calculations
			const selectedOption = React.useMemo(
				() => options.find((option) => option.value === value),
				[options, value],
			)

			// Memoize the display text to prevent recalculation on every render
			const displayText = React.useMemo(
				() =>
					value && !selectedOption && placeholder ? placeholder : selectedOption?.label || placeholder || "",
				[value, selectedOption, placeholder],
			)

			// Reset search value when dropdown closes
			const onOpenChange = React.useCallback((open: boolean) => {
				setOpen(open)
				// Clear search when closing - no need for setTimeout
				if (!open) {
					// Use requestAnimationFrame instead of setTimeout for better performance
					requestAnimationFrame(() => setSearchValue(""))
				}
			}, [])

			// Clear search and focus input
			const onClearSearch = React.useCallback(() => {
				setSearchValue("")
				searchInputRef.current?.focus()
			}, [])

			// Filter options based on search value using Fzf for fuzzy search
			// Memoize searchable items to avoid recreating them on every search
			const searchableItems = React.useMemo(() => {
				return options
					.filter(
						(option) =>
							option.type !== DropdownOptionType.SEPARATOR && option.type !== DropdownOptionType.SHORTCUT,
					)
					.map((option) => ({
						original: option,
						searchStr: [option.label, option.value].filter(Boolean).join(" "),
					}))
			}, [options])

			// Create a memoized Fzf instance that only updates when searchable items change
			const fzfInstance = React.useMemo(() => {
				return new Fzf(searchableItems, {
					selector: (item) => item.searchStr,
				})
			}, [searchableItems])

			// Filter options based on search value using memoized Fzf instance
			const filteredOptions = React.useMemo(() => {
				// If no search value, return all options without filtering
				if (!searchValue) return options

				// Get fuzzy matching items - only perform search if we have a search value
				const matchingItems = fzfInstance.find(searchValue).map((result) => result.item.original)

				// Always include separators and shortcuts
				return options.filter((option) => {
					if (option.type === DropdownOptionType.SEPARATOR || option.type === DropdownOptionType.SHORTCUT) {
						return true
					}

					// Include if it's in the matching items
					return matchingItems.some((item) => item.value === option.value)
				})
			}, [options, searchValue, fzfInstance])

			// Group options by type and handle separators
			const groupedOptions = React.useMemo(() => {
				const result: DropdownOption[] = []
				let lastWasSeparator = false

				filteredOptions.forEach((option) => {
					if (option.type === DropdownOptionType.SEPARATOR) {
						// Only add separator if we have items before and after it
						if (result.length > 0 && !lastWasSeparator) {
							result.push(option)
							lastWasSeparator = true
						}
					} else {
						result.push(option)
						lastWasSeparator = false
					}
				})

				// Remove trailing separator if present
				if (result.length > 0 && result[result.length - 1].type === DropdownOptionType.SEPARATOR) {
					result.pop()
				}

				return result
			}, [filteredOptions])

			const handleSelect = React.useCallback(
				(optionValue: string) => {
					const option = options.find((opt) => opt.value === optionValue)

					if (!option) return

					if (option.type === DropdownOptionType.ACTION) {
						window.postMessage({ type: "action", action: option.value })
						setSearchValue("")
						setOpen(false)
						return
					}

					if (option.disabled) return

					onChange(option.value)
					setSearchValue("")
					setOpen(false)
					// Clear search value immediately
				},
				[onChange, options],
			)

			return (
				<Popover open={open} onOpenChange={onOpenChange} data-testid="dropdown-root">
					<PopoverTrigger
						ref={ref}
						disabled={disabled}
						title={title}
						data-testid="dropdown-trigger"
						className={cn(
							"w-full min-w-0 max-w-full inline-flex items-center gap-1.5 relative whitespace-nowrap px-1.5 py-1 text-xs",
							"bg-transparent border border-[rgba(255,255,255,0.08)] rounded-md text-vscode-foreground w-auto",
							"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder focus-visible:ring-inset",
							disabled
								? "opacity-50 cursor-not-allowed"
								: "opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] cursor-pointer",
							triggerClassName,
						)}>
						<CaretUpIcon className="pointer-events-none opacity-80 flex-shrink-0 size-3" />
						<span className="truncate">{displayText}</span>
					</PopoverTrigger>
					<PopoverContent
						align={align}
						sideOffset={sideOffset}
						container={portalContainer}
						className={cn("p-0 overflow-hidden", contentClassName)}>
						<div className="flex flex-col w-full">
							{/* Search input */}
							<div className="relative p-2 border-b border-vscode-dropdown-border">
								<input
									aria-label="Search"
									ref={searchInputRef}
									value={searchValue}
									onChange={(e) => setSearchValue(e.target.value)}
									placeholder={t("common:ui.search_placeholder")}
									className="w-full h-8 px-2 py-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-0"
								/>
								{searchValue.length > 0 && (
									<div className="absolute right-4 top-0 bottom-0 flex items-center justify-center">
										<X
											className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
											onClick={onClearSearch}
										/>
									</div>
								)}
							</div>

							{/* Dropdown items - Use windowing for large lists */}
							<div className="max-h-[300px] overflow-y-auto">
								{groupedOptions.length === 0 && searchValue ? (
									<div className="py-2 px-3 text-sm text-vscode-foreground/70">No results found</div>
								) : (
									<div className="py-1">
										{groupedOptions.map((option, index) => {
											// Memoize rendering of each item type for better performance
											if (option.type === DropdownOptionType.SEPARATOR) {
												return (
													<div
														key={`sep-${index}`}
														className="mx-1 my-1 h-px bg-vscode-dropdown-foreground/10"
														data-testid="dropdown-separator"
													/>
												)
											}

											if (
												option.type === DropdownOptionType.SHORTCUT ||
												(option.disabled && shortcutText && option.label.includes(shortcutText))
											) {
												return (
													<div
														key={`label-${index}`}
														className="px-3 py-1.5 text-sm opacity-50">
														{option.label}
													</div>
												)
											}

											// Use stable keys for better reconciliation
											const itemKey = `item-${option.value || option.label || index}`

											return (
												<div
													key={itemKey}
													onClick={() => !option.disabled && handleSelect(option.value)}
													className={cn(
														"px-3 py-1.5 text-sm cursor-pointer flex items-center",
														option.disabled
															? "opacity-50 cursor-not-allowed"
															: "hover:bg-vscode-list-hoverBackground",
														option.value === value
															? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
															: "",
														itemClassName,
													)}
													data-testid="dropdown-item">
													{renderItem ? (
														renderItem(option)
													) : (
														<>
															<span>{option.label}</span>
															{option.value === value && (
																<Check className="ml-auto size-4 p-0.5" />
															)}
														</>
													)}
												</div>
											)
										})}
									</div>
								)}
							</div>
						</div>
					</PopoverContent>
				</Popover>
			)
		},
	),
)

SelectDropdown.displayName = "SelectDropdown"
