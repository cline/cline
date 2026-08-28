import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { MarketplaceView } from "../marketplace-view";
import { ExplorerMarketplaceView } from "./explorer-view";
import { RegistryMarketplaceView } from "./registry-view";
import { StorefrontMarketplaceView } from "./storefront-view";

/**
 * Prototype harness for exploring marketplace redesign directions. A slim
 * switcher bar swaps between the current (classic) marketplace and the three
 * design-direction prototypes so they can be compared in place.
 */

type DirectionId = "classic" | "storefront" | "explorer" | "registry";

const DIRECTIONS: { id: DirectionId; label: string }[] = [
	{ id: "classic", label: "Classic" },
	{ id: "storefront", label: "A · Storefront" },
	{ id: "explorer", label: "B · Explorer" },
	{ id: "registry", label: "C · Registry" },
];

export function MarketplaceDirectionsView({
	onOpenInstalled,
}: {
	onOpenInstalled?: () => void;
}) {
	const [direction, setDirection] = useState<DirectionId>("classic");

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
				<span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<FlaskConical className="size-3.5" />
					Design explorations
				</span>
				<div className="flex flex-wrap gap-1">
					{DIRECTIONS.map((item) => (
						<button
							aria-pressed={direction === item.id}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
								direction === item.id
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:bg-surface-hover-lighter hover:text-foreground",
							)}
							key={item.id}
							onClick={() => setDirection(item.id)}
							type="button"
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
			<div className="min-h-0 min-w-0 flex-1">
				{direction === "classic" ? (
					<MarketplaceView
						onOpenInstalled={onOpenInstalled}
						variant="directory"
					/>
				) : direction === "storefront" ? (
					<StorefrontMarketplaceView />
				) : direction === "explorer" ? (
					<ExplorerMarketplaceView />
				) : (
					<RegistryMarketplaceView />
				)}
			</div>
		</div>
	);
}
