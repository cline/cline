"use client";

import { Button, IconButton, SectionHeading } from "@cline/ui";
import { Globe, Search, Settings2, X } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Input } from "@/components/ui/input";
import { useDetailNavigation } from "@/lib/detail-navigation";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { useLeaveConfirmation } from "@/lib/unsaved-changes";
import { MarketplaceActionsProvider } from "@/lib/use-marketplace-directory";
import { cn } from "@/lib/utils";
import { PageFrame, PageShell } from "../page-layout";
import {
	findScrollViewport,
	queryScrollViewports,
} from "../shared/page-scroll";
import { useReturnPosition } from "../shared/use-return-position";
import {
	type CloseCustomizationDetail,
	type CustomizationDetailSelection,
	CustomizationDetailView,
} from "./customization-detail-view";
import styles from "./customize-page.module.css";
import {
	CUSTOMIZATION_SECTION_LABELS,
	type CustomizeSection,
} from "./customize-sections";
import type { InstalledCustomizationActions } from "./installed-customization-sections";
import { ManageCustomizationsView } from "./manage-customizations-view";
import { MarketplaceExplorerView } from "./marketplace/marketplace-explorer-view";
import type { MarketplaceTypeFilter } from "./marketplace/marketplace-type-meta";
import {
	browseFilterToCustomizeTab,
	type CustomizeTab,
	customizeTabToBrowseFilter,
} from "./navigation/customize-categories";
import {
	type CustomizationTopic,
	CustomizeCategoryFilterProvider,
	useCustomizeCategoryFilter,
} from "./navigation/customize-category-filter";
import { CustomizeCategoryTransitionProvider } from "./navigation/customize-pill-selector";
import { CustomizeSearchResults } from "./search/customize-search-results";
import { CustomizationCategoryNavigationProvider } from "./shared/customization-category-section";
import { CustomizeRefreshProvider } from "./shared/customize-refresh";

const CUSTOMIZATION_NAV_ITEMS = [
	{ section: "manage", icon: Settings2 },
	{ section: "browse", icon: Globe },
] as const;

/** The open detail page, as one step of Back/Forward history. */
type CustomizationDetail = {
	selection: CustomizationDetailSelection;
	section: CustomizeSection;
	backLabel: string;
};

type CustomizePageProps = {
	section: CustomizeSection;
	customizeCategory: CustomizeTab;
	onCustomizeCategoryChange: (category: CustomizeTab) => void;
	onNavigateSection: (section: CustomizeSection) => void;
	onOpenModelProviders: () => void;
	/** Isolated page previews can supply content without loading real inventory. */
	manageContent?: ReactNode;
};

/** Persistent shell and detail navigation shared by Browse, Manage, and search. */
export function CustomizePage(props: CustomizePageProps) {
	return (
		<MarketplaceActionsProvider>
			<CustomizeCategoryFilterProvider view={props.section}>
				<CustomizePageContent {...props} />
			</CustomizeCategoryFilterProvider>
		</MarketplaceActionsProvider>
	);
}

