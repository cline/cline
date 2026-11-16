"use client";

import { Badge } from "@cline/ui";
import {
	createContext,
	type ReactNode,
	useContext,
	useId,
	useRef,
} from "react";
import { cn } from "@/lib/utils";
import type { MarketplaceTypeFilter } from "../marketplace/marketplace-type-meta";
import {
	type CustomizationTopic,
	matchesCustomizeCategory,
	useCustomizeCategoryFilter,
} from "../navigation/customize-category-filter";

const CategoryNavigationContext = createContext<{
	onSelectCategory: (category: CustomizationTopic) => void;
	onSelectType?: (type: MarketplaceTypeFilter | null) => void;
	onRestoreFocus?: () => void;
} | null>(null);

export function CustomizationCategoryNavigationProvider({
	children,
	onSelectCategory,
	onSelectType,
	onRestoreFocus,
}: {
	children: ReactNode;
	onSelectCategory: (category: CustomizationTopic) => void;
	onSelectType?: (type: MarketplaceTypeFilter | null) => void;
	onRestoreFocus?: () => void;
}) {
	return (
		<CategoryNavigationContext.Provider
			value={{ onSelectCategory, onSelectType, onRestoreFocus }}
		>
			{children}
		</CategoryNavigationContext.Provider>
	);
}

export function useCustomizationDetailNavigation() {
	return useContext(CategoryNavigationContext);
}

/** Badge navigation owns focus after closing its originating dialog. */
export function useCustomizationCategoryDialog(onDismiss: () => void) {
	const navigation = useContext(CategoryNavigationContext);
	const selectedFilter = useRef(false);
	return {
		onSelected: () => {
			selectedFilter.current = true;
			onDismiss();
		},
		onCloseAutoFocus: (event: Event) => {
			if (!selectedFilter.current) return;
			selectedFilter.current = false;
			if (!navigation?.onRestoreFocus) return;
			event.preventDefault();
			navigation.onRestoreFocus();
		},
	};
}

interface CustomizationCategoryProps {
	categories: readonly string[];
	tagLabels?: Map<string, string>;
	onSelectCategory?: (category: string) => void;
	onSelected?: () => void;
	className?: string;
}

/** Keep category presentation and selection consistent in dialogs and pages. */
export function CustomizationCategorySection({
	className,
	...props
}: CustomizationCategoryProps) {
	const headingId = useId();
	if (props.categories.length === 0) return null;

	return (
		<section
			aria-labelledby={headingId}
			className={cn("grid gap-3", className)}
		>
			<h2 className="font-semibold text-foreground text-md" id={headingId}>
				<span>Category</span>
			</h2>
			<CustomizationCategoryBadges {...props} />
		</section>
	);
}

export function CustomizationCategoryBadges({
	categories,
	tagLabels,
	onSelectCategory,
	onSelected,
	className,
}: CustomizationCategoryProps) {
	const filter = useCustomizeCategoryFilter();
	const navigation = useContext(CategoryNavigationContext);
	const canSelect = Boolean(
		onSelectCategory || navigation || filter?.setCategory,
	);
	const resolvedCategories = new Map<
		string,
		{ value: string; category: CustomizationTopic }
	>();
	for (const value of categories) {
		const label = tagLabels?.get(value) ?? value;
		const category = filter?.categories?.find((option) =>
			matchesCustomizeCategory(option, [value, label]),
		) ?? { id: value, label };
		if (!resolvedCategories.has(category.id)) {
			resolvedCategories.set(category.id, { value, category });
		}
	}

	if (categories.length === 0) return null;

	return (
		<div className={cn("flex flex-wrap gap-1.5", className)}>
			{[...resolvedCategories.values()].map(({ value, category }) => {
				return (
					<Badge
						interactive
						disabled={!canSelect}
						key={value}
						onClick={() => {
							if (onSelectCategory) onSelectCategory(value);
							else if (navigation) navigation.onSelectCategory(category);
							else filter?.setCategory(category);
							onSelected?.();
						}}
						size="xs"
						title={`Filter by ${category.label}`}
						type="button"
						tone="neutral"
					>
						{category.label}
					</Badge>
				);
			})}
		</div>
	);
}
