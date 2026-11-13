"use client";

import { Plus } from "lucide-react";
import { basenamePath } from "@/hooks/use-session-history";
import {
	FS_COUNTS,
	FS_PAGES,
	FS_SHELL,
} from "@/lib/factory-settings-copy/shell";
import { FS_STAGES } from "@/lib/factory-settings-copy/stages";
import {
	ActionButton,
	GroupHeadingRow,
	PageTitle,
	SettingSkeleton,
	SettingsBanner,
	StatusPill,
	UnavailableNote,
} from "../../factory-settings-rows";
import {
	FactoryStageLine,
	FactoryStageRow,
} from "../../factory-stages-settings";
import { ProjectSelect } from "../shell-parts";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useRowSaves, useSettingsResource } from "../use-settings-resource";
import { OtherProjects } from "./stages/project-scoped";

const S = FS_STAGES;

/**
 * Stages: the five fixed stages every card goes through, then the selected
 * project's repository stages (`.cline/factory/stages.json`), each with one
 * decision the person makes on its visible definition.
 */
function StagesPage({ shell, headingId }: SettingsPageProps) {
	return (
		<>
			<PageTitle
				id={headingId}
				title={FS_PAGES.stages}
				scope={S.scope}
				action={<ProjectSelect shell={shell} />}
			/>
			<FactoryStageLine />
			{shell.project ? (
				<ProjectStages
					key={shell.project}
					shell={shell}
					workspaceRoot={shell.project}
				/>
			) : (
				<p className="mt-4 text-xs text-muted-foreground">{S.noProject}</p>
			)}
			<OtherProjects
				shell={shell}
				page="stages"
				title={S.otherProjects}
				describe={(project) => ({
					description: S.otherSummary(project.stages),
					label: FS_SHELL.open,
					pill:
						project.stages.file === "invalid"
							? { tone: "danger", text: S.invalidPill }
							: project.stages.awaiting
								? { tone: "attention", text: S.trust.needs_approval }
								: undefined,
				})}
			/>
		</>
	);
}

function ProjectStages({
	shell,
	workspaceRoot,
}: {
	shell: SettingsShell;
	workspaceRoot: string;
}) {
	const listing = useSettingsResource(
		() => shell.client.getStages(workspaceRoot),
		[workspaceRoot, shell.client],
	);
	const saves = useRowSaves(shell.saved);
	const project = basenamePath(workspaceRoot);
	const ask = (draft: string) => shell.askFactory(draft);
	const disabled = shell.readOnly || listing.status !== "ready";
	const addStage = (
		<ActionButton
			disabled={shell.readOnly}
			onClick={() => ask(S.addDraft(project))}
		>
			<Plus aria-hidden className="size-3.5" />
			{S.addStage}
		</ActionButton>
	);

	const decide = async (
		stageId: string,
		hash: string,
		decision: "approved" | "declined",
	) => {
		const result = await saves.save(`stage-${stageId}`, () =>
			shell.client.decideStage({
				workspaceRoot,
				stageId,
				expectedHash: hash,
				decision,
			}),
		);
		if (result.ok) {
			listing.set(result.value);
			shell.projectsSummary.reload();
			return;
		}
		// The file may have changed since it was shown ("changed since it was
		// shown; review it again"): read it again so the row shows the current
		// definition and hash before any approval. The error stays under it.
		listing.reload();
	};

	let body: React.ReactNode;
	if (listing.status === "loading" && !listing.data)
		body = (
			<div className="border-b py-3">
				<SettingSkeleton className="h-10 w-full" />
			</div>
		);
	else if (listing.status === "unavailable")
		body = (
			<UnavailableNote reason={listing.unavailable}>
				{listing.unavailable === "hub" ? S.unavailable : undefined}
			</UnavailableNote>
		);
	else if (listing.status === "error")
		body = (
			<div
				data-setting="stagesError"
				className="flex items-center gap-3 border-b py-3"
			>
				<p role="alert" className="flex-1 text-xs text-destructive">
					{S.readFailed} {listing.error}
				</p>
				<ActionButton onClick={listing.reload}>{FS_SHELL.retry}</ActionButton>
			</div>
		);
	else if (listing.data?.file === "invalid")
		body = (
			<div data-setting="stagesInvalid">
				<SettingsBanner
					tone="danger"
					title={S.invalidTitle}
					actions={
						<ActionButton
							disabled={shell.readOnly}
							onClick={() =>
								ask(S.fixDraft(project, listing.data?.reason ?? ""))
							}
						>
							{S.fix}
						</ActionButton>
					}
				>
					{S.invalidBody}
					{listing.data.reason ? (
						<code className="mt-1 block font-mono break-words text-foreground">
							{listing.data.reason}
						</code>
					) : null}
				</SettingsBanner>
			</div>
		);
	else if (!listing.data?.stages.length)
		body = (
			<div data-setting="stagesEmpty" className="border-b py-4">
				<p className="max-w-[560px] text-sm">{S.empty(project)}</p>
				<p className="mt-3 text-xs font-medium text-muted-foreground">
					{S.ideasTitle}
				</p>
				<ul className="mt-1 space-y-1">
					{S.ideas.map((idea) => (
						<li key={idea.text}>
							<button
								type="button"
								disabled={shell.readOnly}
								onClick={() => ask(idea.draft(project))}
								className="rounded-sm text-left text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
							>
								{idea.text}
							</button>
						</li>
					))}
				</ul>
				<div className="mt-3">{addStage}</div>
			</div>
		);
	else
		body = listing.data.stages.map((entry) => {
			const row = `stage-${entry.stage.id}`;
			return (
				<FactoryStageRow
					// A new hash is a new definition: the row starts over (open
					// again when it needs a decision).
					key={`${entry.stage.id}:${entry.hash}`}
					stage={entry.stage}
					status={entry.status}
					project={project}
					config={shell.workflow.config}
					busy={saves.busy === row}
					disabled={disabled}
					error={saves.errorFor(row)}
					onDecide={(decision) =>
						void decide(entry.stage.id, entry.hash, decision)
					}
					onAsk={ask}
				/>
			);
		});

	const showAdd =
		listing.status === "ready" &&
		listing.data?.file !== "invalid" &&
		Boolean(listing.data?.stages.length);
	// The group is the search's and deep links' target once it has controls.
	return (
		<div data-setting={listing.status === "ready" ? "stages" : undefined}>
			<GroupHeadingRow
				title={S.group}
				hint={S.groupHint(project)}
				pill={
					listing.data?.file === "invalid" ? (
						<StatusPill tone="danger">{S.invalidPill}</StatusPill>
					) : undefined
				}
				action={showAdd ? addStage : undefined}
			/>
			{body}
		</div>
	);
}

/** Repository stages needing approval or changed since approved. */
function useBadge(shell: SettingsShell) {
	return (
		shell.projectsSummary.data?.projects.reduce(
			(sum, project) => sum + project.stages.awaiting,
			0,
		) ?? 0
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: StagesPage,
	search: [
		{
			row: "stages",
			title: S.search.stages.title,
			description: S.search.stages.description,
		},
	],
	useBadge,
	badgeLabel: FS_COUNTS.stages,
};
