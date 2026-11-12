import {
	Banner,
	Button,
	DetailList,
	DetailListItem,
	IconButton,
	Switch,
} from "@cline/ui";
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useRef } from "react";
import type { McpServer } from "@/lib/extension-inventory";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { ERROR_STATUS_LABELS } from "../shared/customization-item-card";
import { type McpActionError, TRANSPORT_TYPE_LABELS } from "./mcp-types";

function stringifyRedactedKeyValuePairs(
	input?: Record<string, string>,
): string {
	if (!input) {
		return "";
	}
	return Object.keys(input)
		.map((key) => `${key}=[REDACTED]`)
		.join(", ");
}

export function McpServerToggle({
	server,
	busy,
	onToggle,
}: {
	server: McpServer;
	busy: boolean;
	onToggle: (server: McpServer, disabled: boolean) => Promise<void>;
}) {
	return (
		<Switch
			tone="neutral"
			size="sm"
			checked={!server.disabled}
			onCheckedChange={(enabled) => onToggle(server, !enabled)}
			disabled={busy}
			aria-label={`Enable ${server.name}`}
		/>
	);
}

export function McpServerManagementActions({
	server,
	busy,
	authorizing,
	full = false,
	onEdit,
	onDelete,
}: {
	server: McpServer;
	busy: boolean;
	authorizing: boolean;
	full?: boolean;
	onEdit?: (server: McpServer) => void;
	onDelete: (server: McpServer) => void;
}) {
	const actions = [
		{
			label: "Edit",
			icon: Pencil,
			tone: "neutral" as const,
			onClick: () => onEdit?.(server),
		},
		{
			label: "Delete",
			icon: Trash2,
			tone: "destructive" as const,
			onClick: () => onDelete(server),
		},
	];
	return (
		<div className="flex items-center gap-2">
			{actions
				.filter(({ label }) => label !== "Edit" || onEdit)
				.map(({ label, icon, tone, onClick }) =>
					full ? (
						<Button
							key={label}
							variant="secondary"
							tone={tone}
							size="sm"
							aria-label={`${label} ${server.name}`}
							onClick={onClick}
							disabled={busy || authorizing}
							leadingIcon={icon}
						>
							{label}
						</Button>
					) : (
						<IconButton
							key={label}
							variant="ghost"
							tone={tone}
							size="xs"
							aria-label={`${label} ${server.name}`}
							onClick={onClick}
							disabled={busy || authorizing}
							icon={icon}
						/>
					),
				)}
		</div>
	);
}

export function McpServerConnectionDetails({
	server,
	layout = "compact",
	children,
}: {
	server: McpServer;
	layout?: "compact" | "rows";
	children?: ReactNode;
}) {
	const fields = [
		{ label: "Command", value: server.command },
		{ label: "Args", value: server.args?.join(", ") },
		{ label: "CWD", value: server.cwd },
		{ label: "URL", value: server.url },
		{ label: "Env", value: stringifyRedactedKeyValuePairs(server.env) },
		{ label: "Headers", value: stringifyRedactedKeyValuePairs(server.headers) },
	].filter((field) => field.value);

	if (layout === "rows") {
		return (
			<DetailList>
				<DetailListItem
					title="Type"
					trailingText={TRANSPORT_TYPE_LABELS[server.transportType]}
				/>
				{fields.map(({ label, value }) => (
					<DetailListItem key={label} title={label} trailingText={value} />
				))}
				{children}
			</DetailList>
		);
	}

	return (
		<div className="wrap-break-word flex min-w-0 flex-col gap-1 text-muted-foreground text-xs">
			{fields.map(({ label, value }) => (
				<p key={label}>
					<span className="text-muted-foreground/70">{label}:</span> {value}
				</p>
			))}
		</div>
	);
}

export function McpServerStatus({
	server,
	actionError,
	busy,
	authorizing,
	onAuthorize,
	onCancel,
}: {
	server: McpServer;
	actionError?: McpActionError;
	busy: boolean;
	authorizing: boolean;
	onAuthorize: (name: string) => Promise<void>;
	onCancel: (name: string) => Promise<void>;
}) {
	const serverError =
		actionError?.message ??
		(server.disabled ? undefined : server.oauthStatus?.lastError);

	return (
		<div className="grid gap-2">
			{server.configurationError ? (
				<Banner
					tone="error"
					size="sm"
					title="Invalid configuration"
					description={server.configurationError}
				/>
			) : null}
			{server.oauthStatus?.authorizationRequired ? (
				<Banner
					tone="warning"
					size="sm"
					role="alert"
					title={
						authorizing
							? "Waiting for OAuth authorization"
							: "OAuth authorization required"
					}
					description={
						authorizing
							? "Complete sign-in in your browser, or select Cancel to stop waiting."
							: (serverError ??
								"Select Connect to sign in with your browser. The server will remain off until authorization succeeds.")
					}
					actions={[
						{
							id: "oauth",
							label: authorizing ? "Cancel" : "Connect",
							"aria-label": authorizing
								? `Cancel OAuth for ${server.name}`
								: `Connect ${server.name} with OAuth`,
							onClick: () =>
								void (authorizing
									? onCancel(server.name)
									: onAuthorize(server.name)),
							disabled: busy,
						},
					]}
				/>
			) : null}
			{serverError && !server.oauthStatus?.authorizationRequired ? (
				<Banner
					tone="error"
					size="sm"
					title={ERROR_STATUS_LABELS[actionError?.status ?? "connection-error"]}
					description={serverError}
				/>
			) : null}
			{server.oauthStatus?.configured ? (
				<div className="flex items-center gap-2 text-muted-foreground text-xs">
					<span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
						OAuth connected
					</span>
				</div>
			) : null}
		</div>
	);
}

export function McpServerDeleteDialog({
	server,
	busy,
	onClose,
	onDelete,
}: {
	server: McpServer | null;
	busy: boolean;
	onClose: () => void;
	onDelete: (name: string) => Promise<void>;
}) {
	// Keep naming the server while the dialog animates closed.
	const lastName = useRef("");
	if (server) lastName.current = server.name;
	return (
		<CustomizationDeleteDialog
			open={server !== null}
			type="mcp"
			action="Delete"
			name={lastName.current}
			busy={busy || !server}
			onClose={onClose}
			onConfirm={() => {
				if (server) void onDelete(server.name);
			}}
		/>
	);
}
