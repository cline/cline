import { BadgeCheck } from "lucide-react";
import type { MouseEventHandler, ReactNode, Ref } from "react";
import {
	CustomizationItemCard,
	type CustomizationStatus,
} from "../shared/customization-item-card";
import type { MarketplaceTypeMeta } from "./marketplace-type-meta";

export function MarketplaceCard({
	entryKey,
	name,
	description,
	authorName,
	meta,
	glyph,
	verified = false,
	installed,
	status,
	onSelect,
	primaryRef,
	selected,
	actions,
}: {
	entryKey?: string;
	name: string;
	description?: string;
	authorName?: string;
	meta: MarketplaceTypeMeta;
	/** Replaces the type glyph when the entry has its own mark (a connector's
	 * brand logo). Sized by the caller to match `size-6`. */
	glyph?: ReactNode;
	verified?: boolean;
	installed: boolean;
	status?: Exclude<CustomizationStatus, "installed">;
	onSelect?: MouseEventHandler<HTMLButtonElement>;
	primaryRef?: Ref<HTMLButtonElement>;
	selected: boolean;
	actions?: ReactNode;
}) {
	return (
		<CustomizationItemCard
			data-marketplace-entry-key={entryKey}
			title={name}
			description={description}
			icon={meta.icon}
			glyph={glyph}
			authorName={authorName}
			badges={
				verified ? (
					<BadgeCheck
						aria-label="Verified"
						className="size-3.5 shrink-0 text-info-solid"
					/>
				) : undefined
			}
			status={
				status ?? (installed && actions == null ? "installed" : undefined)
			}
			actions={actions}
			primaryAction={
				onSelect
					? {
							onClick: onSelect,
							label: `View ${name} details`,
							ref: primaryRef,
						}
					: undefined
			}
			selected={selected}
		/>
	);
}
