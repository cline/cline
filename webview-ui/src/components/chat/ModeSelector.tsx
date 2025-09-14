import React from "react"
import { Fzf } from "fzf"
import { Check, X } from "lucide-react"

import { type ModeConfig, type CustomModePrompts, TelemetryEventName } from "@roo-code/types"

import { type Mode, getAllModes } from "@roo/modes"

import { vscode } from "@/utils/vscode"
import { telemetryClient } from "@/utils/TelemetryClient"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"

import { IconButton } from "./IconButton"

const SEARCH_THRESHOLD = 6

interface ModeSelectorProps {
	value: Mode
	onChange: (value: Mode) => void
	disabled?: boolean
	title: string
	triggerClassName?: string
	modeShortcutText: string
	customModes?: ModeConfig[]
	customModePrompts?: CustomModePrompts
	disableSearch?: boolean
}

export const ModeSelector = ({
	value,
	onChange,
	disabled = false,
	title,
	triggerClassName = "",
	modeShortcutText,
	customModes,
	customModePrompts,
	disableSearch = false,
}: ModeSelectorProps) => {
	const [open, setOpen] = React.useState(false)
	const [searchValue, setSearchValue] = React.useState("")
	const searchInputRef = React.useRef<HTMLInputElement>(null)
	const selectedItemRef = React.useRef<HTMLDivElement>(null)
	const scrollContainerRef = React.useRef<HTMLDivElement>(null)
	const portalContainer = useRooPortal("roo-portal")
	const { hasOpenedModeSelector, setHasOpenedModeSelector } = useExtensionState()
	const { t } = useAppTranslation()

	const trackModeSelectorOpened = React.useCallback(() => {
		// Track telemetry every time the mode selector is opened.
		telemetryClient.capture(TelemetryEventName.MODE_SELECTOR_OPENED)

		// Track first-time usage for UI purposes.
		if (!hasOpenedModeSelector) {
			setHasOpenedModeSelector(true)
			vscode.postMessage({ type: "hasOpenedModeSelector", bool: true })
		}
	}, [hasOpenedModeSelector, setHasOpenedModeSelector])

	// Get all modes including custom modes and merge custom prompt descriptions.
	const modes = React.useMemo(() => {
		const allModes = getAllModes(customModes)

		return allModes.map((mode) => ({
			...mode,
			description: customModePrompts?.[mode.slug]?.description ?? mode.description,
		}))
	}, [customModes, customModePrompts])

	// Find the selected mode.
	const selectedMode = React.useMemo(() => modes.find((mode) => mode.slug === value), [modes, value])

	// Memoize searchable items for fuzzy search with separate name and
	// description search.
	const nameSearchItems = React.useMemo(() => {
		return modes.map((mode) => ({
			original: mode,
			searchStr: [mode.name, mode.slug].filter(Boolean).join(" "),
		}))
	}, [modes])

	const descriptionSearchItems = React.useMemo(() => {
		return modes.map((mode) => ({
			original: mode,
			searchStr: mode.description || "",
		}))
	}, [modes])

	// Create memoized Fzf instances for name and description searches.
	const nameFzfInstance = React.useMemo(
		() => new Fzf(nameSearchItems, { selector: (item) => item.searchStr }),
		[nameSearchItems],
	)

	const descriptionFzfInstance = React.useMemo(
		() => new Fzf(descriptionSearchItems, { selector: (item) => item.searchStr }),
		[descriptionSearchItems],
	)

	// Filter modes based on search value using fuzzy search with priority.
	const filteredModes = React.useMemo(() => {
		if (!searchValue) return modes

		// First search in names/slugs.
		const nameMatches = nameFzfInstance.find(searchValue)
		const nameMatchedModes = new Set(nameMatches.map((result) => result.item.original.slug))

		// Then search in descriptions.
		const descriptionMatches = descriptionFzfInstance.find(searchValue)

		// Combine results: name matches first, then description matches.
		const combinedResults = [
			...nameMatches.map((result) => result.item.original),
			...descriptionMatches
				.filter((result) => !nameMatchedModes.has(result.item.original.slug))
				.map((result) => result.item.original),
		]

		return combinedResults
	}, [modes, searchValue, nameFzfInstance, descriptionFzfInstance])

	const onClearSearch = React.useCallback(() => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}, [])

	const handleSelect = React.useCallback(
		(modeSlug: string) => {
			onChange(modeSlug as Mode)
			setOpen(false)
			// Clear search after selection.
			setSearchValue("")
		},
		[onChange],
	)

	const onOpenChange = React.useCallback(
		(isOpen: boolean) => {
			if (isOpen) trackModeSelectorOpened()
			setOpen(isOpen)

			// Clear search when closing.
			if (!isOpen) {
				setSearchValue("")
			}
		},
		[trackModeSelectorOpened],
	)

	// Auto-focus search input and scroll to selected item when popover opens.
	React.useEffect(() => {
		if (open) {
			// Focus search input
			if (searchInputRef.current) {
				searchInputRef.current.focus()
			}

			requestAnimationFrame(() => {
				if (selectedItemRef.current && scrollContainerRef.current) {
					const container = scrollContainerRef.current
					const item = selectedItemRef.current

					// Calculate positions
					const containerHeight = container.clientHeight
					const itemTop = item.offsetTop
					const itemHeight = item.offsetHeight

					// Center the item in the container
					const scrollPosition = itemTop - containerHeight / 2 + itemHeight / 2

					// Ensure we don't scroll past boundaries
					const maxScroll = container.scrollHeight - containerHeight
					const finalScrollPosition = Math.min(Math.max(0, scrollPosition), maxScroll)

					container.scrollTo({
						top: finalScrollPosition,
						behavior: "instant",
					})
				}
			})
		}
	}, [open])

	// Determine if search should be shown.
	const showSearch = !disableSearch && modes.length > SEARCH_THRESHOLD

	// Combine instruction text for tooltip.
	const instructionText = `${t("chat:modeSelector.description")} ${modeShortcutText}`

	return (
		<Popover open={open} onOpenChange={onOpenChange} data-testid="mode-selector-root">
			<StandardTooltip content={title}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="mode-selector-trigger"
					className={cn(
						"inline-flex items-center relative whitespace-nowrap px-1.5 py-1 text-xs",
						"bg-transparent border border-[rgba(255,255,255,0.08)] rounded-md text-vscode-foreground",
						"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder focus-visible:ring-inset",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] cursor-pointer",
						triggerClassName,
						!disabled && !hasOpenedModeSelector
							? "bg-primary opacity-90 hover:bg-primary-hover text-vscode-button-foreground"
							: null,
					)}>
					<span className="truncate">{selectedMode?.name || ""}</span>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden min-w-80 max-w-9/10">
				<div className="flex flex-col w-full">
					{/* Show search bar only when there are more than SEARCH_THRESHOLD items, otherwise show info blurb */}
					{showSearch ? (
						<div className="relative p-2 border-b border-vscode-dropdown-border">
							<input
								aria-label="Search modes"
								ref={searchInputRef}
								value={searchValue}
								onChange={(e) => setSearchValue(e.target.value)}
								placeholder={t("chat:modeSelector.searchPlaceholder")}
								className="w-full h-8 px-2 py-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-0"
								data-testid="mode-search-input"
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
					) : (
						<div className="p-3 border-b border-vscode-dropdown-border">
							<p className="m-0 text-xs text-vscode-descriptionForeground">{instructionText}</p>
						</div>
					)}

					{/* Mode List */}
					<div ref={scrollContainerRef} className="max-h-[300px] overflow-y-auto">
						{filteredModes.length === 0 && searchValue ? (
							<div className="py-2 px-3 text-sm text-vscode-foreground/70">
								{t("chat:modeSelector.noResults")}
							</div>
						) : (
							<div className="py-1">
								{filteredModes.map((mode) => {
									const isSelected = mode.slug === value
									return (
										<div
											key={mode.slug}
											ref={isSelected ? selectedItemRef : null}
											onClick={() => handleSelect(mode.slug)}
											className={cn(
												"px-3 py-1.5 text-sm cursor-pointer flex items-center",
												"hover:bg-vscode-list-hoverBackground",
												isSelected
													? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
													: "",
											)}
											data-testid="mode-selector-item">
											<div className="flex-1 min-w-0">
												<div className="font-bold truncate">{mode.name}</div>
												{mode.description && (
													<div className="text-xs text-vscode-descriptionForeground truncate">
														{mode.description}
													</div>
												)}
											</div>
											{isSelected && <Check className="ml-auto size-4 p-0.5" />}
										</div>
									)
								})}
							</div>
						)}
					</div>

					{/* Bottom bar with buttons on left and title on right */}
					<div className="flex flex-row items-center justify-between px-2 py-2 border-t border-vscode-dropdown-border">
						<div className="flex flex-row gap-1">
							<IconButton
								iconClass="codicon-extensions"
								title={t("chat:modeSelector.marketplace")}
								onClick={() => {
									window.postMessage(
										{
											type: "action",
											action: "marketplaceButtonClicked",
											values: { marketplaceTab: "mode" },
										},
										"*",
									)
									setOpen(false)
								}}
							/>
							<IconButton
								iconClass="codicon-settings-gear"
								title={t("chat:modeSelector.settings")}
								onClick={() => {
									vscode.postMessage({ type: "switchTab", tab: "modes" })
									setOpen(false)
								}}
							/>
						</div>

						{/* Info icon and title on the right - only show info icon when search bar is visible */}
						<div className="flex items-center gap-1 pr-1">
							{showSearch && (
								<StandardTooltip content={instructionText}>
									<span className="codicon codicon-info text-xs text-vscode-descriptionForeground opacity-70 hover:opacity-100 cursor-help" />
								</StandardTooltip>
							)}
							<h4 className="m-0 font-medium text-sm text-vscode-descriptionForeground">
								{t("chat:modeSelector.title")}
							</h4>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