function CustomizePageContent({
	section,
	customizeCategory,
	onCustomizeCategoryChange,
	onNavigateSection,
	onOpenModelProviders,
	manageContent,
}: CustomizePageProps) {
	const categoryFilter = useCustomizeCategoryFilter();
	const [customizeSearchQuery, setCustomizeSearchQuery] = useState("");
	const searching = customizeSearchQuery.trim().length > 0;
	const pageRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const confirmLeave = useLeaveConfirmation();
	const {
		detail: customizationDetail,
		open: openDetail,
		close: closeDetail,
		leaveFor,
	} = useDetailNavigation<CustomizationDetail>();
	// Where the list was left, and which section it belongs to.
	const returnPosition = useReturnPosition();
	const returnSection = useRef<CustomizeSection | null>(null);
	// After a badge closes a detail, focus moves to the filter it applied.
	const filterFocusPending = useRef<"category" | "type" | null>(null);
	const openCustomizationDetail = (
		selection: CustomizationDetailSelection,
		trigger?: HTMLButtonElement,
	) => {
		returnPosition.remember(trigger ?? null, findScrollViewport(trigger));
		returnSection.current = section;
		openDetail({
			selection,
			section,
			backLabel: searching
				? "Search results"
				: CUSTOMIZATION_SECTION_LABELS[section],
		});
	};
	const detailActions: InstalledCustomizationActions = {
		onCreateMcp: (trigger) =>
			openCustomizationDetail({ type: "mcp-create" }, trigger),
		onOpenModelProviders,
		onOpenSkill: (selection, trigger) =>
			openCustomizationDetail({ type: "skill", selection }, trigger),
		onOpenWorkflow: (selection, trigger) =>
			openCustomizationDetail({ type: "workflow", selection }, trigger),
		onOpenRule: (selection, trigger) =>
			openCustomizationDetail({ type: "rule", selection }, trigger),
		onOpenPlugin: (selection, trigger) =>
			openCustomizationDetail({ type: "plugin", selection }, trigger),
		onOpenMcp: (selection, trigger) =>
			openCustomizationDetail({ type: "mcp", selection }, trigger),
	};
	const openMarketplaceDetail = (
		entry: MarketplaceEntry,
		trigger?: HTMLButtonElement,
	) =>
		openCustomizationDetail(
			entry.type === "plugin"
				? { type: "plugin", selection: { entry } }
				: { type: "marketplace", entry },
			trigger,
		);
	const closeCustomizationDetail: CloseCustomizationDetail = (options) => {
		// The card that opened a removed item is gone; keep only the scroll offset.
		if (options?.uninstalled) returnPosition.forgetTrigger();
		closeDetail({ forget: options?.uninstalled });
	};
	const focusDetailResults = () => {
		for (const viewport of queryScrollViewports(pageRef.current)) {
			if (!viewport.closest("[hidden]")) viewport.scrollTop = 0;
		}
		const typeFilter =
			filterFocusPending.current === "type"
				? pageRef.current?.querySelector<HTMLElement>(
						'[data-customize-category-page="browse"] [role="radio"][aria-checked="true"]',
					)
				: null;
		const target =
			typeFilter ??
			pageRef.current?.querySelector<HTMLElement>(
				'[data-customize-focus="category-filter"]',
			);
		target?.focus({ preventScroll: true });
	};
	const selectDetailCategory = (category: CustomizationTopic) =>
		confirmLeave(() => {
			filterFocusPending.current = "category";
			categoryFilter?.setCategory({ ...category });
			setCustomizeSearchQuery("");
			returnPosition.forget();
			closeDetail();
		});
	const selectDetailType = (type: MarketplaceTypeFilter | null) =>
		confirmLeave(() => {
			filterFocusPending.current = "type";
			categoryFilter?.setCategory(null);
			setCustomizeSearchQuery("");
			returnPosition.forget();
			leaveFor(() => {
				onCustomizeCategoryChange(browseFilterToCustomizeTab(type));
				onNavigateSection("browse");
			});
		});
	const showingCustomizationDetail = customizationDetail?.section === section;
	useEffect(() => {
		// Rendered on its own, the page drops a detail when its section changes.
		if (customizationDetail && customizationDetail.section !== section)
			closeDetail();
	}, [customizationDetail, section, closeDetail]);
	useLayoutEffect(() => {
		if (showingCustomizationDetail) return;
		if (filterFocusPending.current) {
			focusDetailResults();
			filterFocusPending.current = null;
			return;
		}
		if (returnSection.current !== section) {
			if (returnSection.current) returnPosition.forget();
			returnSection.current = null;
			return;
		}
		returnSection.current = null;
		returnPosition.restore(() =>
			(
				pageRef.current?.querySelector<HTMLElement>(
					'[role="radio"][aria-checked="true"]',
				) ?? searchInputRef.current
			)?.focus({ preventScroll: true }),
		);
	});
	const isManageView = section === "manage" && !searching;
	const browseTypeFilter = customizeTabToBrowseFilter(customizeCategory);
	useEffect(() => {
		// Inventory-only categories have no Browse counterpart. Normalize the
		// shared selection even when navigation comes from back/forward.
		if (section === "browse" && browseTypeFilter === undefined) {
			onCustomizeCategoryChange("all");
		}
	}, [section, browseTypeFilter, onCustomizeCategoryChange]);

	// Container queries expose one copy, in either the header or the sidebar.
	const sectionNavigation = (
		<div
			className={cn(
				"group/customize-nav relative isolate grid grid-cols-2 gap-1.5 self-start",
				styles.navigation,
			)}
		>
			{/* Size to the first grid cell, then slide one cell plus the gap. */}
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-0 col-start-1 col-end-2 row-start-1 row-end-2 rounded-md bg-surface-3 transition-[translate,scale] duration-[200ms,40ms] ease-out motion-safe:group-has-[[aria-current=page]:active]/customize-nav:scale-[0.98] motion-reduce:transition-none",
					section === "browse" && styles.browseSelected,
					searching && "opacity-0",
				)}
			/>
			{CUSTOMIZATION_NAV_ITEMS.map((item) => (
				<Button
					aria-current={
						!searching && section === item.section ? "page" : undefined
					}
					className="relative min-h-9 justify-start gap-2.5 rounded-md px-3 text-base text-foreground/80 transition-colors duration-150 hover:bg-transparent hover:text-foreground focus-visible:text-foreground motion-reduce:transition-none"
					key={item.section}
					onClick={() => {
						setCustomizeSearchQuery("");
						onNavigateSection(item.section);
					}}
					pressScale={false}
					tone="neutral"
					type="button"
					variant="ghost"
					leadingIcon={item.icon}
				>
					{CUSTOMIZATION_SECTION_LABELS[item.section]}
				</Button>
			))}
		</div>
	);

	const page = (
		<PageFrame
			headerFade
			header={{
				className: styles.header,
				title: (
					<>
						Customize
						<span
							aria-hidden="true"
							className="inline-block size-0"
							data-customize-title-baseline=""
						/>
					</>
				),
				meta: (
					<nav
						aria-label="Customize sections"
						className={styles.headerNavigation}
					>
						{sectionNavigation}
					</nav>
				),
				description: (
					<span className={styles.description}>
						Extend what Cline can do and how it works.
					</span>
				),
				actions: (
					<search
						aria-label="Customize"
						className="relative w-66.5 max-w-full shrink-0"
					>
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							ref={searchInputRef}
							aria-label="Search customizations"
							type="search"
							placeholder="Search connectors, skills, MCPs…"
							className={cn(
								"h-9.5 rounded-md border-border bg-background py-0 pl-9.25 text-sm shadow-none dark:bg-background [&::-webkit-search-cancel-button]:appearance-none",
								customizeSearchQuery ? "pr-9" : "pr-3",
							)}
							value={customizeSearchQuery}
							onChange={(event) => setCustomizeSearchQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setCustomizeSearchQuery("");
								}
							}}
						/>
						{customizeSearchQuery ? (
							<IconButton
								aria-label="Clear customization search"
								className="absolute top-1/2 right-1 -translate-y-1/2"
								onClick={() => setCustomizeSearchQuery("")}
								size="xs"
								tone="neutral"
								variant="ghost"
								icon={X}
							/>
						) : null}
					</search>
				),
			}}
			navigation={sectionNavigation}
			navigationLabel="Customize sections"
			scrollMode={searching ? "content" : "page"}
			windowTitleBar
		>
			<CustomizeRefreshProvider enabled={isManageView}>
				<section
					aria-labelledby="customize-section-heading"
					className="flex min-h-0 min-w-0 flex-1 flex-col"
				>
					<SectionHeading
						className={cn(
							"mb-5 min-h-8 shrink-0",
							!searching && styles.sectionTitle,
						)}
						size="xl"
						title={
							<span id="customize-section-heading">
								{searching
									? "Search results"
									: CUSTOMIZATION_SECTION_LABELS[section]}
							</span>
						}
					/>
					{searching ? (
						<CustomizeSearchResults
							query={customizeSearchQuery}
							actions={detailActions}
							onOpenMarketplaceDetail={openMarketplaceDetail}
						/>
					) : section === "browse" ? (
						<MarketplaceExplorerView
							onCreateMcp={detailActions.onCreateMcp}
							typeFilter={browseTypeFilter ?? null}
							onTypeFilterChange={(filter) =>
								onCustomizeCategoryChange(browseFilterToCustomizeTab(filter))
							}
							onOpenDetail={openMarketplaceDetail}
						/>
					) : (
						(manageContent ?? (
							<ManageCustomizationsView
								actions={detailActions}
								tab={customizeCategory}
								onTabChange={onCustomizeCategoryChange}
							/>
						))
					)}
				</section>
			</CustomizeRefreshProvider>
		</PageFrame>
	);

	return (
		<CustomizationCategoryNavigationProvider
			onSelectCategory={selectDetailCategory}
			onSelectType={selectDetailType}
			onRestoreFocus={focusDetailResults}
		>
			<PageShell
				ref={pageRef}
				className={cn("cline-customize-content", styles.page)}
			>
				<div
					hidden={showingCustomizationDetail}
					className="h-full min-h-0 overflow-hidden"
				>
					<CustomizeCategoryTransitionProvider
						view={
							showingCustomizationDetail || searching
								? null
								: section === "browse"
									? "browse"
									: "manage"
						}
					>
						{page}
					</CustomizeCategoryTransitionProvider>
				</div>
				{showingCustomizationDetail && customizationDetail ? (
					<CustomizationDetailView
						selection={customizationDetail.selection}
						backLabel={customizationDetail.backLabel}
						onBack={closeCustomizationDetail}
					/>
				) : null}
			</PageShell>
		</CustomizationCategoryNavigationProvider>
	);
}
