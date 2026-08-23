"use client";

import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

export interface SearchComboboxOption {
	/** Small pill rendered after the label (e.g. "NEW", "Free"). */
	badge?: string;
	description?: string;
	icon?: ReactNode;
	label: string;
	/** Id of the section this option belongs to (see `sections`). */
	section?: string;
	value: string;
}

export interface SearchComboboxSection {
	description?: string;
	id: string;
	label: string;
}

export interface SearchComboboxProps {
	align?: "start" | "end";
	ariaLabel: string;
	className?: string;
	disabled?: boolean;
	emptyText?: string;
	loading?: boolean;
	loadingText?: string;
	onValueChange: (value: string) => void;
	options: SearchComboboxOption[];
	/** Panel width as a CSS length (default "16rem"). */
	panelWidth?: string;
	placeholder?: string;
	placement?: "top" | "bottom";
	searchPlaceholder?: string;
	/**
	 * Section headers, rendered while the search box is empty whenever a run of
	 * consecutive options carries that section id. Searching flattens the list.
	 */
	sections?: SearchComboboxSection[];
	value?: string;
}

function optionMatches(option: SearchComboboxOption, query: string): boolean {
	return `${option.label} ${option.description ?? ""} ${option.value}`
		.toLowerCase()
		.includes(query);
}

function highlightMatch(label: string, query: string): ReactNode {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return label;
	}
	const index = label.toLowerCase().indexOf(normalized);
	if (index === -1) {
		return label;
	}
	return (
		<>
			{label.slice(0, index)}
			<span className="cline-ui-search-combobox__match font-cline-ui-semibold text-cline-ui-foreground">
				{label.slice(index, index + normalized.length)}
			</span>
			{label.slice(index + normalized.length)}
		</>
	);
}

