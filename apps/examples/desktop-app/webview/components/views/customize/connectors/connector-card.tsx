import { ItemCard } from "@cline/ui";
import { useRef } from "react";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import type {
	ComposioCatalogToolkit,
	ComposioIntegrationStatus,
} from "@/lib/composio-types";
import {
	ConnectorCardAction,
	type ConnectorFailureStatus,
} from "./connector-action-button";

export function ConnectorCard({
	entry,
	error,
	failureStatus,
	status,
	selected,
	busy,
	onConnect,
	onOpenDetails,
}: {
	entry: ComposioCatalogToolkit;
	error?: string;
	failureStatus?: ConnectorFailureStatus;
	status: ComposioIntegrationStatus;
	selected: boolean;
	busy: boolean;
	onConnect: (trigger?: HTMLButtonElement) => void;
	onOpenDetails: () => void;
}) {
	const primaryRef = useRef<HTMLButtonElement>(null);
	return (
		<ItemCard
			actions={
				<ConnectorCardAction
					busy={busy}
					error={error}
					failureStatus={failureStatus}
					onConnect={(trigger) => onConnect(primaryRef.current ?? trigger)}
					status={status}
				/>
			}
			description={entry.description}
			icon={
				<ConnectorLogo
					className="size-6"
					logo={entry.logo}
					name={entry.name}
					slug={entry.slug}
				/>
			}
			primaryAction={{
				ref: primaryRef,
				onClick: onOpenDetails,
				label: `Open ${entry.name} details`,
			}}
			selected={selected}
			title={entry.name}
		/>
	);
}
