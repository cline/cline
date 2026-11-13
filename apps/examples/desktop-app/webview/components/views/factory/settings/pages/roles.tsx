"use client";

import {
	factoryIndependentReview,
	factoryRequiresIndependentReview,
	factoryReviewMode,
} from "@cline/shared/browser";
import { Switch } from "@cline/ui";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getInitialChatConfig } from "@/hooks/chat-session/constants";
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import { FS_ROLES, type FsRoleKey } from "@/lib/factory-settings-copy/roles";
import { FS_PAGES } from "@/lib/factory-settings-copy/shell";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import { cn } from "@/lib/utils";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";
import {
	DisclosureRow,
	GroupHeading,
	PageTitle,
	rowLabels,
	SettingRow,
	SettingSelect,
} from "../../factory-settings-rows";
import { toneText } from "../../factory-ui";
import { WorkflowLoadError } from "../shell-parts";
import type { SettingsPageDefinition, SettingsPageProps } from "../types";
import {
	type Agents,
	addAgent,
	isListRole,
	ROLE_GUIDANCE,
	ROLE_KEYS,
	removeAgent,
	roleAgents,
	roleFromFocus,
	withAgent,
	withTester,
	workflowAgents,
} from "./roles/agents";
import { ModelPicker } from "./roles/model-picker";
import { RoleDetail } from "./roles/role-detail";

const R = FS_ROLES;
const CODE_REVIEW = FACTORY_SETTINGS.models;

/**
 * Roles & models: who does each step of the default workflow, one row per
 * role with its models inline, expanding to each agent's own settings; the
 * review rules; and the manager. Every field saves on change through
 * `factory_save_preset` (`shell.workflow.commit`), with rollback and the
 * error under the row that made it.
 */
