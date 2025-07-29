import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
	Button,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui"
import { useEscapeKey } from "@/hooks/useEscapeKey"

export interface SearchableSelectOption {
	value: string
	label: string
	disabled?: boolean
	icon?: React.ReactNode
}

interface SearchableSelectProps {
	value?: string
	onValueChange: (value: string) => void
	options: SearchableSelectOption[]
	placeholder: string
	searchPlaceholder: string
	emptyMessage: string
	className?: string
	disabled?: boolean
	"data-testid"?: string
}

export function SearchableSelect({
	value,
	onValueChange,
	options,
	placeholder,
	searchPlaceholder,
	emptyMessage,
	className,
	disabled,
	"data-testid": dataTestId,
}: SearchableSelectProps) {
	const [open, setOpen] = React.useState(false)
	const [searchValue, setSearchValue] = React.useState("")
	const searchInputRef = React.useRef<HTMLInputElement>(null)
	const searchResetTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
	const isMountedRef = React.useRef(true)

	// Find the selected option
	const selectedOption = options.find((option) => option.value === value)

	// Filter options based on search
	const filteredOptions = React.useMemo(() => {
		if (!searchValue) return options
		return options.filter((option) => option.label.toLowerCase().includes(searchValue.toLowerCase()))
	}, [options, searchValue])

	// Cleanup timeout on unmount
	React.useEffect(() => {
		return () => {
			isMountedRef.current = false
			if (searchResetTimeoutRef.current) {
				clearTimeout(searchResetTimeoutRef.current)
			}
		}
	}, [])

	// Reset search when value changes
	React.useEffect(() => {
		const timeoutId = setTimeout(() => {
			if (isMountedRef.current) {
				setSearchValue("")
			}
		}, 100)
		return () => clearTimeout(timeoutId)
	}, [value])

	// Use the shared ESC key handler hook
	useEscapeKey(open, () => setOpen(false))

	const handleOpenChange = (open: boolean) => {
		setOpen(open)
		// Reset search when closing
		if (!open) {
			if (searchResetTimeoutRef.current) {
				clearTimeout(searchResetTimeoutRef.current)
			}
			searchResetTimeoutRef.current = setTimeout(() => setSearchValue(""), 100)
		}
	}

	const handleSelect = (selectedValue: string) => {
		setOpen(false)
		onValueChange(selectedValue)
	}

	const handleClearSearch = () => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className={cn(
						"w-full justify-between font-normal",
						"h-7 px-3 py-2",
						"border border-vscode-dropdown-border",
						"bg-vscode-dropdown-background hover:bg-transparent",
						"text-vscode-dropdown-foreground",
						"focus-visible:border-vscode-focusBorder",
						"aria-expanded:border-vscode-focusBorder",
						!selectedOption && "text-muted-foreground",
						className,
					)}
					data-testid={dataTestId}>
					<span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
					<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
				<Command>
					<div className="relative">
						<CommandInput
							ref={searchInputRef}
							value={searchValue}
							onValueChange={setSearchValue}
							placeholder={searchPlaceholder}
							className="h-9 mr-4"
						/>
						{searchValue.length > 0 && (
							<div
								className="absolute right-2 top-0 bottom-0 flex items-center justify-center"
								data-testid="clear-search-button"
								onClick={handleClearSearch}>
								<X className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer" />
							</div>
						)}
					</div>
					<CommandList>
						<CommandEmpty>
							{searchValue && <div className="py-2 px-1 text-sm">{emptyMessage}</div>}
						</CommandEmpty>
						<CommandGroup>
							{filteredOptions.map((option) => (
								<CommandItem
									key={option.value}
									value={option.label}
									onSelect={() => handleSelect(option.value)}
									disabled={option.disabled}
									className={option.disabled ? "text-vscode-errorForeground" : ""}>
									<div className="flex items-center">
										{option.icon}
										{option.label}
									</div>
									<Check
										className={cn(
											"ml-auto h-4 w-4 p-0.5",
											value === option.value ? "opacity-100" : "opacity-0",
										)}
									/>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
}
