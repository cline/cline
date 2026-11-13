"use client";

import type { FactoryVerificationProfile } from "@cline/shared/browser";
import { useState } from "react";
import { basenamePath } from "@/hooks/use-session-history";
import { factoryModelLabel } from "@/lib/factory-copy";
import {
	type FactoryVerificationSettings,
	isRefused,
} from "@/lib/factory-settings-client";
import {
	FS_COUNTS,
	FS_PAGES,
	FS_SHELL,
} from "@/lib/factory-settings-copy/shell";
import { FS_TEST_SETUP } from "@/lib/factory-settings-copy/test-setup";
import {
	ActionButton,
	CardLink,
	DisclosureRow,
	GroupHeadingRow,
	OpenRow,
	PageTitle,
	SettingSkeleton,
	SettingsBanner,
	StatusPill,
	UnavailableNote,
} from "../../factory-settings-rows";
import { ProjectSelect } from "../shell-parts";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useRowSaves, useSettingsResource } from "../use-settings-resource";
import { OtherProjects } from "./stages/project-scoped";
import { TestSetupEditor } from "./test-setup/editor";
import { TestSetupFields } from "./test-setup/profile-fields";

const T = FS_TEST_SETUP;

/** "Nov 10": the date a setup last passed. */
const shortDate = (iso: string) => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * Test setup: the selected project's verification profile, shown in full,
 * its trust status and the decisions the person makes on it (approve by
 * hash, stop using, edit as a setup approved on this computer), plus the
 * setups open cards propose.
 */
function TestSetupPage({ shell, headingId }: SettingsPageProps) {
	const overridden = Boolean(
		shell.workflow.config.agents?.verifier?.environment,
	);
	const verifier = shell.workflow.config.agents?.verifier;
	return (
		<>
			<PageTitle
				id={headingId}
				title={FS_PAGES.verification}
				scope={T.scope}
				action={<ProjectSelect shell={shell} />}
			/>
			{overridden ? (
				<SettingsBanner
					tone="neutral"
					actions={
						<ActionButton
							onClick={() => shell.open({ page: "roles", role: "verifier" })}
						>
							{T.openRoles}
						</ActionButton>
					}
				>
					{T.overridden}
				</SettingsBanner>
			) : null}
			{shell.project ? (
				<ProjectTestSetup
					key={shell.project}
					shell={shell}
					workspaceRoot={shell.project}
				/>
			) : (
				<p className="mt-4 text-xs text-muted-foreground">{T.noProject}</p>
			)}
			<GroupHeadingRow title={T.testerGroup} />
			<OpenRow
				id="testerModel"
				title={T.testerModel}
				description={
					verifier
						? T.testerModelHint(
								verifier.modelSelection
									? factoryModelLabel(verifier.modelSelection)
									: T.testerDefaultModel,
							)
						: T.testerOff
				}
				label={T.rolesAndModels}
				onOpen={() => shell.open({ page: "roles", role: "verifier" })}
			/>
			<OtherProjects
				shell={shell}
				page="verification"
				title={T.otherProjects}
				describe={(project) => {
					const status = project.verification;
					return {
						description: T.otherSummary[status],
						pill:
							status === "in_use"
								? { tone: "success", text: T.status.approved }
								: status === "proposed"
									? { tone: "attention", text: T.status.proposed }
									: status === "changed"
										? { tone: "attention", text: T.status.changed }
										: status === "invalid"
											? { tone: "danger", text: T.status.invalid }
											: undefined,
						label: status === "none" ? T.setUp : undefined,
					};
				}}
			/>
		</>
	);
}

