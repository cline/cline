import * as Popover from "@radix-ui/react-popover";
import { Command, defaultFilter, useCommandState } from "cmdk";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { cx } from "./utils.js";

function filterVisibleOptionText(
	_value: string,
	search: string,
	keywords: string[] = [],
): number {
	const visibleText = keywords.join(" ").trim();
	return visibleText ? defaultFilter(visibleText, search) : 0;
}

function SearchComboboxStatus({
	emptyText,
	loading,
	loadingText,
}: {
	emptyText: string;
	loading: boolean;
	loadingText: string;
}) {
	const resultCount = useCommandState((state) => state.filtered.count);
	const search = useCommandState((state) => state.search);
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		setAnnouncement(
			loading
				? loadingText
				: search.trim() && resultCount === 0
					? emptyText
					: "",
		);
	}, [emptyText, loading, loadingText, resultCount, search]);

	return (
		<output aria-live="polite" className="cline-ui-sr-only">
			{announcement}
		</output>
	);
}

export interface SearchComboboxOption {
	description?: string;
	icon?: ReactNode;
	label: string;
	value: string;
}

export interface SearchComboboxProps {
	ariaLabel: string;
	className?: string;
	disabled?: boolean;
	emptyText?: string;
	loading?: boolean;
	loadingText?: string;
	onValueChange: (value: string) => void;
	options: SearchComboboxOption[];
	placeholder?: string;
	/** Portal root; defaults to the nearest `.cline-ui-theme`, then the document body. */
	portalContainer?: HTMLElement | null;
	searchPlaceholder?: string;
	value?: string;
}

export function SearchCombobox({
	ariaLabel,
	className,
	disabled = false,
	emptyText = "No results found.",
	loading = false,
	loadingText = "Loading options…",
	onValueChange,
	options,
	placeholder = "Select an option…",
	portalContainer,
	searchPlaceholder = "Search…",
	value,
}: SearchComboboxProps) {
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(value ?? "");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const visiblyOpen = open && !disabled;
	const resolvedPortalContainer =
		portalContainer === undefined
			? (triggerRef.current?.closest(".cline-ui-theme") as HTMLElement | null)
			: portalContainer;
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);
	useEffect(() => {
		if (!open) setCommandValue(value ?? "");
	}, [open, value]);
	const selected = options.find((option) => option.value === value);
	const displayedValue = loading
		? "Loading…"
		: (selected?.label ?? placeholder);

	return (
		<Popover.Root
			onOpenChange={(nextOpen) => {
				if (nextOpen && !disabled) setCommandValue(value ?? "");
				if (!nextOpen || !disabled) setOpen(nextOpen);
			}}
			open={visiblyOpen}
		>
			<Popover.Trigger asChild>
				<button
					aria-busy={loading || undefined}
					aria-disabled={disabled || undefined}
					aria-label={`${ariaLabel}: ${displayedValue}`}
					aria-expanded={visiblyOpen}
					className={cx("cline-ui-combobox__trigger", className)}
					onClick={(event) => {
						if (disabled) event.preventDefault();
					}}
					ref={triggerRef}
					type="button"
				>
					{loading ? (
						<span aria-hidden="true" className="cline-ui-spinner" />
					) : (
						selected?.icon
					)}
					<span className="cline-ui-combobox__value">{displayedValue}</span>
					<svg
						aria-hidden="true"
						className="cline-ui-combobox__chevrons"
						fill="none"
						viewBox="0 0 16 16"
					>
						<path
							d="m5 6 3-3 3 3M5 10l3 3 3-3"
							stroke="currentColor"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="1.25"
						/>
					</svg>
				</button>
			</Popover.Trigger>
			<Popover.Portal container={resolvedPortalContainer ?? undefined}>
				<Popover.Content
					align="start"
					className="cline-ui-theme cline-ui-combobox__popover"
					collisionPadding={8}
					sideOffset={6}
				>
					<Command
						className="cline-ui-combobox__command"
						filter={filterVisibleOptionText}
						label={`Search ${ariaLabel.toLowerCase()}`}
						onValueChange={setCommandValue}
						value={commandValue}
					>
						<Command.Input
							className="cline-ui-combobox__search"
							placeholder={searchPlaceholder}
						/>
						<SearchComboboxStatus
							emptyText={emptyText}
							loading={loading}
							loadingText={loadingText}
						/>
						<Command.List className="cline-ui-combobox__list">
							{loading ? (
								<div aria-hidden="true" className="cline-ui-combobox__loading">
									{loadingText}
								</div>
							) : (
								<>
									<Command.Empty className="cline-ui-combobox__empty">
										{emptyText}
									</Command.Empty>
									{options.map((option) => (
										<Command.Item
											className="cline-ui-combobox__option"
											key={option.value}
											keywords={[option.label, option.description ?? ""]}
											onSelect={() => {
												onValueChange(option.value);
												setOpen(false);
											}}
											value={option.value}
										>
											{option.icon}
											<span className="cline-ui-combobox__option-copy">
												<span>{option.label}</span>
												{option.description ? (
													<small>{option.description}</small>
												) : null}
											</span>
											{option.value === value ? (
												<span
													aria-hidden="true"
													className="cline-ui-combobox__check"
												>
													✓
												</span>
											) : null}
										</Command.Item>
									))}
								</>
							)}
						</Command.List>
					</Command>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
