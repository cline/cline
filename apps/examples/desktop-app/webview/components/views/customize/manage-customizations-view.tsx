"use client";

import { findScrollViewport } from "../shared/page-scroll";
import {
	type InstalledCustomizationActions,
	InstalledCustomizationSections,
} from "./installed-customization-sections";
import type { CustomizeTab } from "./navigation/customize-categories";
import { CustomizeCategoryBar } from "./navigation/customize-category-bar";
import { useCustomizeStickyHeaders } from "./shared/use-customize-sticky-headers";
import { useInstalledCustomizations } from "./use-installed-customizations";

/** Manage owns category navigation; domain sections and data are shared with search. */
export function ManageCustomizationsView({
	tab,
	onTabChange,
	actions,
}: {
	tab: CustomizeTab;
	onTabChange: (tab: CustomizeTab) => void;
	actions: InstalledCustomizationActions;
}) {
	const model = useInstalledCustomizations({ tab });
	const { contentRef, categoriesRef } = useCustomizeStickyHeaders();
	return (
		<div className="min-w-0" ref={contentRef} data-customize-sections="">
			<CustomizeCategoryBar
				ref={categoriesRef}
				mode="manage"
				value={tab}
				onValueChange={onTabChange}
			/>
			<InstalledCustomizationSections
				model={model}
				actions={actions}
				onViewAll={(category) => {
					onTabChange(category);
					const viewport = findScrollViewport(contentRef.current);
					if (viewport) viewport.scrollTop = 0;
				}}
			/>
		</div>
	);
}
