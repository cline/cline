"use client";

import { DetailList, DetailListItem, Dialog } from "@cline/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { ConnectorLogo } from "@/components/connectors/connector-logo";
import type {
	ComposioCatalogToolkit,
	ComposioIntegrationSummary,
	ComposioToolkitSlug,
} from "@/lib/composio-types";
import {
	CustomizationCategoryBadges,
	useCustomizationCategoryDialog,
} from "../shared/customization-category-section";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { CustomizationDescription } from "../shared/customization-description";
import { CustomizationTypeBadge } from "../shared/customization-type-badge";
import {
	ConnectorDetailAction,
	type ConnectorFailureStatus,
	ConnectorStatus,
	getConnectorDisplayStatus,
} from "./connector-action-button";

/** One connector's status, categories and tools, with its connection controls. */
export function ConnectorDetailDialog({
	entry,
	summary,
	actionError,
	failureStatus,
	busy,
	onConnect,
	onCancel,
	onDisconnect,
	onOpenChange,
}: {
	entry: ComposioCatalogToolkit | null;
	summary?: ComposioIntegrationSummary;
	/** Already scoped by the caller to THIS dialog's connector. */
	actionError?: string;
	failureStatus?: ConnectorFailureStatus;
	busy: boolean;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	const [disconnectTarget, setDisconnectTarget] =
		useState<ComposioToolkitSlug | null>(null);
	const status = summary?.status ?? "not_connected";
	const error = actionError ?? summary?.error;
	const displayStatus = getConnectorDisplayStatus({
		status,
		error,
		failureStatus,
		busy,
	});
	const categoryDialog = useCustomizationCategoryDialog(() => {
		setDisconnectTarget(null);
		onOpenChange(false);
	});
	return (
		<Dialog
			className="h-120 select-text"
			bodyClassName="flex-1 gap-4"
			onCloseAutoFocus={categoryDialog.onCloseAutoFocus}
			onOpenChange={(open) => {
				if (!open) setDisconnectTarget(null);
				onOpenChange(open);
			}}
			open={entry !== null}
			size="md"
			eyebrow={
				<CustomizationTypeBadge
					className="mb-1 self-start"
					type="connector"
					onSelected={categoryDialog.onSelected}
				/>
			}
			title={
				entry ? (
					<span className="mb-2 flex items-center gap-4">
						<ConnectorLogo
							className="size-9 rounded-xl"
							logo={entry.logo}
							name={entry.name}
							slug={entry.slug}
						/>
						{entry.name}
					</span>
				) : (
					"Connector"
				)
			}
			description={
				entry?.description ? (
					<CustomizationDescription>
						{entry.description}
					</CustomizationDescription>
				) : undefined
			}
			footer={
				entry ? (
					<>
						<ConnectorDetailAction
							busy={busy}
							onCancel={onCancel}
							onConnect={onConnect}
							onDisconnect={() => setDisconnectTarget(entry.slug)}
							status={status}
						/>
						<CustomizationDeleteDialog
							open={disconnectTarget === entry.slug}
							type="connector"
							action="Disconnect"
							name={entry.name}
							busy={busy || status !== "connected"}
							onClose={() => setDisconnectTarget(null)}
							onConfirm={() => {
								if (
									disconnectTarget === entry.slug &&
									!busy &&
									status === "connected"
								)
									onDisconnect();
							}}
						/>
					</>
				) : undefined
			}
		>
			{entry ? (
				<div className="flex flex-col gap-6">
					{displayStatus ||
					error ||
					entry.categories?.length ||
					summary?.connectedAt ||
					typeof entry.toolsCount === "number" ? (
						<DetailList>
							{displayStatus || error ? (
								<DetailListItem
									className={
										error
											? "[&>dd:first-of-type]:col-span-full [&>dd:last-of-type]:self-start"
											: undefined
									}
									title="Status"
									description={
										error ? (
											<p className="text-xs" role="alert">
												{error}
											</p>
										) : undefined
									}
									trailingText={
										displayStatus ? (
											<ConnectorStatus status={displayStatus} />
										) : undefined
									}
								/>
							) : null}
							{entry.categories?.length ? (
								<DetailListItem
									title="Category"
									trailingText={
										<CustomizationCategoryBadges
											categories={entry.categories}
											className="justify-end"
											onSelected={categoryDialog.onSelected}
										/>
									}
								/>
							) : null}
							{summary?.connectedAt ? (
								<DetailListItem
									title="Connected"
									trailingText={new Date(summary.connectedAt).toLocaleString()}
								/>
							) : null}
							{typeof entry.toolsCount === "number" ? (
								<DetailListItem title="Tools" trailingText={entry.toolsCount} />
							) : null}
						</DetailList>
					) : null}

					{status === "pending" ? (
						<p className="inline-flex items-center gap-2 text-muted-foreground text-sm">
							<Loader2 className="size-4 animate-spin" />
							Finish authorizing {entry.name} in your browser…
						</p>
					) : null}
				</div>
			) : null}
		</Dialog>
	);
}
