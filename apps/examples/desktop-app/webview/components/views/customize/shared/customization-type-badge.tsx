"use client";

import { Badge } from "@cline/ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
	type MarketplaceTypeFilter,
	TYPE_META,
} from "../marketplace/marketplace-type-meta";
import { useCustomizationDetailNavigation } from "./customization-category-section";

/** Open Browse with this customization type selected from any detail surface. */
export function CustomizationTypeBadge({
	type,
	children,
	onSelected,
	className,
}: {
	type: MarketplaceTypeFilter;
	children?: ReactNode;
	onSelected?: () => void;
	className?: string;
}) {
	const navigation = useCustomizationDetailNavigation();
	const Icon = TYPE_META[type].icon;
	return (
		<Badge
			interactive
			variant="ghost"
			className={cn("-ml-1.5", className)}
			disabled={!navigation?.onSelectType}
			onClick={() => {
				navigation?.onSelectType?.(type);
				onSelected?.();
			}}
			size="xs"
			title={`Browse ${TYPE_META[type].plural}`}
			type="button"
			tone="neutral"
		>
			<Icon aria-hidden="true" />
			{children ?? TYPE_META[type].short}
		</Badge>
	);
}
