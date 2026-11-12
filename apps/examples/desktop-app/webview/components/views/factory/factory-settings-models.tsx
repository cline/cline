"use client";

import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryWorkflowConfig,
	factoryRequiresIndependentReview,
	factoryReviewMode,
	factoryWorkflowConfigSchema,
	factoryWorkflowRecipeSchema,
} from "@cline/shared/browser";
import { Switch } from "@cline/ui";
import { AlertTriangle, ChevronRight, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";
import {
	FACTORY_REVIEW_SAFETY,
	FACTORY_SETTINGS,
	FACTORY_WORKFLOW,
	factoryShortModel,
} from "@/lib/factory-copy";
import { factoryReviewCoverage } from "@/lib/factory-limits";
import type { FactoryPreset } from "@/lib/factory-presets";
import { cn } from "@/lib/utils";
import { ModelSelector } from "../chat/chat-input-bar";
import type { DefaultWorkflow } from "./factory-settings";
import {
	GroupHeading,
	rowLabels,
	SectionTitle,
	SettingRow,
	SettingSelect,
	useCommittedText,
} from "./factory-settings-rows";
import { toneText } from "./factory-ui";
import { AgentEditor, AppEnvironmentEditor } from "./factory-workflow-editor";

const noop = () => {};
const MAX_PER_ROLE = 4;
type Agents = NonNullable<FactoryWorkflowConfig["agents"]>;
type ListRole = "planReviewers" | "implementers" | "reviewers";
const MIN_PER_ROLE: Record<ListRole, number> = {
	planReviewers: 0,
	implementers: 1,
	reviewers: 1,
};

/**
 * One role's model: the app's own model picker, as the row's control. The
 * full model id is the title; an agent without a model runs on the default.
 */
function ModelPicker({
	label,
	agent,
	disabled,
	onChange,
}: {
	label: string;
	agent: FactoryAgent;
	disabled: boolean;
	onChange: (agent: FactoryAgent) => void;
}) {
	const selection = agent.modelSelection;
	return (
		<fieldset
			aria-label={label}
			title={
				selection
					? `${selection.providerId}/${selection.modelId}`
					: FACTORY_SETTINGS.models.defaultModel
			}
			data-model={selection ? factoryShortModel(selection.modelId) : ""}
			className="min-w-0"
		>
			<ModelSelector
				provider={selection?.providerId ?? ""}
				model={selection?.modelId ?? ""}
				isBusy={disabled}
				autoCorrectModel={false}
				persistSelection={false}
				onProviderChange={noop}
				onModelChange={noop}
				onSelectionChange={(modelSelection) =>
					onChange({ ...agent, modelSelection })
				}
				onModelReadyChange={noop}
				onModelSupportsReasoningChange={noop}
				onModelSupportsImagesChange={noop}
				compactLabel={
					selection
						? factoryShortModel(selection.modelId)
						: FACTORY_SETTINGS.models.defaultModel
				}
			/>
		</fieldset>
	);
}

/** A whole number field that commits on blur or Enter. */
function NumberInput({
	id,
	value,
	min,
	max,
	disabled,
	onCommit,
}: {
	id: string;
	value: number;
	min: number;
	max: number;
	disabled: boolean;
	onCommit: (value: number) => void;
}) {
	const field = useCommittedText<number>(value, {
		parse: (text) => {
			const trimmed = text.trim();
			const number = Number(trimmed);
			return /^\d+$/.test(trimmed) && number >= min && number <= max
				? { ok: true, value: number }
				: { ok: false };
		},
		format: String,
	});
	const commit = () => {
		const change = field.changed();
		if (change) onCommit(change.value);
	};
	return (
		<div className="flex flex-col items-end gap-1">
			<Input
				type="number"
				min={min}
				max={max}
				step={1}
				className="h-[30px] w-16 text-center text-[13px] tabular-nums"
				aria-invalid={!field.valid || undefined}
				disabled={disabled}
				value={field.text}
				{...rowLabels(id)}
				onChange={(event) => field.setText(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
			/>
			{field.valid ? null : (
				<p role="alert" className="text-xs text-destructive">
					{FACTORY_SETTINGS.models.numberInvalid(min, max)}
				</p>
			)}
		</div>
	);
}

export function FactorySettingsModels({
	headingId,
	workflow,
}: {
	headingId: string;
	workflow: DefaultWorkflow;
}) {
	const { config, commit, errorFor } = workflow;
	const M = FACTORY_SETTINGS.models;
	const disabled = workflow.presets.loading;
	const agents: Agents = config.agents ?? DEFAULT_FACTORY_AGENTS;
	const setAgents = (next: Agents, row: string) =>
		commit({ ...config, agents: next }, row);
	const coverage = factoryReviewCoverage(agents);
	const warnings = [
		...(coverage.independent ? [] : [FACTORY_REVIEW_SAFETY.sameModelWarning]),
		...(coverage.noPlanCheckOrTest
			? [FACTORY_REVIEW_SAFETY.noChecksWarning]
			: []),
	];
	const listRow = (role: ListRole) => {
		const copy = M.roles[role];
		const name = copy.name.toLowerCase();
		const list = agents[role];
		// After the last picker, so each agent keeps one line.
		const add =
			list.length < MAX_PER_ROLE ? (
				<Button
					variant="outline"
					size="xs"
					className="size-[30px] px-0"
					aria-label={M.add(name)}
					title={M.add(name)}
					disabled={disabled}
					onClick={() => setAgents({ ...agents, [role]: [...list, {}] }, role)}
				>
					<Plus aria-hidden className="size-3.5" />
				</Button>
			) : (
				// Keeps the pickers aligned when Add is hidden.
				<span aria-hidden className="size-[30px]" />
			);
		return (
			<SettingRow
				key={role}
				id={role}
				title={copy.title}
				description={copy.hint}
				extra={
					role === "reviewers"
						? warnings.map((warning) => (
								<p
									key={warning}
									className={cn(
										"mt-1 flex max-w-[470px] items-start gap-1.5 text-xs",
										toneText("attention"),
									)}
								>
									<AlertTriangle
										aria-hidden
										className="mt-0.5 size-3 shrink-0"
									/>
									<span>{warning}</span>
								</p>
							))
						: null
				}
				error={errorFor(role)}
				top={list.length > 1 || (role === "reviewers" && warnings.length > 0)}
				wrap
			>
				<div className="flex flex-col items-end gap-1.5 @max-[560px]/settings:items-start">
					{list.map((agent, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: agents have no id; a role's list is its order.
							key={index}
							className="flex items-center gap-1.5"
						>
							<span className="flex min-w-0 items-center rounded-md border pr-0.5">
								<ModelPicker
									label={M.modelLabel(copy.name, index + 1)}
									agent={agent}
									disabled={disabled}
									onChange={(next) =>
										setAgents(
											{
												...agents,
												[role]: list.map((item, i) =>
													i === index ? next : item,
												),
											},
											role,
										)
									}
								/>
								{list.length > MIN_PER_ROLE[role] ? (
									<Button
										variant="ghost"
										size="xs"
										className="size-6 px-0 text-muted-foreground"
										aria-label={M.remove(name, index + 1)}
										disabled={disabled}
										onClick={() =>
											setAgents(
												{
													...agents,
													[role]: list.filter((_, i) => i !== index),
												},
												role,
											)
										}
									>
										<X aria-hidden className="size-3" />
									</Button>
								) : null}
							</span>
							{index === list.length - 1 ? (
								add
							) : (
								<span aria-hidden className="size-[30px]" />
							)}
						</div>
					))}
					{list.length === 0 ? add : null}
				</div>
			</SettingRow>
		);
	};
	return (
		<>
			<SectionTitle
				id={headingId}
				title={FACTORY_SETTINGS.sections.models}
				scope={M.scope}
				workflow={workflow}
			/>
			<GroupHeading>{M.rolesGroup}</GroupHeading>
			<SettingRow
				id="designer"
				title={M.roles.designer.title}
				description={M.roles.designer.hint}
				error={errorFor("designer")}
				wrap
			>
				<span className="flex min-w-0 items-center rounded-md border">
					<ModelPicker
						label={M.modelLabel(M.roles.designer.name)}
						agent={agents.designer}
						disabled={disabled}
						onChange={(designer) =>
							setAgents({ ...agents, designer }, "designer")
						}
					/>
				</span>
			</SettingRow>
			{listRow("planReviewers")}
			{listRow("implementers")}
			<SettingRow
				id="verifier"
				title={M.roles.verifier.title}
				description={M.roles.verifier.hint}
				error={errorFor("verifier")}
				wrap
			>
				{agents.verifier ? (
					<span className="flex min-w-0 items-center rounded-md border">
						<ModelPicker
							label={M.modelLabel(M.roles.verifier.name)}
							agent={agents.verifier}
							disabled={disabled}
							onChange={(verifier) =>
								setAgents(
									{ ...agents, verifier: { ...agents.verifier, ...verifier } },
									"verifier",
								)
							}
						/>
					</span>
				) : null}
				<Switch
					checked={Boolean(agents.verifier)}
					disabled={disabled}
					{...rowLabels("verifier")}
					onCheckedChange={(checked) => {
						const { verifier: _previous, ...rest } = agents;
						setAgents(checked ? { ...rest, verifier: {} } : rest, "verifier");
					}}
				/>
			</SettingRow>
			{listRow("reviewers")}
			<GroupHeading>{M.reviewGroup}</GroupHeading>
			<SettingRow
				id="requireIndependentReview"
				title={M.requireIndependent}
				description={M.requireIndependentHint}
				error={errorFor("requireIndependentReview")}
			>
				<Switch
					checked={factoryRequiresIndependentReview(config)}
					disabled={disabled}
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
				title={M.codeReview}
				description={M.codeReviewHint[factoryReviewMode(config)]}
				error={errorFor("reviewMode")}
			>
				<SettingSelect<"adaptive" | "fixed">
					id="reviewMode"
					value={factoryReviewMode(config)}
					disabled={disabled}
					options={(["adaptive", "fixed"] as const).map((value) => ({
						value,
						label: M.codeReviewOptions[value],
					}))}
					onChange={(reviewMode) =>
						commit({ ...config, reviewMode }, "reviewMode")
					}
				/>
			</SettingRow>
			<details className="group/advanced border-b" data-setting="advanced">
				<summary className="flex cursor-pointer list-none items-center gap-1.5 py-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
					<ChevronRight
						aria-hidden
						className="size-3.5 text-muted-foreground transition-transform group-open/advanced:rotate-90"
					/>
					{M.advanced}
					<span className="ml-1 text-xs font-normal text-muted-foreground">
						{M.advancedSummary}
					</span>
				</summary>
				<AdvancedRows workflow={workflow} agents={agents} />
			</details>
		</>
	);
}

/**
 * Fix rounds, retries, each role's own fields (without the model, which is
 * the row above) and the workflow file. Text fields save when focus leaves.
 */
function AdvancedRows({
	workflow,
	agents,
}: {
	workflow: DefaultWorkflow;
	agents: Agents;
}) {
	const { config, commit, edit, flush, errorFor } = workflow;
	const M = FACTORY_SETTINGS.models;
	const disabled = workflow.presets.loading;
	const editAgents = (next: Agents) => edit({ ...config, agents: next });
	const roles: {
		key: string;
		label: string;
		agent: FactoryAgent;
		set: (agent: FactoryAgent) => Agents;
	}[] = [
		{
			key: "designer",
			label: M.roles.designer.name,
			agent: agents.designer,
			set: (designer) => ({ ...agents, designer }),
		},
		...(["planReviewers", "implementers", "reviewers"] as const).flatMap(
			(role) =>
				agents[role].map((agent, index) => ({
					key: `${role}-${index}`,
					label: `${M.roles[role].name} ${index + 1}`,
					agent,
					set: (next: FactoryAgent) => ({
						...agents,
						[role]: agents[role].map((item, i) => (i === index ? next : item)),
					}),
				})),
		),
	];
	return (
		<div className="border-t">
			<SettingRow
				id="maxRepairRounds"
				title={M.repairRounds}
				description={M.repairRoundsHint}
				error={errorFor("maxRepairRounds")}
			>
				<NumberInput
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
				title={M.retries}
				description={M.retriesHint}
				error={errorFor("maxRuntimeRetries")}
			>
				<NumberInput
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
			<fieldset
				aria-labelledby="roleDetails-title"
				className="space-y-2 border-b py-3"
				data-setting="roleDetails"
				onBlur={() => flush("roleDetails")}
			>
				<p id="roleDetails-title" className="text-sm font-medium">
					{M.roleDetails}
				</p>
				<p className="text-xs text-muted-foreground">{M.roleDetailsHint}</p>
				{roles.map((role) => (
					<AgentEditor
						key={role.key}
						label={role.label}
						agent={role.agent}
						disabled={disabled}
						showModel={false}
						onChange={(next) => editAgents(role.set(next))}
					/>
				))}
				{agents.verifier ? (
					<div className="space-y-2">
						<AgentEditor
							label={M.roles.verifier.name}
							agent={agents.verifier}
							disabled={disabled}
							showModel={false}
							onChange={(verifier) =>
								editAgents({
									...agents,
									verifier: { ...agents.verifier, ...verifier },
								})
							}
						/>
						<Input
							aria-label={M.testerEvidence}
							placeholder="Evidence paths, separated by commas"
							value={agents.verifier.artifacts?.join(", ") ?? ""}
							disabled={disabled}
							onChange={(event) =>
								editAgents({
									...agents,
									verifier: {
										...agents.verifier,
										artifacts: event.target.value
											.split(",")
											.map((path) => path.trim())
											.filter(Boolean),
									},
								})
							}
						/>
						<AppEnvironmentEditor
							environment={agents.verifier.environment}
							disabled={disabled}
							onChange={(environment) => {
								const { environment: _previous, ...verifier } =
									agents.verifier ?? {};
								editAgents({
									...agents,
									verifier: environment
										? { ...verifier, environment }
										: verifier,
								});
							}}
						/>
					</div>
				) : null}
				{errorFor("roleDetails") ? (
					<p role="alert" className="text-xs text-destructive">
						{errorFor("roleDetails")}
					</p>
				) : null}
			</fieldset>
			<WorkflowFile workflow={workflow} />
		</div>
	);
}

/**
 * The workflow file: use another saved workflow for new work, save this one
 * under a name, or copy and import JSON. Each choice saves at once.
 */
function WorkflowFile({ workflow }: { workflow: DefaultWorkflow }) {
	const M = FACTORY_SETTINGS.models;
	const { presets, setPresets, setDefaultPreset } = workflow.presets;
	const disabled = workflow.presets.loading;
	const [name, setName] = useState("");
	const [importText, setImportText] = useState("");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const current = presets.find((preset) => preset.name === workflow.name);
	const save = (
		args: { name: string; config: unknown; revision?: string },
		asDefault: boolean,
		done: (items: FactoryPreset[]) => string,
	) => {
		setBusy(true);
		setError("");
		setNotice("");
		void Promise.resolve()
			.then(() =>
				desktopClient.invoke<FactoryPreset[]>("factory_save_preset", {
					...args,
					...(asDefault ? { useByDefault: true } : {}),
				}),
			)
			.then((items) => {
				setPresets(items);
				if (asDefault) setDefaultPreset(args.name.trim());
				setNotice(done(items));
			})
			.catch((cause: unknown) =>
				setError(
					cause instanceof Error ? cause.message : FACTORY_SETTINGS.saveFailed,
				),
			)
			.finally(() => setBusy(false));
	};
	const importRecipe = () => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(importText);
		} catch {
			setError("Workflow import must be valid JSON. Check the pasted text.");
			return;
		}
		const result = factoryWorkflowRecipeSchema.safeParse(parsed);
		if (!result.success) {
			const issue = result.error.issues[0];
			setError(
				FACTORY_WORKFLOW.notVersion1(
					`${issue?.path.join(".") || "workflow"} ${issue?.message ?? ""}`,
				),
			);
			return;
		}
		const recipe = result.data;
		if (
			presets.some(
				(preset) =>
					preset.name === recipe.name && preset.revision !== recipe.revision,
			)
		) {
			setError(FACTORY_WORKFLOW.nameTaken(recipe.name));
			return;
		}
		save(
			{ name: recipe.name, revision: recipe.revision, config: recipe.config },
			false,
			() => {
				setImportText("");
				return `Imported “${recipe.name}”.`;
			},
		);
	};
	return (
		<div className="space-y-2 py-3" data-setting="workflowFile">
			<p className="text-sm font-medium">{M.workflowFile}</p>
			<p className="text-xs text-muted-foreground">{M.workflowFileHint}</p>
			<div className="flex flex-wrap items-center gap-2">
				<select
					aria-label={FACTORY_WORKFLOW.apply}
					className="h-8 rounded-md border bg-background px-2 text-sm"
					value=""
					disabled={disabled || busy}
					onChange={(event) => {
						const preset = presets.find(
							(item) => item.name === event.target.value,
						);
						if (preset)
							save({ name: preset.name, config: preset.config }, true, () =>
								FACTORY_WORKFLOW.matches(preset.name),
							);
					}}
				>
					<option value="">{FACTORY_WORKFLOW.applyPlaceholder}</option>
					{presets
						.filter((preset) => preset.name !== workflow.name)
						.map((preset) => (
							<option key={preset.name} value={preset.name}>
								{preset.name}
							</option>
						))}
				</select>
				<Input
					aria-label={FACTORY_WORKFLOW.name}
					placeholder={FACTORY_WORKFLOW.name}
					className="h-8 w-44"
					value={name}
					disabled={disabled || busy}
					onChange={(event) => setName(event.target.value)}
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={disabled || busy || !name.trim()}
					onClick={() =>
						save(
							{
								name: name.trim(),
								config: factoryWorkflowConfigSchema.parse(workflow.config),
							},
							true,
							() => {
								setName("");
								return FACTORY_WORKFLOW.matches(name.trim());
							},
						)
					}
				>
					{FACTORY_WORKFLOW.save}
				</Button>
			</div>
			<details className="text-xs">
				<summary className="cursor-pointer text-sm">
					{FACTORY_WORKFLOW.importExport}
				</summary>
				<div className="mt-2 space-y-2">
					<p className="text-muted-foreground">
						{FACTORY_WORKFLOW.jsonExplainer}
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={!current?.revision}
						onClick={() => {
							setError("");
							setNotice("");
							void Promise.resolve()
								.then(() =>
									navigator.clipboard.writeText(
										`${JSON.stringify(
											{
												schemaVersion: 1,
												name: current?.name,
												revision: current?.revision,
												config: current?.config,
											},
											null,
											2,
										)}\n`,
									),
								)
								.then(() => setNotice(`Copied “${current?.name}”.`))
								.catch(() => setError(FACTORY_WORKFLOW.copyFailed));
						}}
					>
						{FACTORY_WORKFLOW.copyJson}
					</Button>
					<Textarea
						aria-label={FACTORY_WORKFLOW.jsonField}
						placeholder={FACTORY_WORKFLOW.jsonPlaceholder}
						rows={4}
						value={importText}
						disabled={disabled || busy}
						onChange={(event) => setImportText(event.target.value)}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={disabled || busy || !importText.trim()}
						onClick={importRecipe}
					>
						{FACTORY_WORKFLOW.importJson}
					</Button>
				</div>
			</details>
			{notice ? (
				<output className="block text-xs text-muted-foreground">
					{notice}
				</output>
			) : null}
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}
