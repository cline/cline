"use client";

import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryWorkflowConfig,
	factoryIndependentReview,
	factoryWatchesPullRequest,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import { Switch } from "@cline/ui";
import { Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import { FS_AUTOMATION } from "@/lib/factory-settings-copy/automation";
import { FS_PAGES } from "@/lib/factory-settings-copy/shell";
import {
	ActionButton,
	GroupHeading,
	NumberField,
	PageTitle,
	rowLabels,
	SettingRow,
	SettingSelect,
	UnavailableNote,
} from "../../factory-settings-rows";
import { effectiveDraftReview, updateOlderWorkflow } from "../default-workflow";
import { WorkflowLoadError } from "../shell-parts";
import type {
	SettingsPageDefinition,
	SettingsPageProps,
	SettingsShell,
} from "../types";
import { useRowSaves } from "../use-settings-resource";

type PlanApproval = FactoryWorkflowConfig["approval"];
type DraftReview = NonNullable<FactoryWorkflowConfig["humanStamp"]>;
type PullRequestReady = NonNullable<FactoryWorkflowConfig["pullRequestReady"]>;

const G = FACTORY_SETTINGS.general;
const A = FS_AUTOMATION;

/**
 * Automation: how much Factory does on its own, for new work. Every row is a
 * field of the default workflow and saves on change through
 * `factory_save_preset`.
 */
function AutomationPage({ shell, headingId }: SettingsPageProps) {
	const { workflow } = shell;
	const { config, commit, errorFor } = workflow;
	const loading = workflow.presets.loading;
	const disabled = loading || shell.readOnly;
	const older =
		!loading && !workflow.presets.error && !isFactoryHandsOff(config);
	// The engine's own test: a code reviewer on a model no author uses.
	const independent = factoryIndependentReview(
		config.agents ?? DEFAULT_FACTORY_AGENTS,
		undefined,
	).independent;
	const pullRequestReady: PullRequestReady = config.pullRequestReady ?? "never";
	const draftReview = effectiveDraftReview(config);
	return (
		<>
			<PageTitle
				id={headingId}
				title={FS_PAGES.automation}
				scope={A.scope}
				savedTo={{
					name: workflow.name,
					onOpen: () => shell.open({ page: "workflows" }),
				}}
				alert={<WorkflowLoadError workflow={workflow} />}
			/>
			<GroupHeading>{A.waitsGroup}</GroupHeading>
			<SettingRow
				id="approval"
				title={G.planApproval}
				description={G.planApprovalHint[config.approval]}
				error={errorFor("approval")}
				top
				extra={
					older ? (
						<div
							data-testid="factory-settings-older"
							className="mt-2.5 flex items-start gap-2 rounded-lg border bg-card py-2 pr-2.5 pl-3 text-xs"
						>
							<Info
								aria-hidden
								className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
							/>
							<p className="min-w-0 flex-1 text-muted-foreground">
								<span className="font-medium text-foreground">
									{G.olderTitle}
								</span>{" "}
								{G.olderBody(
									config.approval === "required",
									config.maxCostUsd === undefined,
								)}
							</p>
							<Button
								variant="outline"
								size="xs"
								className="h-[26px]"
								disabled={disabled}
								onClick={() => commit(updateOlderWorkflow(config), "approval")}
							>
								{G.update}
							</Button>
						</div>
					) : null
				}
			>
				<SettingSelect<PlanApproval>
					id="approval"
					value={config.approval}
					disabled={disabled}
					options={(["automatic", "required"] as const).map((value) => ({
						value,
						label: G.planApprovalOptions[value],
					}))}
					onChange={(approval) => commit({ ...config, approval }, "approval")}
				/>
			</SettingRow>
			<SettingRow
				id="humanStamp"
				title={G.draftReview}
				description={G.draftReviewHint[draftReview]}
				error={errorFor("humanStamp")}
				top
			>
				<SettingSelect<DraftReview>
					id="humanStamp"
					value={draftReview}
					disabled={disabled}
					options={(["by_risk", "always", "never"] as const).map((value) => ({
						value,
						label: G.draftReviewOptions[value],
					}))}
					onChange={(humanStamp) =>
						commit({ ...config, humanStamp }, "humanStamp")
					}
				/>
			</SettingRow>
			<GroupHeading>{A.pullRequestsGroup}</GroupHeading>
			<SettingRow
				id="pullRequestReady"
				title={G.pullRequests}
				description={G.pullRequestHint[pullRequestReady]}
				extra={
					independent ? null : (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{A.needsReviewer}{" "}
							<button
								type="button"
								className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => shell.open({ page: "roles", row: "reviewers" })}
							>
								{A.setReviewer}
							</button>
							.
						</p>
					)
				}
				error={errorFor("pullRequestReady")}
				top
			>
				<SettingSelect<PullRequestReady>
					id="pullRequestReady"
					value={pullRequestReady}
					disabled={disabled}
					options={(["never", "when_no_review_required"] as const).map(
						(value) => ({
							value,
							label: G.pullRequestOptions[value],
							disabled: value === "when_no_review_required" && !independent,
						}),
					)}
					onChange={(value) =>
						commit({ ...config, pullRequestReady: value }, "pullRequestReady")
					}
				/>
			</SettingRow>
			<SettingRow
				id="watchPullRequest"
				title={A.keepPassing}
				description={A.keepPassingHint}
				error={errorFor("watchPullRequest")}
			>
				<Switch
					checked={factoryWatchesPullRequest(config)}
					disabled={disabled}
					data-setting-control="watchPullRequest"
					{...rowLabels("watchPullRequest")}
					onCheckedChange={(watchPullRequest) =>
						commit({ ...config, watchPullRequest }, "watchPullRequest")
					}
				/>
			</SettingRow>
			<GroupHeading>{A.repairsGroup}</GroupHeading>
			<SettingRow
				id="maxRepairRounds"
				title={A.repairRounds}
				description={A.repairRoundsHint}
				error={errorFor("maxRepairRounds")}
			>
				<NumberField
					id="maxRepairRounds"
					value={config.maxRepairRounds}
					min={0}
					max={10}
					disabled={disabled}
					onCommit={(maxRepairRounds) =>
						commit({ ...config, maxRepairRounds }, "maxRepairRounds")
					}
				/>
			</SettingRow>
			<SettingRow
				id="maxRuntimeRetries"
				title={A.retries}
				description={A.retriesHint}
				error={errorFor("maxRuntimeRetries")}
			>
				<NumberField
					id="maxRuntimeRetries"
					value={config.maxRuntimeRetries ?? 2}
					min={0}
					max={5}
					disabled={disabled}
					onCommit={(maxRuntimeRetries) =>
						commit({ ...config, maxRuntimeRetries }, "maxRuntimeRetries")
					}
				/>
			</SettingRow>
			<GroupHeading>{A.learningGroup}</GroupHeading>
			<SettingRow
				id="repoRules"
				title={A.repoRules}
				description={A.repoRulesHint}
				error={errorFor("repoRules")}
			>
				<Switch
					checked={config.repoRules === true}
					disabled={disabled}
					data-setting-control="repoRules"
					{...rowLabels("repoRules")}
					onCheckedChange={(repoRules) =>
						commit({ ...config, repoRules }, "repoRules")
					}
				/>
			</SettingRow>
			<GroupHeading>{A.newWorkGroup}</GroupHeading>
			<DuplicateCheckRow shell={shell} />
			<GroupHeading>{A.notificationsGroup}</GroupHeading>
			<SettingRow
				id="notifications"
				title={A.notifications}
				description={A.notificationsHint}
			>
				<ActionButton
					icon="outside"
					aria-describedby="notifications-description"
					onClick={() => shell.openAppSettings("General")}
				>
					{A.openNotifications}
				</ActionButton>
			</SettingRow>
		</>
	);
}

