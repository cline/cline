"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type FactoryProjectSummary,
	factorySettingsErrorMessage,
	isUnavailable,
} from "@/lib/factory-settings-client";
import { FS_PROJECTS } from "@/lib/factory-settings-copy/projects";
import {
	FS_PAGES,
	FS_SHELL,
	fsConfirmTitle,
} from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import {
	ActionButton,
	ConfirmDialog,
	CopyableText,
	CopyButton,
	GroupHeading,
	OpenRow,
	PageTitle,
	SettingRow,
	tildePath,
} from "../../../factory-settings-rows";
import { toneText } from "../../../factory-ui";
import type { SettingsShell } from "../../types";
import { useRowSaves } from "../../use-settings-resource";
import { roleNames, shortRemote } from "./summary";

const P = FS_PROJECTS;

export type ProjectEntry = {
	workspaceRoot: string;
	name: string;
	/** `factory_get_projects`' summary; absent when that command is unavailable. */
	summary?: FactoryProjectSummary;
};

/**
 * One project: links into the pages that hold its settings (Stages, Test
 * setup, Guidance, opened on this project), where its task files live, and
 * "Forget approvals" for it. Nothing here duplicates those pages' controls.
 */
export function ProjectDetail({
	shell,
	headingId,
	project,
	onBack,
}: {
	shell: SettingsShell;
	headingId: string;
	project: ProjectEntry;
	onBack: () => void;
}) {
	const { workspaceRoot: root, name, summary } = project;
	const backRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		backRef.current?.focus();
	}, []);
	const open = (page: "stages" | "verification" | "guidance", role?: string) =>
		shell.open({ page, project: root, ...(role ? { role } : {}) });
	const tasksDir = `${root}/.cline/tasks`;
	return (
		<>
			<PageTitle
				id={headingId}
				title={
					<span className="flex min-w-0 items-center gap-1.5">
						<button
							ref={backRef}
							type="button"
							aria-label={P.back}
							onClick={onBack}
							className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{FS_PAGES.projects}
						</button>
						<ChevronRight
							aria-hidden
							className="size-3.5 shrink-0 text-muted-foreground"
						/>
						<span className="truncate">{name}</span>
					</span>
				}
				scope={[tildePath(root), shortRemote(summary?.remote)]
					.filter(Boolean)
					.join(" · ")}
				action={
					<CopyButton text={root} what="project path">
						{P.copyPath}
					</CopyButton>
				}
			/>
			<GroupHeading>{P.setUpGroup}</GroupHeading>
			<OpenRow
				id="projectStages"
				title={P.repositoryStages}
				description={summary ? stagesHint(summary) : undefined}
				pill={summary ? stagesPill(summary) : undefined}
				label={summary ? undefined : FS_PAGES.stages}
				onOpen={() => open("stages")}
			/>
			<OpenRow
				id="projectTestSetup"
				title={P.testSetup_}
				description={
					summary ? P.testSetupHint[summary.verification] : undefined
				}
				pill={
					summary
						? {
								tone:
									summary.verification === "in_use"
										? "success"
										: summary.verification === "none"
											? "neutral"
											: summary.verification === "invalid"
												? "danger"
												: "attention",
								text: P.testSetupPill[summary.verification],
							}
						: undefined
				}
				label={summary ? undefined : FS_PAGES.verification}
				onOpen={() => open("verification")}
			/>
			<OpenRow
				id="projectGuidance"
				title={P.repositoryGuidance}
				description={
					summary
						? summary.guidance.roles.length
							? P.guidanceHint(
									roleNames(summary.guidance.roles),
									summary.guidance.changed.length
										? roleNames(summary.guidance.changed.slice(0, 1))
										: undefined,
								)
							: P.guidanceNone
						: undefined
				}
				pill={
					summary?.guidance.changed.length
						? {
								tone: "attention",
								text: P.guidanceChangedPill(summary.guidance.changed.length),
							}
						: undefined
				}
				label={summary ? undefined : FS_PAGES.guidance}
				onOpen={() =>
					open(
						"guidance",
						summary?.guidance.changed[0] ?? summary?.guidance.roles[0],
					)
				}
			/>
			<SettingRow
				id="taskFiles"
				title={P.taskFiles}
				description={
					summary ? P.taskFilesHint(summary.taskFiles) : P.taskFilesUnknown
				}
				extra={<CopyableText text={tasksDir} display={tildePath(tasksDir)} />}
			>
				<CopyButton text={tasksDir} what="task files path" />
			</SettingRow>
			<GroupHeading>{P.resetGroup}</GroupHeading>
			<ForgetApprovals shell={shell} root={root} name={name} />
		</>
	);
}

