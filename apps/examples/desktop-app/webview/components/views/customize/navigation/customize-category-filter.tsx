"use client";

import { Button } from "@cline/ui";
import { ChevronDown } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	fetchMarketplaceCatalog,
	getCachedMarketplaceCatalog,
} from "@/lib/marketplace";
import { useComposioCatalog } from "@/lib/use-composio-catalog";
import { useComposioStatus } from "@/lib/use-composio-status";

export type CustomizationTopic = { id: string; label: string };

function categoryKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, "-");
}

/** Catalog IDs and connector labels can differ in capitalization or separators. */
export function matchesCustomizeCategory(
	category: CustomizationTopic | null,
	tags: readonly string[] | undefined,
): boolean {
	if (!category) return true;
	const keys = new Set([categoryKey(category.id), categoryKey(category.label)]);
	return tags?.some((tag) => keys.has(categoryKey(tag))) ?? false;
}

const CategoryFilterContext = createContext<{
	category: CustomizationTopic | null;
	setCategory: (category: CustomizationTopic | null) => void;
	categories: CustomizationTopic[];
} | null>(null);

export function useCustomizeCategoryFilter() {
	return useContext(CategoryFilterContext);
}

/** Own the topic filter for the whole Customize visit, independently of its tabs. */
export function CustomizeCategoryFilterProvider({
	children,
	view = "browse",
}: {
	children: ReactNode;
	view?: "browse" | "manage";
}) {
	const [category, setCategory] = useState<CustomizationTopic | null>(null);
	const [catalog, setCatalog] = useState(getCachedMarketplaceCatalog);
	const { status } = useComposioStatus();
	const { catalog: connectors } = useComposioCatalog(
		status?.configured ?? false,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Navigation rechecks cached catalogs so a failed first read can recover.
	useEffect(() => {
		let cancelled = false;
		void fetchMarketplaceCatalog()
			.then((value) => {
				if (!cancelled) setCatalog(value);
			})
			.catch(() => {}); // The content views present catalog loading errors.
		return () => {
			cancelled = true;
		};
	}, [view]);

	const categories = useMemo(() => {
		const options: CustomizationTopic[] = [];
		const keys = new Set<string>();
		for (const option of [
			...(catalog?.tags ?? []),
			...(connectors?.toolkits.flatMap((toolkit) =>
				(toolkit.categories ?? []).map((label) => ({
					id: categoryKey(label),
					label,
				})),
			) ?? []),
		]) {
			if (!option.id.trim() || !option.label.trim()) continue;
			if (
				keys.has(categoryKey(option.id)) ||
				keys.has(categoryKey(option.label))
			)
				continue;
			keys.add(categoryKey(option.id));
			keys.add(categoryKey(option.label));
			options.push({ id: option.id, label: option.label });
		}
		// Retain an active option even if a refresh removes its last catalog entry.
		if (category && !options.some((option) => option.id === category.id))
			options.push(category);
		return options.sort((left, right) => left.label.localeCompare(right.label));
	}, [catalog, connectors, category]);
	const value = useMemo(
		() => ({ category, setCategory, categories }),
		[category, categories],
	);
	return (
		<CategoryFilterContext.Provider value={value}>
			{children}
		</CategoryFilterContext.Provider>
	);
}

export function CustomizeCategoryFilter() {
	const filter = useCustomizeCategoryFilter();
	if (!filter) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`Filter by category: ${filter.category?.label ?? "All categories"}`}
					data-customize-focus="category-filter"
					className="ml-auto max-w-40"
					size="sm"
					tone="neutral"
					type="button"
					variant={filter.category ? "secondary" : "ghost"}
					trailingIcon={ChevronDown}
				>
					<span className="truncate">
						{filter.category?.label ?? "All categories"}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuRadioGroup
					value={filter.category?.id ?? ""}
					onValueChange={(id) =>
						filter.setCategory(
							filter.categories.find((option) => option.id === id) ?? null,
						)
					}
				>
					<DropdownMenuRadioItem value="">All categories</DropdownMenuRadioItem>
					{filter.categories.map((option) => (
						<DropdownMenuRadioItem key={option.id} value={option.id}>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
