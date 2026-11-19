import { Button } from "@cline/ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import type { MarketplaceEntry } from "@/lib/marketplace";
import { marketplaceEntryKey as entryKey } from "@/lib/marketplace-entry";
import {
	type MarketplaceDirectory,
	useMarketplaceDirectory,
} from "@/lib/use-marketplace-directory";
import { cn } from "@/lib/utils";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { CustomizationDetailPage } from "../shared/customization-detail-page";
import {
	entryActionLabel,
	isEntryActionBusy,
} from "./marketplace-entry-action";
import { MarketplaceEntryDetails } from "./marketplace-entry-details";
import { TYPE_META } from "./marketplace-type-meta";

export function MarketplaceDetailContent({
	directory,
	entry,
	onSelectTag,
	onCategorySelected,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
	onSelectTag?: (tag: string) => void;
	onCategorySelected?: () => void;
}) {
	const [confirmUninstall, setConfirmUninstall] = useState(false);
	const key = entryKey(entry);
	const state = directory.actionStates.get(key);
	const installed = directory.installedKeys.has(key);
	const busy = isEntryActionBusy(state);
	const message =
		state?.status === "installed" ||
		state?.status === "uninstalled" ||
		state?.status === "failed"
			? state.message
			: undefined;

	return (
		<>
			<MarketplaceEntryDetails
				entry={entry}
				installed={installed}
				onSelectTag={onSelectTag}
				onCategorySelected={onCategorySelected}
				tagLabels={directory.tagLabels}
				actions={
					<Button
						disabled={!directory.installedReady || busy}
						onClick={() => {
							if (installed) setConfirmUninstall(true);
							else void directory.install(entry);
						}}
						size="sm"
						tone={installed ? "destructive" : "neutral"}
						type="button"
						variant={installed ? "secondary" : "primary"}
						leadingIcon={installed ? Trash2 : undefined}
						loading={busy || !directory.installedReady}
					>
						{entryActionLabel(state, installed, directory.installedReady)}
					</Button>
				}
				feedback={
					message ? (
						<output
							role={state?.status === "failed" ? "alert" : "status"}
							className={cn(
								"mt-2 block text-xs",
								state?.status === "failed"
									? "text-error-text"
									: "text-muted-foreground",
							)}
						>
							{message}
						</output>
					) : null
				}
			/>
			<CustomizationDeleteDialog
				open={confirmUninstall}
				type={entry.type}
				name={entry.name}
				busy={!directory.installedReady || busy || !installed}
				onClose={() => setConfirmUninstall(false)}
				onConfirm={() => {
					if (directory.installedReady && !busy && installed)
						void directory.uninstall(entry);
				}}
			/>
		</>
	);
}

export function MarketplaceEntryDetailPage({
	entry,
	backLabel = "Browse",
	onBack,
	onInventoryChanged,
	onSelectTag,
}: {
	entry: MarketplaceEntry;
	backLabel?: string;
	onBack: () => void;
	onInventoryChanged?: () => void;
	onSelectTag?: (tag: string) => void;
}) {
	const directory = useMarketplaceDirectory(onInventoryChanged);
	return (
		<CustomizationDetailPage
			backLabel={backLabel}
			navigationLabel={`${TYPE_META[entry.type].short} navigation`}
			onBack={onBack}
		>
			<MarketplaceDetailContent
				directory={directory}
				entry={entry}
				onSelectTag={onSelectTag}
				onCategorySelected={onSelectTag ? undefined : onBack}
			/>
		</CustomizationDetailPage>
	);
}
