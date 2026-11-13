"use client";

import { type ReactNode, useState } from "react";
import {
	type FactoryConnections,
	type FactoryMcpServers,
	factorySettingsErrorMessage,
} from "@/lib/factory-settings-client";
import { FS_CONNECTIONS } from "@/lib/factory-settings-copy/connections";
import {
	FS_COUNTS,
	FS_PAGES,
	FS_SHELL,
} from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import {
	ActionButton,
	CopyableText,
	CopyButton,
	DisclosureRow,
	GroupHeading,
	OpenRow,
	PageTitle,
	SettingRow,
	SettingSkeleton,
	StatusPill,
	UnavailableNote,
} from "../../factory-settings-rows";
import { SECTION_LABEL } from "../../factory-ui";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import {
	blockingCount,
	ghState,
	type ProviderUse,
	providerUses,
} from "./connections/status";
import {
	type ConnectionRead,
	useConnections,
} from "./connections/use-connections";

const C = FS_CONNECTIONS;

/**
 * Connections: what Factory needs outside itself (gh, the model providers
 * the default workflow uses, Linear, MCP servers), each with its status and
 * where to fix it. Factory signs in to nothing itself.
 */
function ConnectionsPage({ shell, headingId }: SettingsPageProps) {
	const state = useConnections(shell.client);
	return (
		<>
			<PageTitle
				id={headingId}
				title={FS_PAGES.connections}
				scope={C.scope}
				action={
					<ActionButton
						disabled={state.checking}
						onClick={() => void state.refresh()}
					>
						{state.checking ? C.checking : C.checkAgain}
					</ActionButton>
				}
			/>
			<GroupHeading>{C.githubGroup}</GroupHeading>
			<Read
				read={state.connections}
				unavailable={C.connectionsUnavailable}
				onRetry={state.refresh}
			>
				{(connections) => (
					<GhRow shell={shell} gh={connections.gh} onCheck={state.refresh} />
				)}
			</Read>
			<ProvidersHeading shell={shell} />
			<Read
				read={state.providers}
				unavailable={() => C.providersUnavailable}
				onRetry={state.refresh}
			>
				{(catalog) => (
					<ProviderRows
						shell={shell}
						uses={providerUses(shell.workflow.config, catalog)}
					/>
				)}
			</Read>
			<GroupHeading>{C.issuesGroup}</GroupHeading>
			<Read
				read={state.connections}
				unavailable={C.connectionsUnavailable}
				onRetry={state.refresh}
			>
				{(connections) => (
					<LinearRow shell={shell} linear={connections.linear} />
				)}
			</Read>
			<GroupHeading>{C.toolsGroup}</GroupHeading>
			<Read
				read={state.mcp}
				unavailable={() => C.mcpUnavailable}
				onRetry={state.refresh}
			>
				{(mcp) => <McpRow shell={shell} mcp={mcp} />}
			</Read>
		</>
	);
}

/** A group's read: a skeleton, the one unavailable line, an error with Retry, or the rows. */
function Read<T>({
	read,
	unavailable,
	onRetry,
	children,
}: {
	read: ConnectionRead<T>;
	unavailable: (hub: boolean) => string;
	onRetry: () => void;
	children: (data: T) => ReactNode;
}) {
	if (read.status === "ready" && read.data !== undefined)
		return <>{children(read.data)}</>;
	if (read.status === "unavailable")
		return (
			<UnavailableNote reason={read.unavailable}>
				{unavailable(read.unavailable === "hub")}
			</UnavailableNote>
		);
	if (read.status === "error")
		return (
			<p
				role="alert"
				className="flex items-center gap-2 border-b py-3 text-xs text-destructive"
			>
				<span className="flex-1">{read.error}</span>
				<ActionButton onClick={onRetry}>{FS_SHELL.retry}</ActionButton>
			</p>
		);
	return (
		<div
			aria-hidden
			className="flex items-center justify-between border-b py-3"
		>
			<SettingSkeleton className="w-40" />
			<SettingSkeleton />
		</div>
	);
}

/** Opens a page in the browser; a failure shows under the row. */
function useOpenUrl(shell: SettingsShell) {
	const [error, setError] = useState<string>();
	return {
		error,
		open: (url: string) => {
			setError(undefined);
			shell.client
				.openExternalUrl(url)
				.catch((cause: unknown) =>
					setError(factorySettingsErrorMessage(cause, C.openFailed)),
				);
		},
	};
}

function GhRow({
	shell,
	gh,
	onCheck,
}: {
	shell: SettingsShell;
	gh: FactoryConnections["gh"];
	onCheck: () => void;
}) {
	const url = useOpenUrl(shell);
	const status = ghState(gh);
	if (status === "connected") {
		const host = gh.hosts.find((item) => item.signedIn) ?? gh.hosts[0];
		return (
			<DisclosureRow
				id="gh"
				title={C.gh}
				description={`${C.ghPurpose} ${C.ghSignedIn(host.host, host.login, gh.version)}`}
				pill={<StatusPill tone="success">{C.connected}</StatusPill>}
				label={C.linearDetails}
			>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
					<dt className="text-muted-foreground">{C.hosts}</dt>
					<dd>
						{gh.hosts
							.map((item) =>
								item.signedIn
									? `${item.host}${item.login ? ` (${item.login})` : ""}`
									: `${item.host} (${C.notSignedIn.toLowerCase()})`,
							)
							.join(", ")}
					</dd>
					{gh.version ? (
						<>
							<dt className="text-muted-foreground">{C.version}</dt>
							<dd>{gh.version}</dd>
						</>
					) : null}
					{gh.path ? (
						<>
							<dt className="text-muted-foreground">{C.path}</dt>
							<dd className="break-all font-mono text-[11.5px]">{gh.path}</dd>
						</>
					) : null}
				</dl>
			</DisclosureRow>
		);
	}
	if (status === "not_signed_in")
		return (
			<SettingRow
				id="gh"
				title={C.gh}
				description={C.ghNotSignedIn}
				extra={<CopyableText text={C.signInCommand} />}
			>
				<StatusPill tone="danger">{C.notSignedIn}</StatusPill>
				<CopyButton text={C.signInCommand} what="command">
					{C.copyCommand}
				</CopyButton>
			</SettingRow>
		);
	if (status === "not_installed")
		return (
			<SettingRow
				id="gh"
				title={C.gh}
				description={C.ghNotInstalled}
				error={url.error}
			>
				<StatusPill tone="danger">{C.notInstalled}</StatusPill>
				<ActionButton icon="outside" onClick={() => url.open(C.ghSite)}>
					{C.openGhSite}
				</ActionButton>
			</SettingRow>
		);
	return (
		<SettingRow
			id="gh"
			title={C.gh}
			description={C.ghCheckFailed(gh.error ?? "")}
		>
			<StatusPill tone="attention">{C.couldntCheck}</StatusPill>
			<ActionButton onClick={onCheck}>{C.checkAgain}</ActionButton>
		</SettingRow>
	);
}