function stagesHint(summary: FactoryProjectSummary): string {
	const { file, total, inUse, awaiting } = summary.stages;
	if (file === "invalid") return P.stagesInvalid;
	return total === 0 ? P.stagesNone : P.stagesSummary(total, inUse, awaiting);
}

function stagesPill(summary: FactoryProjectSummary) {
	const { file, total, awaiting } = summary.stages;
	if (file === "invalid")
		return { tone: "danger" as const, text: P.pill.stagesInvalid };
	if (awaiting > 0)
		return {
			tone: "attention" as const,
			text: P.stagesPill.awaiting(awaiting),
		};
	if (total > 0) return { tone: "success" as const, text: P.stagesPill.inUse };
	return { tone: "neutral" as const, text: P.stagesPill.none };
}

type ForgetState =
	| { kind: "idle" }
	| { kind: "counting" }
	| { kind: "confirm"; stages: number; testSetup: boolean }
	| { kind: "nothing" }
	| { kind: "done"; text: string };

/**
 * "Forget approvals for {name}": a dry run counts what would be forgotten,
 * the confirmation states it, and only the person's confirm resets stage
 * and test setup approvals for this project.
 */
function ForgetApprovals({
	shell,
	root,
	name,
}: {
	shell: SettingsShell;
	root: string;
	name: string;
}) {
	const [state, setState] = useState<ForgetState>({ kind: "idle" });
	const [countError, setCountError] = useState<string>();
	const saves = useRowSaves(shell.saved);
	const count = async () => {
		setState({ kind: "counting" });
		setCountError(undefined);
		try {
			const [stages, verification] = await Promise.all([
				shell.client.reset({
					what: "stage_trust",
					workspaceRoot: root,
					dryRun: true,
				}),
				shell.client.reset({
					what: "verification_trust",
					workspaceRoot: root,
					dryRun: true,
				}),
			]);
			const stageCount = stages.stages ?? 0;
			const testSetup = (verification.projects ?? 0) > 0;
			setState(
				stageCount || testSetup
					? { kind: "confirm", stages: stageCount, testSetup }
					: { kind: "nothing" },
			);
		} catch (cause) {
			setState({ kind: "idle" });
			setCountError(
				isUnavailable(cause)
					? cause.reason === "hub"
						? FS_SHELL.hubTooOld
						: FS_SHELL.notAvailable
					: factorySettingsErrorMessage(cause, FS_SHELL.loadFailed),
			);
		}
	};
	const forget = async () => {
		if (state.kind !== "confirm") return;
		const { stages, testSetup } = state;
		const reply = await saves.save("forgetApprovals", async () => {
			await shell.client.reset({ what: "stage_trust", workspaceRoot: root });
			await shell.client.reset({
				what: "verification_trust",
				workspaceRoot: root,
			});
		});
		if (!reply.ok) {
			setState({ kind: "idle" });
			return;
		}
		setState({ kind: "done", text: P.forgotten(stages, testSetup) });
		shell.projectsSummary.reload();
	};
	const note =
		state.kind === "nothing"
			? P.forgetNothing(name)
			: state.kind === "done"
				? state.text
				: undefined;
	return (
		<div className="mt-2 rounded-lg border border-destructive/50 px-3 [&>[data-setting]]:border-b-0">
			<SettingRow
				id="forgetApprovals"
				title={P.forget(name)}
				description={P.forgetHint}
				extra={
					note ? (
						<output
							className={cn(
								"mt-1 block text-xs",
								state.kind === "done"
									? toneText("success")
									: "text-muted-foreground",
							)}
						>
							{note}
						</output>
					) : null
				}
				error={countError ?? saves.errorFor("forgetApprovals")}
			>
				<ActionButton
					danger
					disabled={
						shell.readOnly ||
						state.kind === "counting" ||
						saves.busy === "forgetApprovals"
					}
					onClick={() => void count()}
				>
					{P.forgetAction}
				</ActionButton>
			</SettingRow>
			<ConfirmDialog
				open={state.kind === "confirm"}
				title={fsConfirmTitle(P.forget(name))}
				body={P.forgetHint}
				detail={
					state.kind === "confirm"
						? P.forgetCount(state.stages, state.testSetup)
						: undefined
				}
				verb={P.forgetVerb}
				busy={saves.busy === "forgetApprovals"}
				onCancel={() => setState({ kind: "idle" })}
				onConfirm={() => void forget()}
			/>
		</div>
	);
}
