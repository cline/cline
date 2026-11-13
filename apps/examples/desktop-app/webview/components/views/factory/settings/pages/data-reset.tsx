"use client";

import { useCallback, useEffect, useState } from "react";
import { FS_DATA } from "@/lib/factory-settings-copy/data-reset";
import { FS_PAGES, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import {
	ActionButton,
	GroupHeading,
	PageTitle,
	SettingRow,
	SettingSkeleton,
	UnavailableNote,
} from "../../factory-settings-rows";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useSettingsResource } from "../use-settings-resource";
import { DANGER_ACTIONS, DangerRow } from "./data-reset/danger-row";

const D = FS_DATA;

/**
 * Data & reset: where Factory keeps its data, the archive, and the danger
 * zone. Every reset is the person's click, confirmed with a dry run's count.
 */
function DataResetPage({ shell, headingId }: SettingsPageProps) {
	// Whether this build and Hub can reset: a dry run changes nothing.
	const probe = useSettingsResource(
		() => shell.client.reset({ what: "stage_trust", dryRun: true }),
		[shell.client],
	);
	const [zoneUnavailable, setZoneUnavailable] = useState<"build" | "hub">();
	const unavailable =
		zoneUnavailable ??
		(probe.status === "unavailable" ? probe.unavailable : undefined);
	return (
		<>
			<PageTitle id={headingId} title={FS_PAGES.data} scope={D.scope} />
			<GroupHeading>{D.dataGroup}</GroupHeading>
			<FactoryDataRow shell={shell} />
			<ArchivedRow shell={shell} />
			<GroupHeading>{D.dangerGroup}</GroupHeading>
			{unavailable ? (
				<UnavailableNote reason={unavailable}>
					{unavailable === "hub" ? D.dangerHubTooOld : D.dangerUnavailable}
				</UnavailableNote>
			) : (
				<div
					data-danger-zone=""
					className="mt-3 rounded-lg border border-destructive/50 px-3.5 [&>*:last-child]:border-b-0"
				>
					{DANGER_ACTIONS.map((action) => (
						<DangerRow
							key={action.what}
							action={action}
							shell={shell}
							disabled={shell.readOnly || probe.status === "loading"}
							onUnavailable={setZoneUnavailable}
						/>
					))}
				</div>
			)}
		</>
	);
}

/**
 * Factory data: the folder as selectable text with Copy path (no Finder
 * command exists). The Hub reports the folder with a storage measurement, so
 * it is read only when the person asks for it.
 */
function FactoryDataRow({ shell }: { shell: SettingsShell }) {
	const [asked, setAsked] = useState(false);
	const storage = useSettingsResource(
		() => shell.client.getStorage(),
		[shell.client],
		{ enabled: asked },
	);
	const [copy, setCopy] = useState<{ ok: boolean; text: string }>();
	const dataDir = storage.data?.dataDir;
	const copyPath = useCallback((path: string) => {
		void Promise.resolve()
			.then(() => navigator.clipboard.writeText(path))
			.then(
				() => setCopy({ ok: true, text: D.pathCopied }),
				() => setCopy({ ok: false, text: D.copyFailed }),
			);
	}, []);
	useEffect(() => {
		if (dataDir) copyPath(dataDir);
	}, [dataDir, copyPath]);
	if (storage.status === "unavailable")
		return (
			<UnavailableNote reason={storage.unavailable}>
				{storage.unavailable === "hub"
					? `${D.factoryData}: ${FS_SHELL.hubTooOld}`
					: D.factoryDataUnavailable}
			</UnavailableNote>
		);
	const loading = asked && storage.status === "loading";
	return (
		<SettingRow
			id="factoryData"
			title={D.factoryData}
			top
			description={
				loading ? (
					<SettingSkeleton className="w-64" />
				) : dataDir ? (
					<>
						<code
							data-factory-data-path=""
							className="cursor-text font-mono text-[11.5px] break-all text-foreground/80 select-all"
						>
							{dataDir}
						</code>{" "}
						· {D.factoryDataHint}
					</>
				) : (
					D.factoryDataHint
				)
			}
			extra={
				copy?.ok ? (
					<output className="mt-0.5 block text-xs text-muted-foreground">
						{copy.text}
					</output>
				) : null
			}
			error={
				storage.status === "error"
					? storage.error
					: copy && !copy.ok
						? copy.text
						: undefined
			}
		>
			{storage.status === "error" ? (
				<ActionButton onClick={storage.reload}>{FS_SHELL.retry}</ActionButton>
			) : (
				<ActionButton
					disabled={loading}
					aria-describedby="factoryData-title"
					onClick={() => {
						setCopy(undefined);
						if (dataDir) copyPath(dataDir);
						else setAsked(true);
					}}
				>
					{D.copyPath}
				</ActionButton>
			)}
		</SettingRow>
	);
}

/** Archived cards: how many, and Open archive (the board's Archived view). */
function ArchivedRow({ shell }: { shell: SettingsShell }) {
	const projects = shell.projectsSummary.data?.projects;
	const count =
		shell.projectsSummary.status === "ready" &&
		projects?.every((project) => project.cards)
			? projects.reduce(
					(sum, project) => sum + (project.cards?.archived ?? 0),
					0,
				)
			: undefined;
	return (
		<SettingRow
			id="archivedCards"
			title={D.archived}
			description={D.archivedHint(count)}
		>
			<ActionButton
				aria-describedby="archivedCards-description"
				onClick={shell.openArchive}
			>
				{D.openArchive}
			</ActionButton>
		</SettingRow>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: DataResetPage,
	search: [
		{
			row: "factoryData",
			title: D.factoryData,
			description: D.factoryDataHint,
		},
		{
			row: "archivedCards",
			title: D.archived,
			description: D.archivedHint(undefined),
		},
		...DANGER_ACTIONS.map((action) => ({
			row: action.row,
			title: action.confirmTitle.replace("?", ""),
			description: action.hint,
		})),
	],
};
