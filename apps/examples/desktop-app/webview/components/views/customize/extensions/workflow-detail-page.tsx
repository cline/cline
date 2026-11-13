"use client";

import { Badge, Button, DetailList, DetailListItem } from "@cline/ui";
import { Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAsyncAction } from "@/hooks/use-async-action";
import { desktopClient } from "@/lib/desktop-client";
import { invalidateExtensionInventoryCache } from "@/lib/extension-inventory";
import {
	getCachedMarketplaceCatalog,
	type MarketplaceEntry,
} from "@/lib/marketplace";
import { MarketplaceEntrySetupDetails } from "../marketplace/marketplace-entry-setup";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { CustomizationDescription } from "../shared/customization-description";
import { CustomizationDetailPage } from "../shared/customization-detail-page";
import { CustomizationItemDetails } from "../shared/customization-item-details";
import { InstalledInstructionFilePreview } from "../shared/installed-instruction-file-preview";
import { PathDetailListItem } from "../shared/path-detail-list-item";
import type { CommandItem } from "./extension-section-shared";

export type WorkflowSelection = {
	workflow: CommandItem;
	entries: MarketplaceEntry[];
};

function WorkflowDetails({
	selection: { workflow, entries },
	onBack,
}: {
	selection: WorkflowSelection;
	onBack: (options?: { uninstalled: boolean }) => void;
}) {
	const tagLabels = new Map(
		getCachedMarketplaceCatalog()?.tags.map((tag) => [tag.id, tag.label]) ?? [],
	);
	const { pending: deleting, run } = useAsyncAction();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const deleteWorkflow = async () => {
		if (workflow.agentPlugin === true) return;
		await run(
			async () => {
				setError(null);
				await desktopClient.invoke("uninstall_local_primitive", {
					type: "workflow",
					id: workflow.id,
					name: workflow.name,
					path: workflow.path,
				});
				invalidateExtensionInventoryCache();
			},
			{
				onSuccess: () => onBack({ uninstalled: true }),
				onError: (cause) =>
					setError(cause instanceof Error ? cause.message : String(cause)),
			},
		);
	};

	return (
		<CustomizationItemDetails
			title={workflow.name}
			header={(titleRef) => (
				<>
					<Badge
						variant="ghost"
						size="xs"
						tone="neutral"
						className="-ml-1.5 self-start"
					>
						<Play aria-hidden="true" />
						Workflow
					</Badge>
					<div className="flex min-w-0 flex-col gap-2">
						<h2
							ref={titleRef}
							className="wrap-break-word min-w-0 font-semibold text-2xl text-foreground"
						>
							{workflow.name}
						</h2>
						{workflow.description ? (
							<CustomizationDescription className="text-muted-foreground text-sm">
								{workflow.description}
							</CustomizationDescription>
						) : null}
					</div>
				</>
			)}
			actions={
				workflow.agentPlugin !== true ? (
					<>
						<Button
							disabled={deleting}
							onClick={() => setDeleteOpen(true)}
							size="sm"
							type="button"
							variant="secondary"
							tone="destructive"
							leadingIcon={Trash2}
							loading={deleting}
						>
							{deleting ? "Deleting…" : "Delete"}
						</Button>
						<CustomizationDeleteDialog
							open={deleteOpen}
							type="workflow"
							name={workflow.name}
							action="Delete"
							busy={deleting}
							onClose={() => setDeleteOpen(false)}
							onConfirm={() => void deleteWorkflow()}
						/>
					</>
				) : null
			}
			feedback={
				error ? (
					<p className="text-error-text text-sm" role="alert">
						{error}
					</p>
				) : undefined
			}
			categories={entries.flatMap((entry) => entry.tags)}
			tagLabels={tagLabels}
			onCategorySelected={onBack}
		>
			<DetailList aria-label="Installed workflow details">
				<DetailListItem title="Scope" trailingText={workflow.scope} />
				{workflow.pluginName || workflow.agentPlugin ? (
					<DetailListItem
						title="Plugin"
						trailingText={workflow.pluginName || "Agent Plugin"}
					/>
				) : null}
				<PathDetailListItem
					path={workflow.path}
					label="Workflow path"
					showActions={workflow.agentPlugin !== true}
					title="Path"
					trailingText={<span className="break-all">{workflow.path}</span>}
				/>
			</DetailList>
			<InstalledInstructionFilePreview
				path={workflow.path}
				instructions={workflow.instructions}
				type="workflow"
			/>
			{entries.length ? (
				<MarketplaceEntrySetupDetails entries={entries} />
			) : null}
		</CustomizationItemDetails>
	);
}

export function WorkflowDetailPage({
	selection,
	onBack,
	backLabel = "Manage",
}: {
	selection: WorkflowSelection;
	onBack: (options?: { uninstalled: boolean }) => void;
	backLabel?: string;
}) {
	return (
		<CustomizationDetailPage
			backLabel={backLabel}
			onBack={onBack}
			navigationLabel="Workflow navigation"
		>
			<WorkflowDetails
				key={selection.workflow.path}
				selection={selection}
				onBack={onBack}
			/>
		</CustomizationDetailPage>
	);
}
