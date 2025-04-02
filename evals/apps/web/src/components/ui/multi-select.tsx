import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import fuzzysort from "fuzzysort"
import { Check, X, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

import { Badge } from "./badge"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command"

/**
 * Variants for the multi-select component to handle different styles.
 * Uses class-variance-authority (cva) to define different styles based on "variant" prop.
 */
const multiSelectVariants = cva("px-2 py-1", {
	variants: {
		variant: {
			default: "border-foreground/10 text-foreground bg-card hover:bg-card/80",
			secondary: "border-foreground/10 bg-secondary text-secondary-foreground hover:bg-secondary/80",
			destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
			inverted: "bg-background",
		},
	},
	defaultVariants: {
		variant: "default",
	},
})

/**
 * Props for MultiSelect component
 */
interface MultiSelectProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof multiSelectVariants> {
	/**
	 * An array of option objects to be displayed in the multi-select component.
	 * Each option object has a label and value.
	 */
	options: {
		/** The text to display for the option. */
		label: string
		/** The unique value associated with the option. */
		value: string
	}[]

	/**
	 * Callback function triggered when the selected values change.
	 * Receives an array of the new selected values.
	 */
	onValueChange: (value: string[]) => void

	/** The default selected values when the component mounts. */
	defaultValue?: string[]

	/**
	 * Placeholder text to be displayed when no values are selected.
	 * Optional, defaults to "Select options".
	 */
	placeholder?: string

	/**
	 * Maximum number of items to display. Extra selected items will be summarized.
	 * Optional, defaults to 3.
	 */
	maxCount?: number

	/**
	 * The modality of the popover. When set to true, interaction with outside elements
	 * will be disabled and only popover content will be visible to screen readers.
	 * Optional, defaults to false.
	 */
	modalPopover?: boolean

	/**
	 * If true, renders the multi-select component as a child of another component.
	 * Optional, defaults to false.
	 */
	asChild?: boolean

	/**
	 * Additional class names to apply custom styles to the multi-select component.
	 * Optional, can be used to add custom styles.
	 */
	className?: string
}

export const MultiSelect = React.forwardRef<HTMLDivElement, MultiSelectProps>(
	(
		{
			options,
			onValueChange,
			variant,
			defaultValue = [],
			placeholder = "Select options",
			maxCount = 3,
			modalPopover = false,
			className,
			...props
		},
		ref,
	) => {
		const [selectedValues, setSelectedValues] = React.useState<string[]>(defaultValue)
		const [isPopoverOpen, setIsPopoverOpen] = React.useState(false)

		const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Enter") {
				setIsPopoverOpen(true)
			} else if (event.key === "Backspace" && !event.currentTarget.value) {
				const newSelectedValues = [...selectedValues]
				newSelectedValues.pop()
				setSelectedValues(newSelectedValues)
				onValueChange(newSelectedValues)
			}
		}

		const toggleOption = (option: string) => {
			const newSelectedValues = selectedValues.includes(option)
				? selectedValues.filter((value) => value !== option)
				: [...selectedValues, option]
			setSelectedValues(newSelectedValues)
			onValueChange(newSelectedValues)
		}

		const handleTogglePopover = () => {
			setIsPopoverOpen((prev) => !prev)
		}

		const clearExtraOptions = () => {
			const newSelectedValues = selectedValues.slice(0, maxCount)
			setSelectedValues(newSelectedValues)
			onValueChange(newSelectedValues)
		}

		const searchResultsRef = React.useRef<Map<string, number>>(new Map())
		const searchValueRef = React.useRef("")

		const onSelectAll = () => {
			const values = Array.from(searchResultsRef.current.keys())

			if (
				selectedValues.length === values.length &&
				selectedValues.sort().join(",") === values.sort().join(",")
			) {
				setSelectedValues([])
				onValueChange([])
				return
			}

			setSelectedValues(values)
			onValueChange(values)
		}

		const onFilter = React.useCallback(
			(value: string, search: string) => {
				if (searchValueRef.current !== search) {
					searchValueRef.current = search
					searchResultsRef.current.clear()

					for (const {
						obj: { value },
						score,
					} of fuzzysort.go(search, options, {
						key: "label",
					})) {
						searchResultsRef.current.set(value, score)
					}
				}

				if (value === "all") {
					return searchResultsRef.current.size > 1 ? 0.01 : 0
				}

				return searchResultsRef.current.get(value) ?? 0
			},
			[options],
		)

		return (
			<Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen} modal={modalPopover}>
				<PopoverTrigger asChild>
					<div
						ref={ref}
						{...props}
						onClick={handleTogglePopover}
						className={cn(
							"flex w-full rounded-sm min-h-9 h-auto items-center justify-between [&_svg]:pointer-events-auto",
							"font-medium border border-input bg-input hover:opacity-80 cursor-pointer",
							className,
						)}>
						{selectedValues.length > 0 ? (
							<div className="flex justify-between items-center w-full">
								<div className="flex flex-wrap items-center gap-1 p-1">
									{selectedValues.slice(0, maxCount).map((value) => (
										<Badge key={value} className={cn(multiSelectVariants({ variant }))}>
											<div className="flex items-center gap-1.5">
												<div>{options.find((o) => o.value === value)?.label}</div>
												<div
													onClick={(event) => {
														event.stopPropagation()
														toggleOption(value)
													}}
													className="cursor-pointer">
													<X className="size-4 rounded-full p-0.5 bg-accent/5" />
												</div>
											</div>
										</Badge>
									))}
									{selectedValues.length > maxCount && (
										<Badge className={cn("text-ring", multiSelectVariants({ variant }))}>
											<div className="flex items-center gap-1.5">
												<div>{`+ ${selectedValues.length - maxCount} more`}</div>
												<div
													onClick={(event) => {
														event.stopPropagation()
														clearExtraOptions()
													}}
													className="cursor-pointer">
													<X className="size-4 rounded-full p-0.5 bg-ring/5" />
												</div>
											</div>
										</Badge>
									)}
								</div>
							</div>
						) : (
							<div className="flex items-center justify-between w-full mx-auto">
								<span className="text-muted-foreground mx-3">{placeholder}</span>
								<ChevronsUpDown className="opacity-50 size-4 mx-2" />
							</div>
						)}
					</div>
				</PopoverTrigger>
				<PopoverContent
					className="p-0 w-[var(--radix-popover-trigger-width)]"
					align="start"
					onEscapeKeyDown={() => setIsPopoverOpen(false)}>
					<Command filter={onFilter}>
						<CommandInput placeholder="Search" onKeyDown={handleInputKeyDown} />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup>
								{options.map((option) => (
									<CommandItem
										key={option.value}
										value={option.value}
										onSelect={() => toggleOption(option.value)}
										className="flex items-center justify-between">
										<span>{option.label}</span>
										<Check
											className={cn(
												"text-accent group-data-[selected=true]:text-accent-foreground size-4",
												{ "opacity-0": !selectedValues.includes(option.value) },
											)}
										/>
									</CommandItem>
								))}
								<CommandItem
									key="all"
									value="all"
									onSelect={onSelectAll}
									className="flex items-center justify-between">
									<span>Select All</span>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		)
	},
)

MultiSelect.displayName = "MultiSelect"
