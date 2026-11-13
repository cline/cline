"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type FactoryConnections,
	type FactoryStorage,
	factorySettingsErrorMessage,
	isUnavailable,
} from "@/lib/factory-settings-client";
import {
	FS_PAGES,
	FS_SHELL,
	formatBytes,
} from "@/lib/factory-settings-copy/shell";
import { FS_COMPUTER } from "@/lib/factory-settings-copy/this-computer";
import { cn } from "@/lib/utils";
import {
	ActionButton,
	ConfirmDialog,
	CopyableText,
	CopyButton,
	DisclosureRow,
	GroupHeading,
	PageTitle,
	SettingRow,
	SettingSkeleton,
	StatusPill,
	tildePath,
	UnavailableNote,
} from "../../factory-settings-rows";
import { toneText } from "../../factory-ui";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useRowSaves, useSettingsResource } from "../use-settings-resource";
import { useConnections } from "./connections/use-connections";

const C = FS_COMPUTER;

/**
 * This computer: the Hub's status, where working copies and evidence live
 * and how much space they take, and diagnostics. Factory work runs only
 * here; remote hosts are for chat sessions (the scope line says so).
 */
function ThisComputerPage({ shell, headingId }: SettingsPageProps) {
	return (
		<>
			<PageTitle id={headingId} title={FS_PAGES.computer} scope={C.scope} />
			<GroupHeading>{C.serviceGroup}</GroupHeading>
			<HubRow shell={shell} />
			<GroupHeading>{C.copiesGroup}</GroupHeading>
			<StorageRows shell={shell} />
			<GroupHeading>{C.helpGroup}</GroupHeading>
			<DiagnosticsRow shell={shell} />
		</>
	);
}

/** "127.0.0.1:25463" from the Hub's URL. */
function hubAddress(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).host || undefined;
	} catch {
		return undefined;
	}
}

/**
 * After the Hub is replaced the app reconnects by relaunching, as the Hub
 * update dialog does; without the native shell, reloading reconnects.
 */
async function relaunch(client: SettingsShell["client"]) {
	try {
		await client.relaunchApp();
	} catch {
		window.location.reload();
	}
}