function ProjectTestSetup({
	shell,
	workspaceRoot,
}: {
	shell: SettingsShell;
	workspaceRoot: string;
}) {
	const setup = useSettingsResource(
		() => shell.client.getVerification(workspaceRoot),
		[workspaceRoot, shell.client],
	);
	const saves = useRowSaves(shell.saved);
	const [stale, setStale] = useState<string>();
	const [editing, setEditing] = useState<{
		initial?: FactoryVerificationProfile;
	}>();
	const project = basenamePath(workspaceRoot);
	const disabled = shell.readOnly || setup.status !== "ready";

	/** One decision; a stale hash keeps the message and offers Reload. */
	const decide = async (
		row: string,
		args: Omit<
			Parameters<SettingsShell["client"]["setVerification"]>[0],
			"workspaceRoot"
		>,
	) => {
		setStale(undefined);
		const result = await saves.save(row, async () => {
			try {
				return await shell.client.setVerification({ workspaceRoot, ...args });
			} catch (cause) {
				if (isRefused(cause) && cause.code === "factory_verification_stale")
					setStale(row);
				throw cause;
			}
		});
		if (!result.ok) return false;
		setup.set(result.value);
		setEditing(undefined);
		shell.projectsSummary.reload();
		return true;
	};

	if (setup.status === "loading" && !setup.data)
		return (
			<div className="mt-3 border-b py-3">
				<SettingSkeleton className="h-24 w-full" />
			</div>
		);
	if (setup.status === "unavailable")
		return (
			<div className="mt-3">
				<UnavailableNote reason={setup.unavailable}>
					{setup.unavailable === "hub" ? T.unavailable : undefined}
				</UnavailableNote>
			</div>
		);
	if (setup.status === "error" || !setup.data)
		return (
			<div
				data-setting="testSetup"
				className="mt-3 flex items-center gap-3 border-b py-3"
			>
				<p role="alert" className="flex-1 text-xs text-destructive">
					{T.readFailed} {setup.error}
				</p>
				<ActionButton onClick={setup.reload}>{FS_SHELL.retry}</ActionButton>
			</div>
		);

	const data = setup.data;
	const error = (row: string) => {
		const message = saves.errorFor(row);
		if (!message) return null;
		return (
			<p
				role="alert"
				className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive"
			>
				{stale === row ? T.stale : message}
				{stale === row ? (
					<ActionButton
						onClick={() => {
							setStale(undefined);
							setup.reload();
						}}
					>
						{T.reload}
					</ActionButton>
				) : null}
			</p>
		);
	};
	const busy = saves.busy === "testSetup";
	const edit = (initial?: FactoryVerificationProfile) => (
		<ActionButton
			disabled={disabled || busy}
			onClick={() => setEditing({ initial })}
		>
			{T.edit}
		</ActionButton>
	);
	const stopUsing = (
		<ActionButton
			disabled={disabled || busy}
			onClick={() =>
				void decide("testSetup", {
					decision: "remove",
					...(data.approved ? { expectedHash: data.approved.hash } : {}),
				})
			}
		>
			{T.stopUsing}
		</ActionButton>
	);
	const approve = (label: string = T.approve) => (
		<ActionButton
			primary
			disabled={disabled || busy || !data.hash}
			onClick={() =>
				void decide("testSetup", {
					decision: "approve",
					expectedHash: data.hash,
				})
			}
		>
			{label}
		</ActionButton>
	);
	// A local setup can be saved only while the repository has no file.
	const canEdit = data.file === "absent";

	if (editing)
		return (
			<>
				<GroupHeadingRow
					title={T.editorTitle}
					hint={`${project} · ${T.approvedHere}`}
				/>
				<TestSetupEditor
					initial={editing.initial}
					project={project}
					busy={busy}
					error={saves.errorFor("testSetup")}
					onCancel={() => setEditing(undefined)}
					onSave={(profile) =>
						decide("testSetup", {
							decision: "approve",
							profile,
							...(data.approved ? { expectedHash: data.approved.hash } : {}),
						})
					}
				/>
			</>
		);

	let main: React.ReactNode;
	switch (data.status) {
		case "none":
			main = (
				<div data-setting="testSetup" className="mt-3 border-b pb-4">
					<div className="flex items-center gap-2">
						<StatusPill tone="neutral">{T.status.none}</StatusPill>
					</div>
					<p className="mt-2 text-sm font-medium">{T.emptyTitle(project)}</p>
					<p className="mt-1 max-w-[600px] text-xs text-muted-foreground">
						{T.emptyBody}
					</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{canEdit ? (
							<ActionButton
								primary
								disabled={disabled}
								onClick={() => setEditing({})}
							>
								{T.setUp}
							</ActionButton>
						) : null}
						<ActionButton
							disabled={shell.readOnly}
							onClick={() => shell.askFactory(T.askDraft(project))}
						>
							{T.askFactory}
						</ActionButton>
					</div>
					{error("testSetup")}
				</div>
			);
			break;
		case "proposed":
			main = (
				<>
					<div data-setting="testSetup">
						<SettingsBanner
							title={T.proposedTitle(project)}
							actions={
								<>
									{canEdit ? edit(data.profile) : null}
									{approve()}
								</>
							}
						>
							{data.proposedBy ? (
								<>
									{T.proposedWhile}{" "}
									<CardLink card={data.proposedBy} onOpen={shell.openCard} />{" "}
									{T.proposedWhileTitle(data.proposedBy.title)}{" "}
								</>
							) : data.file === "present" ? (
								`${T.proposedFile} `
							) : null}
							{T.proposedRead}
						</SettingsBanner>
						{error("testSetup")}
					</div>
					<GroupHeadingRow
						title={T.proposedHeading}
						hint={T.proposedHint}
						pill={<StatusPill tone="attention">{T.status.proposed}</StatusPill>}
					/>
					{data.profile ? <TestSetupFields profile={data.profile} /> : null}
				</>
			);
			break;
		case "changed":
			main = (
				<>
					<div data-setting="testSetup">
						<SettingsBanner
							title={T.changedTitle}
							actions={
								<>
									{stopUsing}
									{approve(T.approveNew)}
								</>
							}
						>
							{T.changedBody}
						</SettingsBanner>
						{error("testSetup")}
					</div>
					<GroupHeadingRow
						title={T.changedHeading}
						hint={`${T.fromRepository} · ${T.changedHint}`}
						pill={<StatusPill tone="attention">{T.status.changed}</StatusPill>}
					/>
					{data.profile ? (
						<TestSetupFields
							profile={data.profile}
							previous={data.approved?.profile}
						/>
					) : null}
				</>
			);
			break;
		case "invalid":
			main = (
				<div data-setting="testSetup">
					<SettingsBanner
						tone="danger"
						title={T.invalidTitle}
						actions={
							<>
								{data.approved ? stopUsing : null}
								<ActionButton
									disabled={shell.readOnly}
									onClick={() =>
										shell.askFactory(T.fixDraft(project, data.reason ?? ""))
									}
								>
									{T.fix}
								</ActionButton>
							</>
						}
					>
						{T.invalidBody}
						{data.reason ? (
							<code className="mt-1 block font-mono break-words text-foreground">
								{data.reason}
							</code>
						) : null}
					</SettingsBanner>
					{error("testSetup")}
				</div>
			);
			break;
		case "in_use": {
			const local = data.origin === "approved_local";
			const provenAt = data.approved?.provenAt;
			main = (
				<>
					<div data-setting="testSetup">
						<GroupHeadingRow
							title={T.inUseHeading}
							hint={[
								local ? T.approvedHere : T.fromRepository,
								provenAt ? T.lastPassed(shortDate(provenAt)) : undefined,
							]
								.filter(Boolean)
								.join(" · ")}
							pill={<StatusPill tone="success">{T.status.approved}</StatusPill>}
							action={
								<>
									{local && canEdit ? edit(data.profile) : null}
									{stopUsing}
								</>
							}
						/>
						{error("testSetup")}
					</div>
					{data.profile ? <TestSetupFields profile={data.profile} /> : null}
				</>
			);
			break;
		}
	}

	return (
		<>
			{main}
			{data.profile && data.status !== "none" ? (
				<p className="pb-1 text-xs text-muted-foreground">{T.runsAsYou}</p>
			) : null}
			<Proposals
				data={data}
				onOpenCard={shell.openCard}
				disabled={disabled}
				busyRow={saves.busy}
				error={error}
				onApprove={(row, hash) =>
					void decide(row, { decision: "approve", expectedHash: hash })
				}
			/>
		</>
	);
}

