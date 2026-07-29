"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

export interface SearchComboboxOption {
	description?: string;
	icon?: ReactNode;
	label: string;
	value: string;
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
	placeholder?: string;
	placement?: "top" | "bottom";
	searchPlaceholder?: string;
	value?: string;
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
	placeholder = "Select",
	placement = "bottom",
	searchPlaceholder = "Search…",
	value,
}: SearchComboboxProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) {
			setSearch("");
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
	const filtered = useMemo(() => {
		const query = search.toLowerCase();
		return options.filter((option) =>
			`${option.label} ${option.description ?? ""}`
				.toLowerCase()
				.includes(query),
		);
	}, [options, search]);

	const handleSelect = (option: SearchComboboxOption) => {
		if (disabled) return;
		if (option.value !== value) onValueChange(option.value);
		setOpen(false);
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
					"cline-ui-search-combobox__trigger inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-1 font-medium text-foreground transition-[background-color] duration-150 ease-[ease] enabled:hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
					className,
				]
					.filter(Boolean)
					.join(" ")}
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				title={displayedValue}
				type="button"
			>
				{selected?.icon}
				<span className="cline-ui-search-combobox__value min-w-0 truncate">
					{displayedValue}
				</span>
			</button>

			{open ? (
				<div
					aria-label={`Search ${ariaLabel.toLowerCase()}`}
					className={[
						"cline-ui-search-combobox__panel absolute z-50 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl",
						`cline-ui-search-combobox__panel--${align}`,
						`cline-ui-search-combobox__panel--${placement}`,
						align === "start" ? "left-0" : "right-0",
						placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
					].join(" ")}
					role="dialog"
				>
					<div className="cline-ui-search-combobox__search-row border-b border-border p-2">
						<div className="cline-ui-search-combobox__search-shell flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
							<svg
								aria-hidden="true"
								className="cline-ui-search-combobox__search-icon size-3 shrink-0 text-muted-foreground"
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
								aria-label={searchPlaceholder}
								// biome-ignore lint/a11y/noAutofocus: opening the picker focuses search
								autoFocus
								className="cline-ui-search-combobox__search h-auto w-full rounded-md border-0 bg-transparent p-0 text-xs text-muted-foreground outline-0 placeholder:text-muted-foreground dark:bg-input/30 md:text-sm"
								onChange={(event) => setSearch(event.target.value)}
								placeholder={searchPlaceholder}
								value={search}
							/>
						</div>
					</div>
					<div className="cline-ui-search-combobox__options flex max-h-56 flex-col gap-0.5 overflow-y-auto p-1.5">
						{loading ? (
							<div className="cline-ui-search-combobox__empty p-2 text-xs text-muted-foreground">
								{loadingText}
							</div>
						) : filtered.length === 0 ? (
							<div className="cline-ui-search-combobox__empty p-2 text-xs text-muted-foreground">
								{emptyText}
							</div>
						) : (
							filtered.map((option) => (
								<button
									aria-pressed={option.value === value}
									className="cline-ui-search-combobox__option flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-foreground transition-[background-color] duration-150 ease-[ease] hover:bg-accent/50 aria-pressed:bg-accent focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
									disabled={disabled}
									key={option.value}
									onClick={() => handleSelect(option)}
									type="button"
								>
									{option.icon}
									<span className="cline-ui-search-combobox__option-copy flex min-w-0 flex-1 flex-col text-xs">
										<span className="truncate">{option.label}</span>
										{option.description ? (
											<small className="truncate text-[0.625rem] text-muted-foreground">
												{option.description}
											</small>
										) : null}
									</span>
									{option.value === value ? (
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
							))
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