function HubRow({ shell }: { shell: SettingsShell }) {
	const state = useConnections(shell.client);
	const [confirm, setConfirm] = useState(false);
	const [upgrading, setUpgrading] = useState(false);
	const [error, setError] = useState<string>();
	const read = state.connections;
	if (read.status === "unavailable")
		return (
			<UnavailableNote reason={read.unavailable}>
				{C.connectionUnavailable}
			</UnavailableNote>
		);
	const hub: FactoryConnections["hub"] | undefined = read.data?.hub;
	if (!hub)
		return (
			<SettingRow
				id="hub"
				title={C.hub}
				description={read.status === "error" ? read.error : undefined}
			>
				{read.status === "error" ? (
					<ActionButton onClick={() => void state.refresh()}>
						{C.retry}
					</ActionButton>
				) : (
					<>
						<SettingSkeleton />
						<ActionButton disabled onClick={() => {}}>
							{C.retry}
						</ActionButton>
					</>
				)}
			</SettingRow>
		);
	const address = hubAddress(hub.url);
	if (hub.status === "disconnected")
		return (
			<SettingRow
				id="hub"
				title={C.hub}
				description={hub.error || C.hubDisconnected}
			>
				<StatusPill tone="danger">{C.notConnected}</StatusPill>
				<ActionButton
					disabled={state.checking}
					onClick={() => void state.refresh()}
				>
					{C.retry}
				</ActionButton>
			</SettingRow>
		);
	if (hub.mismatch) {
		// "outdated_hub": this app is newer, and `hub_upgrade` replaces the Hub.
		// Otherwise the Hub is newer and only updating the app fixes it.
		const older = hub.mismatch.reason === "outdated_hub";
		return (
			<SettingRow
				id="hub"
				title={C.hub}
				description={`${C.hubHint(address, undefined)} ${older ? C.hubOlder : C.hubNewer}`}
				error={error}
			>
				<StatusPill tone="attention">{C.updateNeeded}</StatusPill>
				{older ? (
					<ActionButton
						primary
						disabled={shell.readOnly || upgrading}
						onClick={() => {
							setError(undefined);
							setConfirm(true);
						}}
					>
						{C.updateHub}
					</ActionButton>
				) : (
					<ActionButton onClick={() => shell.openAppSettings("About")}>
						{C.checkForUpdates}
					</ActionButton>
				)}
				<ConfirmDialog
					open={confirm}
					title={C.updateTitle}
					body={C.updateBody}
					verb={C.updateVerb}
					danger={false}
					busy={upgrading}
					error={error}
					onCancel={() => setConfirm(false)}
					onConfirm={async () => {
						setUpgrading(true);
						setError(undefined);
						try {
							await shell.client.upgradeHub();
						} catch (cause) {
							setError(factorySettingsErrorMessage(cause, FS_SHELL.saveFailed));
							setUpgrading(false);
							return;
						}
						await relaunch(shell.client);
					}}
				/>
			</SettingRow>
		);
	}
	return (
		<DisclosureRow
			id="hub"
			title={C.hub}
			description={C.hubHint(address, hub.appVersion)}
			pill={<StatusPill tone="success">{C.connected}</StatusPill>}
			label={C.details}
		>
			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
				{hub.url ? (
					<>
						<dt className="text-muted-foreground">{C.address}</dt>
						<dd className="font-mono text-[11.5px] select-text">{hub.url}</dd>
					</>
				) : null}
				{hub.appVersion ? (
					<>
						<dt className="text-muted-foreground">{C.appVersion}</dt>
						<dd>{hub.appVersion}</dd>
						<dt className="text-muted-foreground">{C.hubVersion}</dt>
						<dd>{hub.appVersion}</dd>
					</>
				) : null}
			</dl>
		</DisclosureRow>
	);
}

