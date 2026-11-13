"use client";

import { ChevronDown, Search } from "lucide-react";
import {
	type KeyboardEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { FS_GROUPS, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import {
	NAV_ITEM,
	NAV_ITEM_SELECTED,
	SECTION_LABEL,
	toneText,
} from "../factory-ui";
import type {
	SettingsFocus,
	SettingsGroupId,
	SettingsPageEntry,
	SettingsPageId,
} from "./types";

export type SettingsSearchHit = {
	page: SettingsPageId;
	pageTitle: string;
	row?: string;
	title: string;
	description?: string;
};

/**
 * The static search index: every page title and every row a page lists in
 * its `search`. Matches every word of the query in a row's page, group,
 * title or description.
 */
export function searchSettings(
	pages: readonly SettingsPageEntry[],
	query: string,
): SettingsSearchHit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const hits: SettingsSearchHit[] = [];
	for (const page of pages) {
		const context = `${page.title} ${FS_GROUPS[page.group]}`;
		const candidates: SettingsSearchHit[] = [
			{ page: page.id, pageTitle: page.title, title: page.title },
			...page.search.map((entry) => ({
				page: page.id,
				pageTitle: page.title,
				row: entry.row,
				title: entry.title,
				description: entry.description,
			})),
		];
		for (const hit of candidates) {
			const text =
				`${context} ${hit.title} ${hit.description ?? ""}`.toLowerCase();
			if (words.every((word) => text.includes(word))) hits.push(hit);
		}
	}
	return hits;
}

const GROUP_ORDER: readonly SettingsGroupId[] = [
	"factory",
	"workers",
	"pipeline",
	"where",
	"advanced",
];

export type SettingsBadges = Partial<
	Record<SettingsPageId, { count: number; label: string }>
>;

function Badge({ badge }: { badge?: { count: number; label: string } }) {
	if (!badge?.count) return null;
	return (
		<span
			data-settings-badge={badge.count}
			title={badge.label}
			className={cn(
				"ml-auto rounded-full bg-amber-500/15 px-1.5 text-[10.5px] leading-4 font-semibold tabular-nums",
				toneText("attention"),
			)}
		>
			{badge.count}
			<span className="sr-only">{` (${badge.label})`}</span>
		</span>
	);
}

/**
 * The search field and, while it has text, its results as a listbox in
 * place of the page list: arrows move, Enter opens, Esc clears.
 */
function SettingsSearch({
	pages,
	onOpen,
	children,
	autoFocus,
}: {
	pages: readonly SettingsPageEntry[];
	onOpen: (focus: SettingsFocus) => void;
	/** The page list, shown while the field is empty. */
	children: React.ReactNode;
	autoFocus?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const listId = useId();
	const hits = useMemo(() => searchSettings(pages, query), [pages, query]);
	const openHit = (hit: SettingsSearchHit | undefined) => {
		if (!hit) return;
		setQuery("");
		onOpen({ page: hit.page, row: hit.row });
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape" && query) {
			event.preventDefault();
			event.stopPropagation();
			setQuery("");
		} else if (event.key === "ArrowDown" && hits.length) {
			event.preventDefault();
			setActive((index) => (index + 1) % hits.length);
		} else if (event.key === "ArrowUp" && hits.length) {
			event.preventDefault();
			setActive((index) => (index - 1 + hits.length) % hits.length);
		} else if (event.key === "Enter") {
			event.preventDefault();
			openHit(hits[active]);
		}
	};
	const optionId = (index: number) => `${listId}-${index}`;
	return (
		<>
			<div className="relative px-2 pb-1">
				<Search
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-4.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<input
					type="search"
					// biome-ignore lint/a11y/noAutofocus: the folded menu opens on its search field.
					autoFocus={autoFocus}
					aria-label={FS_SHELL.search}
					aria-controls={query ? listId : undefined}
					aria-activedescendant={
						query && hits.length ? optionId(active) : undefined
					}
					placeholder={FS_SHELL.search}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={onKeyDown}
					className="h-[30px] w-full rounded-md border bg-transparent pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
				/>
			</div>
			{query ? (
				<div className="px-2 pt-1">
					{hits.length ? (
						<div
							id={listId}
							role="listbox"
							aria-label={FS_SHELL.searchResults}
							className="flex flex-col gap-0.5"
						>
							{hits.map((hit, index) => (
								<div
									key={`${hit.page}-${hit.row ?? ""}`}
									id={optionId(index)}
									role="option"
									tabIndex={-1}
									aria-selected={index === active}
									data-search-hit={hit.row ?? hit.page}
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() => setActive(index)}
									onClick={() => openHit(hit)}
									onKeyDown={(event) => {
										if (event.key === "Enter") openHit(hit);
									}}
									className={cn(
										"cursor-pointer rounded-md px-2.5 py-1.5",
										index === active && "bg-surface-hover",
									)}
								>
									<span className="block truncate text-[13px]">
										{hit.title}
									</span>
									{hit.row ? (
										<span className="block truncate text-[11px] text-muted-foreground">
											{hit.pageTitle}
										</span>
									) : null}
								</div>
							))}
						</div>
					) : (
						<p className="px-2.5 py-1.5 text-xs text-muted-foreground">
							{FS_SHELL.noResults(query)}
						</p>
					)}
				</div>
			) : (
				children
			)}
		</>
	);
}

