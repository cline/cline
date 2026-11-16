import { EmptyState, type EmptyStateAction } from "@cline/ui";
import type { MarketplaceTypeFilter } from "../marketplace/marketplace-type-meta";
import { useCustomizationDetailNavigation } from "./customization-category-section";
import { CustomizationEmptyIllustration } from "./customization-empty-illustration";

/** Consistent inventory messaging and the available ways to add customizations. */
export function CustomizationEmptyState({
	itemLabel,
	qualifier,
	message,
	marketplaceType,
	addAction,
	illustrated = false,
}: {
	itemLabel: string;
	qualifier?: string;
	message?: string;
	/** Omit for inventory-only types; null opens the full marketplace. */
	marketplaceType?: MarketplaceTypeFilter | null;
	addAction?: EmptyStateAction;
	/** Show the illustration for the initial, unfiltered inventory empty state. */
	illustrated?: boolean;
}) {
	const navigation = useCustomizationDetailNavigation();
	const browseAction: EmptyStateAction | undefined =
		marketplaceType !== undefined && navigation?.onSelectType
			? {
					label: "Browse customizations",
					onClick: () => navigation.onSelectType?.(marketplaceType),
				}
			: undefined;
	const description =
		message ?? `No ${itemLabel} found${qualifier ? ` ${qualifier}` : ""}.`;

	return (
		<EmptyState
			align="center"
			size={illustrated ? "lg" : "md"}
			surface={illustrated ? "transparent" : "muted"}
			media={illustrated ? <CustomizationEmptyIllustration /> : undefined}
			action={browseAction ?? addAction}
			secondaryAction={browseAction ? addAction : undefined}
		>
			{description}
		</EmptyState>
	);
}
