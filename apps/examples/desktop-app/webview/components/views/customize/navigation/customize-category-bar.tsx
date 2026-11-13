"use client";

import { Badge } from "@cline/ui";
import { forwardRef } from "react";
import { CustomizeRefreshButton } from "../shared/customize-refresh";
import {
	CUSTOMIZE_CATEGORIES,
	type CustomizeTab,
} from "./customize-categories";
import { CustomizeCategoryFilter } from "./customize-category-filter";
import {
	CustomizePillSelector,
	CustomizePillSelectorItem,
} from "./customize-pill-selector";

type CustomizeCategoryBarProps = {
	mode: "browse" | "manage";
	value: CustomizeTab;
	onValueChange: (value: CustomizeTab) => void;
	connectorsAvailable?: boolean;
};

/** Shared navigation and sticky spacing for the two Customize inventories. */
export const CustomizeCategoryBar = forwardRef<
	HTMLDivElement,
	CustomizeCategoryBarProps
>(function CustomizeCategoryBar(
	{ mode, value, onValueChange, connectorsAvailable = false },
	ref,
) {
	const categories = CUSTOMIZE_CATEGORIES.filter(
		(category) =>
			mode === "manage" ||
			(category.browseType !== null &&
				(category.id !== "connectors" || connectorsAvailable)),
	);
	return (
		<div
			ref={ref}
			data-customize-toolbar=""
			className="sticky top-(--customize-toolbar-top,var(--page-content-top)) z-40 -mt-3 mr-(--customize-toolbar-end,0px) mb-3 shrink-0 bg-background py-3"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				<CustomizePillSelector
					className="min-w-0 flex-[1_1_max-content]"
					overflow="wrap"
					page={mode}
					size="md"
					aria-label={`${mode === "browse" ? "Browse" : "Manage"} categories`}
					onValueChange={(next) =>
						onValueChange((next || "all") as CustomizeTab)
					}
					value={value}
				>
					<CustomizePillSelectorItem category="all" value="all">
						<span>
							All
							<span
								aria-hidden="true"
								className="inline-block size-0"
								data-customize-pill-baseline=""
							/>
						</span>
					</CustomizePillSelectorItem>
					{categories.map((category) => {
						return (
							<CustomizePillSelectorItem
								key={category.id}
								category={category.id}
								value={category.id}
							>
								{category.label}

								{category.beta ? (
									<Badge tone="info" size="xxs">
										Beta
									</Badge>
								) : null}
							</CustomizePillSelectorItem>
						);
					})}
				</CustomizePillSelector>
				<div
					data-customize-toolbar-actions=""
					className="ml-auto flex shrink-0 translate-x-(--customize-filter-offset,0px) items-center gap-1"
				>
					<CustomizeRefreshButton />
					<CustomizeCategoryFilter />
				</div>
			</div>
		</div>
	);
});