function PageGroups({
	pages,
	current,
	badges,
	onOpen,
	asMenu,
}: {
	pages: readonly SettingsPageEntry[];
	current: SettingsPageId;
	badges: SettingsBadges;
	onOpen: (focus: SettingsFocus) => void;
	asMenu?: boolean;
}) {
	return (
		<div className="flex flex-col pb-3">
			{GROUP_ORDER.map((group, index) => {
				const labelClass = cn(
					"px-4.5 pb-1.5",
					index === 0 ? "pt-2" : "pt-4",
					SECTION_LABEL,
				);
				return (
					<div
						key={group}
						{...(asMenu
							? { role: "group", "aria-label": FS_GROUPS[group] }
							: {})}
					>
						{asMenu ? (
							<p aria-hidden className={labelClass}>
								{FS_GROUPS[group]}
							</p>
						) : (
							<h3 className={labelClass}>{FS_GROUPS[group]}</h3>
						)}
						<div className="flex flex-col gap-0.5 px-2">
							{pages
								.filter((page) => page.group === group)
								.map((page) => (
									<Button
										key={page.id}
										type="button"
										variant="sidebarItem"
										role={asMenu ? "menuitem" : undefined}
										data-settings-page={page.id}
										aria-current={
											!asMenu && current === page.id ? "page" : undefined
										}
										onClick={() => onOpen({ page: page.id })}
										className={cn(
											"!h-7 !px-2.5 py-0 text-[13px]",
											NAV_ITEM,
											current === page.id && NAV_ITEM_SELECTED,
										)}
									>
										<page.icon
											aria-hidden
											className="size-3.5 shrink-0 opacity-70"
										/>
										<span className="truncate">{page.title}</span>
										<Badge badge={badges[page.id]} />
									</Button>
								))}
						</div>
					</div>
				);
			})}
		</div>
	);
}

/** The section list: search, then five groups of pages. 200px. */
export function SettingsNav({
	pages,
	current,
	badges,
	onOpen,
}: {
	pages: readonly SettingsPageEntry[];
	current: SettingsPageId;
	badges: SettingsBadges;
	onOpen: (focus: SettingsFocus) => void;
}) {
	return (
		<nav
			aria-label={FS_SHELL.nav}
			data-settings-nav=""
			className="flex w-[200px] shrink-0 flex-col overflow-y-auto border-r pt-2.5"
		>
			<SettingsSearch pages={pages} onOpen={onOpen}>
				<PageGroups
					pages={pages}
					current={current}
					badges={badges}
					onOpen={onOpen}
				/>
			</SettingsSearch>
		</nav>
	);
}

/**
 * The folded section list: a "{Page} ▾" button in the header that opens a
 * menu with the same search, groups and counts.
 */
export function SettingsPageMenu({
	pages,
	current,
	badges,
	onOpen,
}: {
	pages: readonly SettingsPageEntry[];
	current: SettingsPageId;
	badges: SettingsBadges;
	onOpen: (focus: SettingsFocus) => void;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const menuId = useId();
	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [open]);
	const total = Object.values(badges).reduce(
		(sum, badge) => sum + (badge?.count ?? 0),
		0,
	);
	const title = pages.find((page) => page.id === current)?.title ?? "";
	const close = () => {
		setOpen(false);
		buttonRef.current?.focus();
	};
	return (
		<div ref={rootRef} className="relative min-w-0">
			<Button
				ref={buttonRef}
				variant="outline"
				size="xs"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				data-settings-page-menu=""
				onClick={() => setOpen((value) => !value)}
				className="h-[26px] max-w-[200px] gap-1 px-2 text-[13px]"
			>
				<span className="truncate">{title}</span>
				{total ? (
					<span
						className={cn(
							"rounded-full bg-amber-500/15 px-1.5 text-[10.5px] leading-4 font-semibold",
							toneText("attention"),
						)}
					>
						{total}
					</span>
				) : null}
				<ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
			</Button>
			{open ? (
				<div
					id={menuId}
					role="menu"
					aria-label={FS_SHELL.pageMenuLabel}
					tabIndex={-1}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							close();
						}
					}}
					className="absolute top-[calc(100%+4px)] left-0 z-50 max-h-[min(560px,calc(100vh-80px))] w-[232px] overflow-y-auto rounded-lg border bg-popover pt-2 text-popover-foreground shadow-lg"
				>
					<SettingsSearch
						pages={pages}
						autoFocus
						onOpen={(focus) => {
							close();
							onOpen(focus);
						}}
					>
						<PageGroups
							asMenu
							pages={pages}
							current={current}
							badges={badges}
							onOpen={(focus) => {
								close();
								onOpen(focus);
							}}
						/>
					</SettingsSearch>
				</div>
			) : null}
		</div>
	);
}
