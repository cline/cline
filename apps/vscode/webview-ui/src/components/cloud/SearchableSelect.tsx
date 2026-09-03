import { CheckIcon, ChevronDownIcon, LoaderCircleIcon } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface SearchableSelectOption {
	value: string
	label: string
	description?: string
}

/** Small combobox: a trigger showing the current value and a filterable list in a popover. */
export function SearchableSelect({
	value,
	options,
	onChange,
	onQueryChange,
	placeholder,
	icon,
	loading,
	disabled,
	emptyText = "No matches",
	className,
	ariaLabel,
}: {
	value: string | undefined
	options: SearchableSelectOption[]
	onChange: (value: string) => void
	/** Called (debounced) when the filter text changes, for server-side searches. */
	onQueryChange?: (query: string) => void
	placeholder: string
	icon?: ReactNode
	loading?: boolean
	disabled?: boolean
	emptyText?: string
	className?: string
	ariaLabel: string
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const lastEmittedQuery = useRef("")

	useEffect(() => {
		if (!onQueryChange || query === lastEmittedQuery.current) {
			return
		}
		const timer = setTimeout(() => {
			lastEmittedQuery.current = query
			onQueryChange(query)
		}, 250)
		return () => clearTimeout(timer)
	}, [query, onQueryChange])

	const filtered = useMemo(() => {
		const lowered = query.trim().toLowerCase()
		if (!lowered) {
			return options
		}
		return options.filter(
			(option) => option.label.toLowerCase().includes(lowered) || option.description?.toLowerCase().includes(lowered),
		)
	}, [options, query])

	const selected = options.find((option) => option.value === value)
	const shownLabel = selected?.label ?? value

	return (
		<Popover
			onOpenChange={(next) => {
				setOpen(next)
				if (!next) {
					setQuery("")
				}
			}}
			open={open}>
			<PopoverTrigger asChild>
				<button
					aria-label={ariaLabel}
					className={cn(
						"flex min-w-0 flex-1 items-center gap-1.5 rounded-sm border border-input-foreground/20 bg-input-background px-2 py-1 text-left text-xs text-input-foreground hover:bg-list-hover disabled:cursor-not-allowed disabled:opacity-60",
						className,
					)}
					disabled={disabled}
					type="button">
					{icon && <span className="shrink-0 text-description">{icon}</span>}
					<span className={cn("min-w-0 flex-1 truncate", !shownLabel && "text-input-placeholder")}>
						{shownLabel || placeholder}
					</span>
					{loading ? (
						<LoaderCircleIcon className="size-3 shrink-0 animate-spin text-description" />
					) : (
						<ChevronDownIcon className="size-3 shrink-0 text-description" />
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-1 text-menu-foreground" side="bottom">
				<Input
					autoFocus
					className="mb-1 h-7 px-2 py-1 text-xs"
					onChange={(event) => setQuery(event.target.value)}
					placeholder={`Search…`}
					value={query}
				/>
				<div className="max-h-56 overflow-y-auto">
					{filtered.length === 0 ? (
						<div className="px-2 py-2 text-xs text-description">{loading ? "Loading…" : emptyText}</div>
					) : (
						filtered.map((option) => (
							<button
								className={cn(
									"flex w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-xs hover:bg-list-hover",
									option.value === value && "bg-list-hover",
								)}
								key={option.value}
								onClick={() => {
									onChange(option.value)
									setOpen(false)
								}}
								type="button">
								<CheckIcon
									className={cn("size-3 shrink-0", option.value === value ? "opacity-100" : "opacity-0")}
								/>
								<span className="min-w-0 flex-1 truncate">{option.label}</span>
								{option.description && (
									<span className="shrink-0 truncate text-description">{option.description}</span>
								)}
							</button>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