function StorageRows({ shell }: { shell: SettingsShell }) {
	const storage = useSettingsResource(
		() => shell.client.getStorage(),
		[shell.client],
	);
	const saves = useRowSaves(shell.saved);
	const [confirm, setConfirm] = useState(false);
	const [result, setResult] = useState<string>();
	const cleaning = storage.data?.cleaning === true;
	const { reload } = storage;
	// The Hub keeps removing after it answers: read again until it is done.
	useEffect(() => {
		if (!cleaning) return;
		const timer = window.setInterval(reload, 3_000);
		return () => window.clearInterval(timer);
	}, [cleaning, reload]);
	if (storage.status === "unavailable")
		return (
			<UnavailableNote reason={storage.unavailable}>
				{C.storageUnavailable(storage.unavailable === "hub")}
			</UnavailableNote>
		);
	if (storage.status === "error")
		return (
			<p
				role="alert"
				className="flex items-center gap-2 border-b py-3 text-xs text-destructive"
			>
				<span className="flex-1">{storage.error}</span>
				<ActionButton onClick={storage.reload}>{FS_SHELL.retry}</ActionButton>
			</p>
		);
	const data: FactoryStorage | undefined = storage.data;
	if (!data)
		return (
			<output className="flex items-center gap-2 border-b py-3 text-xs text-muted-foreground">
				<Loader2 aria-hidden className="size-3.5 animate-spin" />
				{C.copiesLoading}
			</output>
		);
	const { worktrees } = data;
	const finishedSize = formatBytes(worktrees.finishedBytes);
	return (
		<>
			<SettingRow
				id="worktreesDir"
				title={C.location}
				description={C.locationHint}
				extra={
					<CopyableText
						text={data.worktreesDir}
						display={tildePath(data.worktreesDir)}
					/>
				}
			>
				<CopyButton
					text={data.worktreesDir}
					what={`${C.location.toLowerCase()} path`}
				>
					{C.copyPath}
				</CopyButton>
			</SettingRow>
			<SettingRow
				id="diskUse"
				title={C.diskUse}
				description={C.diskUseHint(
					worktrees.count,
					formatBytes(worktrees.bytes),
					worktrees.finishedCount,
				)}
				extra={
					<>
						{data.approximate ? (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{C.approximate}
							</p>
						) : null}
						{worktrees.unknownCount ? (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{C.unknown(worktrees.unknownCount)}
							</p>
						) : null}
						{cleaning ? (
							<output className="mt-1 block text-xs text-muted-foreground">
								{C.removing}
							</output>
						) : result ? (
							<output className={cn("mt-1 block text-xs", toneText("success"))}>
								{result}
							</output>
						) : null}
					</>
				}
				error={saves.errorFor("diskUse")}
			>
				<ActionButton
					danger
					disabled={
						shell.readOnly ||
						worktrees.finishedCount === 0 ||
						cleaning ||
						saves.busy === "diskUse"
					}
					onClick={() => {
						setResult(undefined);
						setConfirm(true);
					}}
				>
					{C.removeFinished}
				</ActionButton>
			</SettingRow>
			<SettingRow
				id="evidence"
				title={C.evidence}
				description={C.evidenceHint(
					formatBytes(data.artifactsBytes + data.logsBytes),
				)}
				extra={
					<CopyableText
						text={data.artifactsDir}
						display={tildePath(data.artifactsDir)}
					/>
				}
			>
				<CopyButton text={data.artifactsDir} what="evidence path">
					{C.copyPath}
				</CopyButton>
			</SettingRow>
			<ConfirmDialog
				open={confirm}
				title={C.removeTitle}
				body={C.removeBody(worktrees.finishedCount, finishedSize)}
				detail={C.removeDetail}
				verb={C.removeVerb}
				busy={saves.busy === "diskUse"}
				onCancel={() => setConfirm(false)}
				onConfirm={async () => {
					const reply = await saves.save("diskUse", () =>
						shell.client.cleanStorage(),
					);
					setConfirm(false);
					if (!reply.ok) return;
					const {
						removed,
						bytes,
						skipped,
						storage: next,
						running,
					} = reply.value;
					if (running) {
						setResult(undefined);
						storage.set({ ...(next ?? data), cleaning: true });
						return;
					}
					setResult(
						[
							C.removed(removed, formatBytes(bytes)),
							skipped?.length ? C.skipped(skipped.length) : "",
						]
							.filter(Boolean)
							.join(" "),
					);
					if (next) storage.set(next);
					else storage.reload();
				}}
			/>
		</>
	);
}

function DiagnosticsRow({ shell }: { shell: SettingsShell }) {
	const [busy, setBusy] = useState(false);
	const [path, setPath] = useState<string>();
	const [error, setError] = useState<string>();
	return (
		<SettingRow
			id="diagnostics"
			title={C.diagnostics}
			description={C.diagnosticsHint}
			extra={
				path ? (
					<output className="mt-1 block break-all text-xs text-muted-foreground">
						{C.exported(tildePath(path))}
					</output>
				) : null
			}
			error={error}
		>
			<ActionButton
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					setError(undefined);
					setPath(undefined);
					try {
						const reply = await shell.client.exportDiagnostics();
						setPath(reply.path);
					} catch (cause) {
						setError(
							isUnavailable(cause)
								? FS_SHELL.notAvailable
								: factorySettingsErrorMessage(cause, C.exportFailed),
						);
					} finally {
						setBusy(false);
					}
				}}
			>
				{C.exportDiagnostics}
			</ActionButton>
		</SettingRow>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: ThisComputerPage,
	search: [
		{ row: "hub", title: C.hub, description: C.hubSearch },
		{ row: "worktreesDir", title: C.location, description: C.locationHint },
		{ row: "diskUse", title: C.diskUse, description: C.removeFinished },
		{ row: "evidence", title: C.evidence, description: C.evidenceSearch },
		{
			row: "diagnostics",
			title: C.diagnostics,
			description: C.diagnosticsHint,
		},
	],
};