function RolesPage({ shell, headingId, focus }: SettingsPageProps) {
	const { workflow } = shell;
	const { config, commit, errorFor } = workflow;
	const disabled = workflow.presets.loading || shell.readOnly;
	const agents = workflowAgents(config);
	const [open, setOpen] = useState<FsRoleKey | undefined>(() =>
		roleFromFocus(focus?.role),
	);
	const [tab, setTab] = useState(0);
	const setAgents = (next: Agents, row: string) =>
		commit({ ...config, agents: next }, row);
	const toggle = (role: FsRoleKey) => {
		setOpen((current) => (current === role ? undefined : role));
		setTab(0);
	};

	const independent = factoryIndependentReview(agents, undefined).independent;
	const requireIndependent = factoryRequiresIndependentReview(config);
	const noChecks = agents.planReviewers.length === 0 && !agents.verifier;
	const reviewerCount = agents.reviewers.length;
	const minReviewers = Math.min(config.minCodeReviewers ?? 1, reviewerCount);

	const roleRow = (role: FsRoleKey) => {
		const copy = R.roles[role];
		const list = roleAgents(agents, role);
		const expanded = open === role;
		const warnings =
			role === "reviewers"
				? [
						...(independent
							? []
							: [
									requireIndependent
										? `${R.sameModelWarning} ${R.sameModelWaits}`
										: R.sameModelWarning,
								]),
						...(noChecks ? [R.noChecksWarning] : []),
					]
				: [];
		return (
			<div key={role}>
				<SettingRow
					id={role}
					title={copy.title}
					description={
						role === "planReviewers" && list.length === 0
							? R.roles.planReviewers.empty
							: copy.hint
					}
					extra={warnings.map((warning) => (
						<p
							key={warning}
							data-role-warning=""
							className={cn(
								"mt-1 flex max-w-[490px] items-start gap-1.5 text-xs",
								toneText("attention"),
							)}
						>
							<AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
							<span>{warning}</span>
						</p>
					))}
					error={errorFor(role)}
					top={warnings.length > 0}
					wrap
				>
					{list.map((agent, index) => (
						<ModelPicker
							// biome-ignore lint/suspicious/noArrayIndexKey: agents have no id; a role's list is its order.
							key={index}
							label={R.modelLabel(
								isListRole(role) ? `${copy.tab} ${index + 1}` : copy.tab,
							)}
							selection={agent.modelSelection}
							disabled={disabled}
							onChange={(modelSelection) =>
								setAgents(
									withAgent(agents, role, index, { ...agent, modelSelection }),
									role,
								)
							}
						/>
					))}
					{role === "verifier" ? (
						<Switch
							checked={Boolean(agents.verifier)}
							disabled={disabled}
							data-setting-control="verifier"
							aria-label={R.useTester}
							aria-describedby="verifier-description"
							onCheckedChange={(on) => {
								commit(withTester(config, on), "verifier");
								if (!on && open === "verifier") setOpen(undefined);
							}}
						/>
					) : null}
					<Button
						variant="ghost"
						size="xs"
						className="size-7 px-0 text-muted-foreground"
						aria-expanded={expanded}
						aria-controls={`role-${role}-detail`}
						aria-label={
							expanded
								? R.hideDetails(copy.title.toLowerCase())
								: R.showDetails(copy.title.toLowerCase())
						}
						title={
							expanded
								? R.hideDetails(copy.title.toLowerCase())
								: R.showDetails(copy.title.toLowerCase())
						}
						onClick={() => toggle(role)}
					>
						{expanded ? (
							<ChevronDown aria-hidden className="size-4" />
						) : (
							<ChevronRight aria-hidden className="size-4" />
						)}
					</Button>
				</SettingRow>
				{expanded ? (
					<RoleDetail
						role={role}
						agents={agents}
						index={Math.min(tab, Math.max(0, list.length - 1))}
						onSelect={setTab}
						disabled={disabled}
						errorFor={errorFor}
						onChange={setAgents}
						onAdd={() => {
							if (!isListRole(role)) return;
							commit(addAgent(config, role), role);
							setTab(list.length);
						}}
						onRemove={(index) => {
							if (!isListRole(role)) return;
							commit(removeAgent(config, role, index), role);
							setTab(Math.max(0, index - 1));
						}}
						onOpenGuidance={() =>
							shell.open({ page: "guidance", role: ROLE_GUIDANCE[role] })
						}
					/>
				) : null}
			</div>
		);
	};

	return (
		<>
			<PageTitle
				id={headingId}
				title={FS_PAGES.roles}
				scope={R.scope}
				savedTo={{
					name: workflow.name,
					onOpen: () => shell.open({ page: "workflows" }),
				}}
				alert={<WorkflowLoadError workflow={workflow} />}
			/>
			<GroupHeading>{R.rolesGroup}</GroupHeading>
			{ROLE_KEYS.map(roleRow)}

			<GroupHeading>{R.reviewGroup}</GroupHeading>
			<SettingRow
				id="requireIndependentReview"
				title={R.requireIndependent}
				description={R.requireIndependentHint}
				error={errorFor("requireIndependentReview")}
			>
				<Switch
					checked={requireIndependent}
					disabled={disabled}
					data-setting-control="requireIndependentReview"
					{...rowLabels("requireIndependentReview")}
					onCheckedChange={(requireIndependentReview) =>
						commit(
							{ ...config, requireIndependentReview },
							"requireIndependentReview",
						)
					}
				/>
			</SettingRow>
			<SettingRow
				id="reviewMode"
				title={R.codeReview}
				description={CODE_REVIEW.codeReviewHint[factoryReviewMode(config)]}
				error={errorFor("reviewMode")}
			>
				<SettingSelect<"adaptive" | "fixed">
					id="reviewMode"
					value={factoryReviewMode(config)}
					disabled={disabled}
					options={(["adaptive", "fixed"] as const).map((value) => ({
						value,
						label: CODE_REVIEW.codeReviewOptions[value],
					}))}
					onChange={(reviewMode) =>
						commit({ ...config, reviewMode }, "reviewMode")
					}
				/>
			</SettingRow>
			<SettingRow
				id="minCodeReviewers"
				title={R.fewestReviewers}
				description={
					reviewerCount < 4
						? `${R.fewestReviewersHint} ${R.fewestReviewersCapped(reviewerCount)}`
						: R.fewestReviewersHint
				}
				error={errorFor("minCodeReviewers")}
			>
				<SettingSelect<string>
					id="minCodeReviewers"
					className="min-w-20"
					value={String(minReviewers)}
					disabled={disabled}
					options={[1, 2, 3, 4].map((count) => ({
						value: String(count),
						label: String(count),
						disabled: count > reviewerCount,
					}))}
					onChange={(value) =>
						commit(
							{ ...config, minCodeReviewers: Number(value) },
							"minCodeReviewers",
						)
					}
				/>
			</SettingRow>

			<GroupHeading>{R.managerGroup}</GroupHeading>
			<ManagerModelRow disabled={shell.readOnly} />
			<DisclosureRow
				id="managerCan"
				title={R.managerCan}
				description={R.managerCanHint}
			>
				<div className="grid gap-4 text-xs sm:grid-cols-2">
					{(
						[
							[R.canHeading, R.can],
							[R.cannotHeading, R.cannot],
						] as const
					).map(([heading, items]) => (
						<div key={heading}>
							<p className="mb-1 font-medium">{heading}</p>
							<ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
								{items.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</DisclosureRow>
		</>
	);
}

/**
 * Ask Factory's own remembered model (the one its composer writes), read
 * with the chat's remembered model as the fallback while none is chosen.
 */
function ManagerModelRow({ disabled }: { disabled: boolean }) {
	const [config, setConfig] = useState(() =>
		getInitialChatConfig(LOCAL_WORKSPACE_ENVIRONMENT_ID, {
			executionTarget: "local",
			modelScope: "factory-manager",
		}),
	);
	return (
		<SettingRow
			id="managerModel"
			title={R.managerModel}
			description={`${R.managerModelHint} ${R.managerModelOwn}`}
		>
			<ModelPicker
				label={R.managerModel}
				selection={{ providerId: config.provider, modelId: config.model }}
				disabled={disabled}
				onChange={({ providerId, modelId }) => {
					const remembered =
						readModelSelectionStorageFromWindow("factory-manager");
					writeModelSelectionStorageToWindow(
						{
							lastProvider: providerId,
							lastModelByProvider: {
								...remembered.lastModelByProvider,
								[providerId]: modelId,
							},
						},
						"factory-manager",
					);
					setConfig((current) => ({
						...current,
						provider: providerId,
						model: modelId,
					}));
				}}
			/>
		</SettingRow>
	);
}

export const settingsPage: SettingsPageDefinition = {
	Page: RolesPage,
	search: [
		...ROLE_KEYS.map((role) => ({
			row: role,
			title: R.roles[role].title,
			description: R.roles[role].hint,
		})),
		{
			row: "requireIndependentReview",
			title: R.requireIndependent,
			description: R.requireIndependentHint,
		},
		{
			row: "reviewMode",
			title: R.codeReview,
			description: CODE_REVIEW.codeReviewHint.adaptive,
		},
		{
			row: "minCodeReviewers",
			title: R.fewestReviewers,
			description: R.fewestReviewersHint,
		},
		{
			row: "managerModel",
			title: R.managerModel,
			description: R.managerModelHint,
		},
		{ row: "managerCan", title: R.managerCan, description: R.managerCanHint },
	],
};
