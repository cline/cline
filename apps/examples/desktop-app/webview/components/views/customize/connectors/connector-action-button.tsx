import { Button } from "@cline/ui";
import { Check, Unplug } from "lucide-react";

import type { ComposioIntegrationStatus } from "@/lib/composio-types";
import { CustomizationItemStatus } from "../shared/customization-item-card";

type ConnectorConnectionState = {
	status: ComposioIntegrationStatus;
	error?: string;
	failureStatus?: ConnectorFailureStatus;
	busy: boolean;
};

/** Cards report the connection, or offer Connect when there is nothing to report. */
export function ConnectorCardAction({
	onConnect,
	...connection
}: ConnectorConnectionState & {
	onConnect: (trigger?: HTMLButtonElement) => void;
}) {
	const displayStatus = getConnectorDisplayStatus(connection);
	if (displayStatus) return <ConnectorStatus status={displayStatus} />;
	return (
		<Button
			disabled={connection.busy}
			onClick={(event) => {
				event.stopPropagation();
				onConnect(event.currentTarget);
			}}
			size="xs"
			tone="neutral"
			type="button"
			variant="secondary"
			loading={connection.busy}
		>
			Connect
		</Button>
	);
}

/** Details own every connection action: connect, cancel authorization, or disconnect. */
export function ConnectorDetailAction({
	status,
	busy,
	onConnect,
	onCancel,
	onDisconnect,
}: {
	status: ComposioIntegrationStatus;
	busy: boolean;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
}) {
	if (status === "connected") {
		return (
			<Button
				disabled={busy}
				onClick={onDisconnect}
				size="sm"
				tone="destructive"
				type="button"
				variant="secondary"
				leadingIcon={Unplug}
				loading={busy}
			>
				Disconnect
			</Button>
		);
	}
	if (status === "pending") {
		return (
			<Button
				disabled={busy}
				onClick={onCancel}
				size="sm"
				tone="neutral"
				type="button"
				variant="secondary"
				loading={true}
			>
				Cancel
			</Button>
		);
	}
	return (
		<Button
			disabled={busy}
			onClick={onConnect}
			size="sm"
			tone="accent"
			type="button"
			variant="primary"
			loading={busy}
		>
			Connect
		</Button>
	);
}

type ConnectorDisplayStatus =
	| ConnectorFailureStatus
	| "connected"
	| "auth-required";

/** Cards and details share status precedence, including pending authorization. */
export function getConnectorDisplayStatus({
	status,
	error,
	failureStatus = "connection-error",
	busy,
}: ConnectorConnectionState): ConnectorDisplayStatus | null {
	if (!busy && status !== "pending" && error) return failureStatus;
	if (status === "connected") return "connected";
	if (status === "pending") return "auth-required";
	return null;
}

export function ConnectorStatus({
	status,
}: {
	status: ConnectorDisplayStatus;
}) {
	if (status !== "connected")
		return <CustomizationItemStatus status={status} />;
	return (
		<span className="inline-flex items-center gap-1 text-success-text text-xs">
			<Check aria-hidden="true" className="size-3.5" />
			Connected
		</span>
	);
}

export type ConnectorFailureStatus =
	| "connection-error"
	| "disconnect-failed"
	| "action-failed";
