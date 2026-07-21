import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { cx } from "./utils.js";

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
	searchPlaceholder = "Search…",
	value,
}: SearchComboboxProps) {
	const [open, setOpen] = useState(false);
	const popoverId = useId();
	const selected = options.find((option) => option.value === value);

	return (
		<Popover.Root onOpenChange={setOpen} open={open}>
			<Popover.Trigger asChild>
				<button
					aria-controls={popoverId}
					aria-haspopup="listbox"
					aria-label={ariaLabel}
					aria-expanded={open}
					className={cx("cline-ui-combobox__trigger", className)}
					disabled={disabled || loading}
					role="combobox"
					type="button"
				>
					{loading ? (
						<span aria-hidden="true" className="cline-ui-spinner" />
					) : (
						selected?.icon
					)}
					<span className="cline-ui-combobox__value">
						{loading ? "Loading…" : (selected?.label ?? placeholder)}
					</span>
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
			<Popover.Portal>
				<Popover.Content
					align="start"
					className="cline-ui-theme cline-ui-combobox__popover"
					collisionPadding={8}
					id={popoverId}
					sideOffset={6}
				>
					<Command className="cline-ui-combobox__command" label={ariaLabel}>
						<Command.Input
							aria-label={`Search ${ariaLabel.toLowerCase()}`}
							className="cline-ui-combobox__search"
							placeholder={searchPlaceholder}
						/>
						<Command.List className="cline-ui-combobox__list">
							<Command.Empty className="cline-ui-combobox__empty">
								{emptyText}
							</Command.Empty>
							{options.map((option) => (
								<Command.Item
									className="cline-ui-combobox__option"
									key={option.value}
									onSelect={() => {
										onValueChange(option.value);
										setOpen(false);
									}}
									value={`${option.label} ${option.description ?? ""} ${option.value}`}
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
