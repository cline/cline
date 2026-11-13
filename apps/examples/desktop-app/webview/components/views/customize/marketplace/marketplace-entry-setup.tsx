import { Banner, Button } from "@cline/ui";
import { AdvancedOptionsIcon } from "@/components/button-icons";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { marketplaceEntryKey as entryKey } from "@/lib/marketplace-entry";
import type { EntryActionState } from "@/lib/use-marketplace-directory";
import {
	EnvironmentRequirementCards,
	InstallationNotes,
} from "../shared/environment-setup";

function entryHasSetupGuidance(entry: MarketplaceEntry): boolean {
	return Boolean(entry.install.env?.length) || Boolean(entry.install.notes);
}

function EntrySetupGuidance({ entry }: { entry: MarketplaceEntry }) {
	const requirements = entry.install.env ?? [];
	return (
		<>
			{requirements.length > 0 ? (
				<Banner tone="warning" title="Environment setup needed">
					<p>
						Add these values to your Cline/plugin environment after install.
					</p>
					<EnvironmentRequirementCards requirements={requirements} />
				</Banner>
			) : null}
			<InstallationNotes notes={entry.install.notes} />
		</>
	);
}

export function MarketplaceSetupFeedback({
	actionState,
	entry,
}: {
	actionState: EntryActionState | undefined;
	entry: MarketplaceEntry;
}) {
	const hasSetupDetails =
		entryHasSetupGuidance(entry) || actionState?.status === "failed";

	if (!hasSetupDetails) {
		return null;
	}

	return (
		<div className="grid gap-3 border-t pt-3" data-marketplace-entry-details>
			<EntrySetupGuidance entry={entry} />

			{actionState?.status === "failed" ? (
				<Banner tone="error" className="max-h-44 overflow-auto">
					{actionState.message}
				</Banner>
			) : null}
		</div>
	);
}

/**
 * Collapsible marketplace setup guidance (required env vars and install notes)
 * for locally installed items that were matched to marketplace entries. When a
 * local item matches several entries, each entry's guidance is shown under its
 * own labeled trigger so no instructions are hidden or misattributed.
 */
export function MarketplaceEntrySetupDetails({
	entries,
}: {
	entries: MarketplaceEntry[];
}) {
	const entriesWithGuidance = entries.filter(entryHasSetupGuidance);
	if (entriesWithGuidance.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-2">
			{entriesWithGuidance.map((entry) => (
				<Collapsible className="grid gap-2" key={entryKey(entry)}>
					<CollapsibleTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							tone="neutral"
							size="xs"
							leadingIcon={AdvancedOptionsIcon}
							className="group h-auto w-fit gap-1 p-0 text-warning-text transition-colors hover:bg-transparent hover:text-(--warning-11)"
						>
							{entriesWithGuidance.length > 1
								? `Marketplace setup instructions (${entry.name})`
								: "Marketplace setup instructions"}
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent className="grid gap-3">
						<EntrySetupGuidance entry={entry} />
					</CollapsibleContent>
				</Collapsible>
			))}
		</div>
	);
}
