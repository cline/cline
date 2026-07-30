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
		<div className="cline-ui-search-combobox" ref={containerRef}>
			<button
				aria-busy={loading || undefined}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={`${ariaLabel}: ${displayedValue}`}
				className={["cline-ui-search-combobox__trigger", className]
					.filter(Boolean)
					.join(" ")}
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				title={displayedValue}
				type="button"
			>
				{selected?.icon}
				<span className="cline-ui-search-combobox__value">
					{displayedValue}
				</span>
			</button>

			{open ? (
				<div
					aria-label={`Search ${ariaLabel.toLowerCase()}`}
					className={[
						"cline-ui-search-combobox__panel",
						`cline-ui-search-combobox__panel--${align}`,
						`cline-ui-search-combobox__panel--${placement}`,
					].join(" ")}
					role="dialog"
				>
					<div className="cline-ui-search-combobox__search-row">
						<div className="cline-ui-search-combobox__search-shell">
							<svg
								aria-hidden="true"
								className="cline-ui-search-combobox__search-icon"
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
								className="cline-ui-search-combobox__search"
								onChange={(event) => setSearch(event.target.value)}
								placeholder={searchPlaceholder}
								value={search}
							/>
						</div>
					</div>
					<div className="cline-ui-search-combobox__options">
						{loading ? (
							<div className="cline-ui-search-combobox__empty">
								{loadingText}
							</div>
						) : filtered.length === 0 ? (
							<div className="cline-ui-search-combobox__empty">{emptyText}</div>
						) : (
							filtered.map((option) => (
								<button
									aria-pressed={option.value === value}
									className="cline-ui-search-combobox__option"
									disabled={disabled}
									key={option.value}
									onClick={() => handleSelect(option)}
									type="button"
								>
									{option.icon}
									<span className="cline-ui-search-combobox__option-copy">
										<span>{option.label}</span>
										{option.description ? (
											<small>{option.description}</small>
										) : null}
									</span>
									{option.value === value ? (
										<svg
											aria-hidden="true"
											className="cline-ui-search-combobox__check"
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
