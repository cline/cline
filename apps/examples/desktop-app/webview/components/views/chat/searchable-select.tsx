"use client";

import { Check, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A button-styled select whose menu is a searchable, filterable list — the same
 * interaction the workspace and branch pickers use. The trigger shows the
 * current value with no chevron; clicking it opens the popover.
 */
export function SearchableSelect({
	value,
	items,
	onSelect,
	disabled = false,
	ariaLabel,
	searchPlaceholder = "Search...",
	emptyLabel = "No results",
	placeholder = "Select",
	icon,
	triggerClassName,
	align = "start",
	placement = "top",
}: {
	value: string;
	items: string[];
	onSelect: (value: string) => void;
	disabled?: boolean;
	ariaLabel: string;
	searchPlaceholder?: string;
	emptyLabel?: string;
	placeholder?: string;
	icon?: ReactNode;
	triggerClassName?: string;
	align?: "start" | "end";
	placement?: "top" | "bottom";
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	// Close on outside click; reset the filter each time the menu opens.
	useEffect(() => {
		if (!open) {
			setSearch("");
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setOpen(false);
			}
		};
		// pointerdown in the capture phase so we still fire before a portaled menu
		// (e.g. the Radix effort Select) handles its own trigger's pointerdown and
		// calls preventDefault, which would otherwise suppress a mousedown listener.
		document.addEventListener("pointerdown", handlePointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", handlePointerDown, true);
	}, [open]);

	const filtered = useMemo(
		() =>
			items.filter((item) => item.toLowerCase().includes(search.toLowerCase())),
		[items, search],
	);

	const handleSelect = (item: string) => {
		if (item !== value) onSelect(item);
		setOpen(false);
	};

	return (
		<div className="relative" ref={containerRef}>
			<button
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-label={ariaLabel}
				className={cn(
					"inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
					triggerClassName,
				)}
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				title={value}
				type="button"
			>
				{icon}
				<span className="truncate">{value || placeholder}</span>
			</button>

			{open && (
				<div
					className={cn(
						"absolute z-50 w-64 rounded-lg border border-border bg-popover shadow-xl",
						align === "end" ? "right-0" : "left-0",
						placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
					)}
				>
					<div className="border-b border-border p-2">
						<div className="flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
							<Search className="size-3 shrink-0 text-muted-foreground" />
							{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
							<Input
								autoFocus
								className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
								onChange={(event) => setSearch(event.target.value)}
								placeholder={searchPlaceholder}
								value={search}
							/>
						</div>
					</div>
					<div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto p-1.5">
						{filtered.length === 0 ? (
							<div className="px-2 py-2 text-xs text-muted-foreground">
								{emptyLabel}
							</div>
						) : (
							filtered.map((item) => (
								<button
									className={cn(
										"flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
										item === value ? "bg-accent" : "hover:bg-accent/50",
									)}
									key={item}
									onClick={() => handleSelect(item)}
									type="button"
								>
									<span className="truncate text-xs text-foreground">
										{item}
									</span>
									{item === value && (
										<Check className="ml-2 size-3 shrink-0 text-foreground" />
									)}
								</button>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