/** "Model providers · used by the default workflow" with Manage providers at the right. */
function ProvidersHeading({ shell }: { shell: SettingsShell }) {
	return (
		<div
			data-setting="providers"
			className="mt-6 flex items-center justify-between gap-2 border-b pb-1.5"
		>
			<h3 className={cn("flex items-baseline gap-2", SECTION_LABEL)}>
				{C.providersGroup}
				<span className="font-normal normal-case tracking-normal">
					{C.providersHint}
				</span>
			</h3>
			<ActionButton onClick={() => shell.openAppSettings("Providers")}>
				{C.manageProviders}
			</ActionButton>
		</div>
	);
}

function ProviderRows({
	shell,
	uses,
}: {
	shell: SettingsShell;
	uses: ProviderUse[];
}) {
	const openProviders = () => shell.openAppSettings("Providers");
	return (
		<>
			{uses.map((use) => {
				const id = `provider-${use.id ?? "chat"}`;
				const roles = use.roles.join(", ");
				if (use.connected === false)
					return (
						<SettingRow
							key={id}
							id={id}
							title={use.name}
							description={roles}
							extra={
								<p className="mt-0.5 text-xs text-error-text">
									{C.providerStops(use.name)}
								</p>
							}
						>
							<StatusPill tone="danger">{C.notConnected}</StatusPill>
							<ActionButton onClick={openProviders}>{C.connect}</ActionButton>
						</SettingRow>
					);
				return (
					<OpenRow
						key={id}
						id={id}
						title={use.name}
						description={use.id ? roles : C.appModelHint(roles)}
						pill={
							use.connected ? { tone: "success", text: C.connected } : undefined
						}
						onOpen={openProviders}
					/>
				);
			})}
		</>
	);
}

function LinearRow({
	shell,
	linear,
}: {
	shell: SettingsShell;
	linear: FactoryConnections["linear"];
}) {
	const url = useOpenUrl(shell);
	if (linear.configured)
		return (
			<DisclosureRow
				id="linear"
				title={C.linear}
				description={C.linearHint}
				pill={<StatusPill tone="success">{C.ready}</StatusPill>}
				label={C.linearDetails}
			>
				<p className="text-xs text-muted-foreground">{C.linearSet}</p>
			</DisclosureRow>
		);
	return (
		<DisclosureRow
			id="linear"
			title={C.linear}
			description={C.linearHint}
			pill={<StatusPill tone="neutral">{C.notSetUp}</StatusPill>}
			label={C.howTo}
		>
			<ol className="list-decimal space-y-3 pl-5 text-xs text-muted-foreground">
				<li>
					<p>{C.linearStep1}</p>
					<div className="mt-1.5">
						<ActionButton icon="outside" onClick={() => url.open(C.linearSite)}>
							{C.openLinear}
						</ActionButton>
					</div>
					{url.error ? (
						<p role="alert" className="mt-1 text-destructive">
							{url.error}
						</p>
					) : null}
				</li>
				<li>
					<p>{C.linearStep2}</p>
					<div className="mt-1.5 flex flex-wrap items-center gap-2">
						<CopyableText text={C.linearCommand} />
						<CopyButton text={C.linearCommand} what="command">
							{C.copyCommand}
						</CopyButton>
					</div>
				</li>
			</ol>
		</DisclosureRow>
	);
}

function McpRow({
	shell,
	mcp,
}: {
	shell: SettingsShell;
	mcp: FactoryMcpServers;
}) {
	const servers = mcp.servers ?? [];
	return (
		<SettingRow
			id="mcp"
			title={C.mcp}
			description={C.mcpHint(
				servers.length,
				servers.filter((server) => server.disabled).length,
			)}
		>
			<ActionButton onClick={() => shell.openAppSettings("Customize")}>
				{C.openMcp}
			</ActionButton>
		</SettingRow>
	);
}

/** Connections that will stop work: gh not ready, a role's provider not connected. */
function useBadge(shell: SettingsShell) {
	const state = useConnections(shell.client);
	return blockingCount(state, shell.workflow.config);
}

export const settingsPage: SettingsPageDefinition = {
	Page: ConnectionsPage,
	search: [
		{ row: "gh", title: C.gh, description: C.ghPurpose },
		{ row: "providers", title: C.providersGroup, description: C.providersHint },
		{ row: "linear", title: C.linear, description: C.linearHint },
		{ row: "mcp", title: C.mcp, description: C.mcpSearch },
	],
	useBadge,
	badgeLabel: FS_COUNTS.connections,
};