/**
 * Check for duplicates when work is filed: the Hub's `duplicateCheck`, read
 * and set through the limits commands (on unless turned off). A Hub that
 * omits the field cannot change it.
 */
function DuplicateCheckRow({ shell }: { shell: SettingsShell }) {
	const saves = useRowSaves(shell.saved);
	// The value this page last saved; the shell's limits keep the value read.
	const [saved, setSaved] = useState<boolean>();
	const { limits, loading } = shell.limits;
	const reported = limits?.supported ? limits.duplicateCheck : undefined;
	if (!loading && typeof reported !== "boolean")
		return (
			<UnavailableNote reason="hub">
				{A.duplicateCheckUnavailable}
			</UnavailableNote>
		);
	const checked = saved ?? reported !== false;
	return (
		<SettingRow
			id="duplicateCheck"
			title={A.duplicateCheck}
			description={A.duplicateCheckHint}
			error={saves.errorFor("duplicateCheck")}
		>
			<Switch
				checked={checked}
				disabled={loading || shell.readOnly || saves.busy === "duplicateCheck"}
				data-setting-control="duplicateCheck"
				{...rowLabels("duplicateCheck")}
				onCheckedChange={async (duplicateCheck) => {
					const previous = saved;
					setSaved(duplicateCheck);
					const result = await saves.save("duplicateCheck", () =>
						shell.client.setLimits({ duplicateCheck }),
					);
					if (!result.ok) {
						setSaved(previous);
						return;
					}
					const reply = result.value.supported
						? result.value.duplicateCheck
						: undefined;
					if (reply !== undefined) setSaved(reply);
				}}
			/>
		</SettingRow>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: AutomationPage,
	search: [
		{
			row: "approval",
			title: G.planApproval,
			description: G.planApprovalHint.automatic,
		},
		{
			row: "humanStamp",
			title: G.draftReview,
			description: G.draftReviewHint.by_risk,
		},
		{
			row: "pullRequestReady",
			title: G.pullRequests,
			description: G.pullRequestHint.never,
		},
		{
			row: "watchPullRequest",
			title: A.keepPassing,
			description: A.keepPassingHint,
		},
		{
			row: "maxRepairRounds",
			title: A.repairRounds,
			description: A.repairRoundsHint,
		},
		{ row: "maxRuntimeRetries", title: A.retries, description: A.retriesHint },
		{ row: "repoRules", title: A.repoRules, description: A.repoRulesHint },
		{
			row: "duplicateCheck",
			title: A.duplicateCheck,
			description: A.duplicateCheckHint,
		},
		{
			row: "notifications",
			title: A.notifications,
			description: A.notificationsHint,
		},
	],
};
