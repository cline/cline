import * as Popover from "@radix-ui/react-popover";
import { Command, defaultFilter } from "cmdk";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { cx } from "./utils.js";

function filterVisibleOptionText(
	_value: string,
	search: string,
	keywords: string[] = [],
): number {
	const visibleText = keywords.join(" ").trim();
	return visibleText ? defaultFilter(visibleText, search) : 0;
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
	onValueChange: (value: string) => void;
	options: SearchComboboxOption[];
	placeholder?: string;
	/** Portal root inside the host theme scope; defaults to the document body. */
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
	onValueChange,
	options,
	placeholder = "Select an option…",
	portalContainer,
	searchPlaceholder = "Search…",
	value,
}: SearchComboboxProps) {
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(value ?? "");
	const unavailable = disabled || loading;
	const visiblyOpen = open && !unavailable;
	useEffect(() => {
		if (unavailable) setOpen(false);
	}, [unavailable]);
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
				if (nextOpen && !unavailable) setCommandValue(value ?? "");
				if (!nextOpen || !unavailable) setOpen(nextOpen);
			}}
			open={visiblyOpen}
		>
			<Popover.Trigger asChild>
				<button
					aria-busy={loading || undefined}
					aria-disabled={unavailable || undefined}
					aria-label={`${ariaLabel}: ${displayedValue}`}
					aria-expanded={visiblyOpen}
					className={cx("cline-ui-combobox__trigger", className)}
					onClick={(event) => {
						if (unavailable) event.preventDefault();
					}}
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
			<Popover.Portal container={portalContainer ?? undefined}>
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
						<Command.List className="cline-ui-combobox__list">
							<Command.Empty className="cline-ui-combobox__empty">
								<span aria-live="polite" role="status">
									{emptyText}
								</span>
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
						</Command.List>
					</Command>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