/**
 * Setups open cards propose, other than the one shown above. While the
 * project has no file, each can be approved by its hash, with its whole
 * definition open; with a file, the file decides and they are shown only.
 */
function Proposals({
	data,
	onOpenCard,
	disabled,
	busyRow,
	error,
	onApprove,
}: {
	data: FactoryVerificationSettings;
	disabled: boolean;
	busyRow?: string;
	error: (row: string) => React.ReactNode;
	onApprove: (row: string, hash: string) => void;
	onOpenCard: (taskId: string) => void;
}) {
	const shownHash = data.status === "proposed" ? data.hash : undefined;
	const proposals = (data.proposals ?? []).filter(
		(proposal) => proposal.hash !== shownHash,
	);
	if (!proposals.length) return null;
	const approvable = data.file === "absent";
	return (
		<>
			<GroupHeadingRow title={T.proposalsGroup} hint={T.proposalsHint} />
			{proposals.map((proposal) => {
				const row = `proposal-${proposal.taskId}`;
				const title = (
					<>
						{T.proposedBy} <CardLink card={proposal} onOpen={onOpenCard} />
					</>
				);
				const fields = (
					<>
						<TestSetupFields profile={proposal.profile} />
						<p className="text-xs text-muted-foreground">
							{approvable
								? `${data.status === "in_use" ? `${T.proposalReplaces} ` : ""}${T.runsAsYou}`
								: T.proposalUsesFile}
						</p>
					</>
				);
				return approvable ? (
					<div key={row} data-setting={row} className="border-b py-3">
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0 flex-1">
								<p id={`${row}-title`} className="text-sm font-medium">
									{title}
								</p>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{proposal.title}
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<StatusPill tone="attention">{T.status.proposed}</StatusPill>
								<ActionButton
									primary
									disabled={disabled || busyRow === row}
									aria-describedby={`${row}-title`}
									onClick={() => onApprove(row, proposal.hash)}
								>
									{T.approve}
								</ActionButton>
							</div>
						</div>
						{error(row)}
						{fields}
					</div>
				) : (
					<DisclosureRow
						key={row}
						id={row}
						title={title}
						description={proposal.title}
					>
						{fields}
					</DisclosureRow>
				);
			})}
		</>
	);
}

/** Projects whose test setup is proposed or changed since approved. */
function useBadge(shell: SettingsShell) {
	return (
		shell.projectsSummary.data?.projects.filter(
			(project) =>
				project.verification === "proposed" ||
				project.verification === "changed",
		).length ?? 0
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: TestSetupPage,
	search: [
		{
			row: "testSetup",
			title: T.search.testSetup.title,
			description: T.search.testSetup.description,
		},
		{
			row: "testerModel",
			title: T.search.testerModel.title,
			description: T.search.testerModel.description,
		},
	],
	useBadge,
	badgeLabel: FS_COUNTS.verification,
};