export function SearchCombobox({
	align = "start",
	ariaLabel,
	className,
	disabled = false,
	emptyText = "No results",
	loading = false,
	loadingText = "Loading…",
	onValueChange,
	options,
	panelWidth = "16rem",
	placeholder = "Select",
	placement = "bottom",
	searchPlaceholder = "Search…",
	sections,
	value,
}: SearchComboboxProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	// How to follow the active row: center it when the panel opens, keep it
	// just in view for keyboard navigation, and never scroll for mouse hover —
	// scrolling under the cursor re-triggers hover and makes the list jump.
	const scrollModeRef = useRef<"center" | "nearest" | "none">("center");
	const listboxId = useId();

	useEffect(() => {
		if (!open) {
			setSearch("");
			scrollModeRef.current = "center";
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", handlePointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", handlePointerDown, true);
	}, [open]);

	const selected = options.find((option) => option.value === value);
	const displayedValue = loading
		? loadingText
		: (selected?.label ?? value) || placeholder;
	const query = search.trim().toLowerCase();
	const filtered = useMemo(
		() =>
			query
				? options.filter((option) => optionMatches(option, query))
				: options,
		[options, query],
	);
	const sectionById = useMemo(() => {
		const map = new Map<string, SearchComboboxSection>();
		for (const section of sections ?? []) map.set(section.id, section);
		return map;
	}, [sections]);

	const optionId = useCallback(
		(index: number) => `${listboxId}-option-${index}`,
		[listboxId],
	);

	// Reset the active row when the option set changes: to the selected option
	// on open, to the top match while searching.
	useEffect(() => {
		if (!open) return;
		if (query) {
			setActiveIndex(0);
			return;
		}
		const selectedIndex = filtered.findIndex(
			(option) => option.value === value,
		);
		setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
	}, [filtered, open, query, value]);

	useEffect(() => {
		if (!open || scrollModeRef.current === "none") return;
		const activeElement = document.getElementById(optionId(activeIndex));
		if (typeof activeElement?.scrollIntoView === "function") {
			activeElement.scrollIntoView({ block: scrollModeRef.current });
		}
	}, [activeIndex, open, optionId]);

	const handleSelect = useCallback(
		(option: SearchComboboxOption) => {
			if (disabled) return;
			if (option.value !== value) onValueChange(option.value);
			setOpen(false);
			// Selecting unmounts the focused search input; without an explicit
			// focus target, focus falls back to <body> and keyboard users lose
			// their place.
			triggerRef.current?.focus();
		},
		[disabled, onValueChange, value],
	);

	const closeAndRestoreFocus = () => {
		setOpen(false);
		triggerRef.current?.focus();
	};

	const handleSearchKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>,
	) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeAndRestoreFocus();
			return;
		}
		if (event.key === "Tab") {
			// The search input is the only tabbable element in the panel, so
			// Tab always moves focus outside the component; close the popup
			// instead of leaving it open behind the new focus target.
			setOpen(false);
			return;
		}
		if (filtered.length === 0) return;
		scrollModeRef.current = "nearest";
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((current) => Math.max(current - 1, 0));
		} else if (event.key === "Home") {
			event.preventDefault();
			setActiveIndex(0);
		} else if (event.key === "End") {
			event.preventDefault();
			setActiveIndex(filtered.length - 1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const option = filtered[activeIndex];
			if (option) handleSelect(option);
		}
	};

	const renderOption = (option: SearchComboboxOption, index: number) => {
		const isSelected = option.value === value;
		const isActive = index === activeIndex;
		return (
			<button
				aria-selected={isSelected}
				className={[
					"cline-ui-search-combobox__option flex w-full cursor-pointer items-center gap-2 rounded-cline-ui-md border-0 px-2 py-1.5 text-left text-cline-ui-foreground",
					isSelected
						? "bg-cline-ui-accent"
						: isActive
							? "bg-cline-ui-surface-hover"
							: "bg-transparent",
				].join(" ")}
				data-active={isActive || undefined}
				disabled={disabled}
				id={optionId(index)}
				key={option.value}
				onClick={() => handleSelect(option)}
				onMouseMove={() => {
					if (!isActive) {
						scrollModeRef.current = "none";
						setActiveIndex(index);
					}
				}}
				role="option"
				tabIndex={-1}
				type="button"
			>
				{option.icon}
				<span className="cline-ui-search-combobox__option-copy flex min-w-0 flex-1 flex-col text-cline-ui-sm">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate">
							{highlightMatch(option.label, search)}
						</span>
						{option.badge ? (
							<span className="cline-ui-search-combobox__badge inline-flex shrink-0 items-center rounded-cline-ui-sm bg-cline-ui-surface-hover px-1 py-px font-cline-ui-medium text-[0.625rem] text-cline-ui-muted-foreground uppercase tracking-wide">
								{option.badge}
							</span>
						) : null}
					</span>
					{option.description ? (
						<small className="truncate text-[0.625rem] text-cline-ui-muted-foreground">
							{option.description}
						</small>
					) : null}
				</span>
				{isSelected ? (
					<svg
						aria-hidden="true"
						className="cline-ui-search-combobox__check size-3 shrink-0"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2"
						viewBox="0 0 24 24"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				) : null}
			</button>
		);
	};

	const renderOptions = () => {
		if (query) {
			return filtered.map((option, index) => renderOption(option, index));
		}
		const rows: ReactNode[] = [];
		let previousSection: string | undefined;
		filtered.forEach((option, index) => {
			if (option.section && option.section !== previousSection) {
				const section = sectionById.get(option.section);
				if (section) {
					rows.push(
						<div
							className={[
								"cline-ui-search-combobox__section px-2 pb-1 text-cline-ui-muted-foreground",
								index === 0 ? "pt-1" : "pt-2.5",
							].join(" ")}
							key={`section-${option.section}`}
						>
							<div className="font-cline-ui-medium text-[0.625rem] uppercase tracking-wider">
								{section.label}
							</div>
							{section.description ? (
								<div className="text-[0.625rem]">{section.description}</div>
							) : null}
						</div>,
					);
				}
			}
			previousSection = option.section;
			rows.push(renderOption(option, index));
		});
		return rows;
	};

	return (
		<div
			className="cline-ui-search-combobox relative min-w-0"
			ref={containerRef}
		>
			<button
				aria-busy={loading || undefined}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={`${ariaLabel}: ${displayedValue}`}
				className={[
					"cline-ui-search-combobox__trigger inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-cline-ui-md border-0 bg-transparent px-2 py-1 text-cline-ui-sm font-cline-ui-medium text-cline-ui-foreground ease-[ease] [&:hover:not(:disabled)]:bg-cline-ui-surface-hover focus-visible:outline-2 focus-visible:outline-cline-ui-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
					className,
				]
					.filter(Boolean)
					.join(" ")}
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				ref={triggerRef}
				title={displayedValue}
				type="button"
			>
				{selected?.icon}
				<span className="cline-ui-search-combobox__value min-w-0 truncate">
					{displayedValue}
				</span>
				<svg
					aria-hidden="true"
					className="cline-ui-search-combobox__chevron size-2.5 shrink-0 text-cline-ui-muted-foreground"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					viewBox="0 0 24 24"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>

			{open ? (
				<div
					aria-label={`Search ${ariaLabel.toLowerCase()}`}
					className={[
						"cline-ui-search-combobox__panel absolute z-50 overflow-hidden rounded-cline-ui-lg border border-cline-ui-border bg-cline-ui-popover shadow-xl",
						`cline-ui-search-combobox__panel--${align}`,
						`cline-ui-search-combobox__panel--${placement}`,
						align === "start" ? "left-0" : "right-0",
						placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
					].join(" ")}
					role="dialog"
					style={{ width: panelWidth, maxWidth: "calc(100vw - 1.5rem)" }}
				>
					<div className="cline-ui-search-combobox__search-row flex items-center gap-2 border-cline-ui-border border-b px-3">
						<svg
							aria-hidden="true"
							className="cline-ui-search-combobox__search-icon size-3 shrink-0 text-cline-ui-muted-foreground"
							fill="none"
							stroke="currentColor"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							viewBox="0 0 24 24"
						>
							<path d="m21 21-4.34-4.34" />
							<circle cx="11" cy="11" r="8" />
						</svg>
						<input
							aria-activedescendant={
								filtered.length > 0 ? optionId(activeIndex) : undefined
							}
							aria-controls={listboxId}
							aria-expanded="true"
							aria-label={searchPlaceholder}
							// biome-ignore lint/a11y/noAutofocus: opening the picker focuses search
							autoFocus
							className="cline-ui-search-combobox__search h-8 w-full border-0 bg-transparent p-0 text-cline-ui-sm text-cline-ui-foreground outline-0 placeholder:text-cline-ui-muted-foreground"
							onChange={(event) => {
								scrollModeRef.current = "nearest";
								setSearch(event.target.value);
							}}
							onKeyDown={handleSearchKeyDown}
							placeholder={searchPlaceholder}
							role="combobox"
							value={search}
						/>
					</div>
					<div
						className="cline-ui-search-combobox__options flex max-h-64 flex-col overflow-y-auto overscroll-contain p-1.5"
						id={listboxId}
						role="listbox"
					>
						{loading ? (
							<div className="cline-ui-search-combobox__empty p-2 text-cline-ui-sm text-cline-ui-muted-foreground">
								{loadingText}
							</div>
						) : filtered.length === 0 ? (
							<div className="cline-ui-search-combobox__empty p-2 text-cline-ui-sm text-cline-ui-muted-foreground">
								{emptyText}
							</div>
						) : (
							renderOptions()
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
