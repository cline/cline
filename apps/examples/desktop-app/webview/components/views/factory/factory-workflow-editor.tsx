"use client";

import {
	DEFAULT_FACTORY_AGENT_TIMEOUT_SECONDS,
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryAppEnvironment,
	type FactoryTaskConfig,
	type FactoryWorkflowRecipe,
	factoryAppEnvironmentSchema,
	factoryWorkflowConfigSchema,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import { Switch } from "@cline/ui";
import { AlertTriangle } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { desktopClient } from "@/lib/desktop-client";
import {
	FACTORY_REVIEW_POLICY,
	FACTORY_REVIEW_SAFETY,
	FACTORY_ROLE_LABEL,
	FACTORY_SETTING_LABEL,
	FACTORY_SPENDING,
	FACTORY_TERMS,
	FACTORY_VERIFICATION_SETUP,
	FACTORY_WORKFLOW,
	factoryModelLabel,
	factoryRoleCount,
} from "@/lib/factory-copy";
import {
	FACTORY_CARD_COST_MAX_USD,
	type FactoryAgentModel,
	type FactoryReviewSafetyConfig,
	factoryIndependentReviewSupported,
	factoryModelList,
	factoryRequiresIndependentReview,
	factoryReviewCoverage,
	withRequireIndependentReview,
} from "@/lib/factory-limits";
import {
	type FactoryPreset,
	factoryPresetMatches,
	factoryPresetTaskConfig,
} from "@/lib/factory-presets";
import { cn } from "@/lib/utils";
import { ModelSelector } from "../chat/chat-input-bar";
import { FactorySpendingField } from "./factory-concurrency";
import { toneText } from "./factory-ui";

const noop = () => {};
// Sentence case, like every other heading in the app.
const groupHeading =
	"border-t pt-4 text-sm font-medium text-foreground first:border-t-0 first:pt-0";
/**
 * Turns hands-off on or off. A hands-off run ends in a draft PR, so turning it
 * on also publishes; keeping the PR passing follows `watchPullRequest`, unset
 * meaning on for hands-off (`factoryWatchesPullRequest`). Turning it off
 * leaves the card's PR settings alone.
 */
export function withHandsOff(
	config: FactoryTaskConfig,
	handsOff: boolean,
): FactoryTaskConfig {
	const { autonomy: _autonomy, ...manual } = config;
	return handsOff
		? { ...config, autonomy: "hands_off", publishPullRequest: true }
		: manual;
}
function applyPreset(
	config: FactoryTaskConfig,
	preset: FactoryPreset,
): FactoryTaskConfig {
	const { autonomy: _autonomy, ...copied } = factoryPresetTaskConfig(preset);
	return withHandsOff(
		withRequireIndependentReview(
			{
				...config,
				...copied,
				agents: copied.agents,
				reviewMode: copied.reviewMode,
				maxCostUsd: copied.maxCostUsd,
				maxRuntimeRetries: copied.maxRuntimeRetries,
				humanStamp: copied.humanStamp,
			},
			(copied as FactoryReviewSafetyConfig).requireIndependentReview,
		),
		isFactoryHandsOff(preset.config),
	);
}
const ROLE_COPY = {
	planReviewers: {
		label: FACTORY_ROLE_LABEL.planReviewer,
		role: "planReviewer",
	},
	implementers: { label: FACTORY_ROLE_LABEL.implementer, role: "implementer" },
	reviewers: { label: FACTORY_ROLE_LABEL.reviewer, role: "reviewer" },
} as const;

/**
 * A card's agents with every role list present: a stored `agents` block
 * that lacks one (older or partial data) reads as no agents in that role
 * rather than failing to render.
 */
export function factoryWorkflowAgents(
	agents: FactoryTaskConfig["agents"],
): NonNullable<FactoryTaskConfig["agents"]> {
	if (!agents) return DEFAULT_FACTORY_AGENTS;
	return {
		...agents,
		planReviewers: agents.planReviewers ?? [],
		implementers: agents.implementers ?? [],
		reviewers: agents.reviewers ?? [],
	};
}

/** "Workflow · 1 builder · 2 plan checkers · 1 code reviewer · agent testing". */
export function factoryWorkflowSummary(
	agents: NonNullable<FactoryTaskConfig["agents"]>,
): string {
	return [
		"Workflow",
		factoryRoleCount("implementer", agents.implementers.length),
		factoryRoleCount("planReviewer", agents.planReviewers.length),
		factoryRoleCount("reviewer", agents.reviewers.length),
		agents.verifier ? FACTORY_TERMS.agentTesting.toLowerCase() : "",
	]
		.filter(Boolean)
		.join(" · ");
}

export function FactoryWorkflowEditor({
	config,
	disabled,
	onChange,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	onChange: (config: FactoryTaskConfig) => void;
}) {
	const agents = factoryWorkflowAgents(config.agents);
	const id = useId();
	const advancedRef = useRef<HTMLDetailsElement>(null);
	const participantsRef = useRef<HTMLHeadingElement>(null);
	const {
		presets,
		setPresets,
		defaultPreset,
		setDefaultPreset,
		loading,
		error: loadError,
		reload,
	} = useFactoryPresets();
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const [useByDefault, setUseByDefault] = useState(false);
	const [notice, setNotice] = useState("");
	const savedPreset = presets.find(
		(preset) => preset.name === (name.trim() || config.workflow?.name),
	);
	const savedRecipe: FactoryWorkflowRecipe | undefined = savedPreset?.revision
		? {
				schemaVersion: 1,
				name: savedPreset.name,
				revision: savedPreset.revision,
				config: savedPreset.config,
			}
		: undefined;
	const savePreset = (
		presetName: string,
		asDefault: boolean,
		presetConfig: unknown = config,
	) => {
		setSaving(true);
		setError("");
		setNotice("");
		void Promise.resolve()
			.then(() =>
				desktopClient.invoke<FactoryPreset[]>("factory_save_preset", {
					name: presetName,
					config: factoryWorkflowConfigSchema.parse(presetConfig),
					useByDefault: asDefault,
				}),
			)
			.then((items) => {
				setPresets(items);
				if (asDefault) setDefaultPreset(presetName.trim());
				else if (defaultPreset === presetName.trim())
					setDefaultPreset(undefined);
			})
			.catch((cause: unknown) =>
				setError(
					cause instanceof Error ? cause.message : "Couldn't save. Try again.",
				),
			)
			.finally(() => setSaving(false));
	};
	const openRoles = () => {
		if (advancedRef.current) advancedRef.current.open = true;
		participantsRef.current?.scrollIntoView?.({ block: "start" });
	};
	const everyday = (
		<div className="space-y-4">
			{/* The approval pause applies with or without hands-off (core
			    approves automatically whenever approval is "automatic"), so it
			    stays enabled; it sits under hands-off as its refinement, and
			    one line says what the two do together. */}
			<div className="space-y-3">
				<SettingSwitch
					label={FACTORY_SETTING_LABEL.handsOff}
					hint={FACTORY_SETTING_LABEL.handsOffHint}
					checked={isFactoryHandsOff(config)}
					disabled={disabled}
					onCheckedChange={(checked) => onChange(withHandsOff(config, checked))}
				/>
				<div className="ml-1 border-l-2 pl-4" data-factory-setting="approval">
					<SettingSwitch
						label={FACTORY_SETTING_LABEL.pauseForApproval}
						hint={
							config.approval === "required"
								? FACTORY_SETTING_LABEL.pauseForApprovalHint.on
								: FACTORY_SETTING_LABEL.pauseForApprovalHint.off
						}
						checked={config.approval === "required"}
						disabled={disabled}
						onCheckedChange={(checked) =>
							onChange({
								...config,
								approval: checked ? "required" : "automatic",
							})
						}
					/>
				</div>
				<output
					className="block text-xs text-muted-foreground"
					data-testid="factory-setting-flow"
				>
					{FACTORY_SETTING_LABEL.flow(
						isFactoryHandsOff(config),
						config.approval === "required",
					)}
				</output>
			</div>
			<ReviewPolicyControl
				config={config}
				disabled={disabled}
				onChange={onChange}
			/>
			<section aria-label={FACTORY_SPENDING.heading} className="space-y-3">
				<h4 className={groupHeading}>{FACTORY_SPENDING.heading}</h4>
				<FactorySpendingField
					before={FACTORY_SPENDING.cardLimitBefore}
					hint={FACTORY_SPENDING.cardLimitHint}
					invalidMessage={FACTORY_SPENDING.cardLimitInvalid(
						FACTORY_CARD_COST_MAX_USD,
					)}
					value={config.maxCostUsd}
					min={0.01}
					max={FACTORY_CARD_COST_MAX_USD}
					disabled={disabled}
					showNoLimit
					onApply={(value) =>
						onChange({ ...config, maxCostUsd: value ?? undefined })
					}
				/>
			</section>
			<ReviewSafetySummary
				config={config}
				disabled={disabled}
				onChange={onChange}
				onEditRoles={openRoles}
			/>
		</div>
	);
	const advanced = (
		<details ref={advancedRef} className="group rounded-lg border">
			<summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">
				{FACTORY_SETTING_LABEL.advanced}
				<span className="ml-2 text-xs font-normal text-muted-foreground">
					{FACTORY_SETTING_LABEL.advancedSummary}
				</span>
			</summary>
			<div className="space-y-4 border-t px-4 py-4">
				<h4 className={groupHeading}>{FACTORY_WORKFLOW.heading}</h4>
				<div className="flex flex-wrap gap-2">
					<select
						aria-label={FACTORY_WORKFLOW.apply}
						className="h-9 rounded-md border bg-background px-3 text-sm"
						value=""
						disabled={disabled || loading || saving}
						onChange={(event) => {
							const preset = presets.find(
								(item) => item.name === event.target.value,
							);
							if (preset) {
								onChange(applyPreset(config, preset));
								setName(preset.name);
								setError("");
								setNotice("");
								setUseByDefault(preset.name === defaultPreset);
							}
						}}
					>
						<option value="">{FACTORY_WORKFLOW.applyPlaceholder}</option>
						{presets.map((preset) => (
							<option key={preset.name} value={preset.name}>
								{preset.name}
								{preset.name === defaultPreset ? " (default)" : ""}
							</option>
						))}
					</select>
					<Input
						aria-label={FACTORY_WORKFLOW.name}
						placeholder={FACTORY_WORKFLOW.name}
						className="w-44"
						value={name}
						disabled={disabled || saving || loading}
						onChange={(event) => {
							setName(event.target.value);
							setUseByDefault(event.target.value.trim() === defaultPreset);
						}}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={disabled || saving || loading || !name.trim()}
						onClick={() => savePreset(name, useByDefault)}
					>
						{FACTORY_WORKFLOW.save}
					</Button>
				</div>
				<label
					htmlFor={`${id}-use-by-default`}
					className="flex items-center gap-2 text-sm"
				>
					<Switch
						id={`${id}-use-by-default`}
						checked={useByDefault}
						disabled={disabled || loading || saving}
						onCheckedChange={setUseByDefault}
					/>
					{FACTORY_WORKFLOW.useByDefault}
				</label>
				{savedRecipe ? (
					<output className="block text-xs text-muted-foreground">
						{factoryPresetMatches(savedRecipe, config)
							? FACTORY_WORKFLOW.matches(savedRecipe.name)
							: FACTORY_WORKFLOW.changed(savedRecipe.name)}
					</output>
				) : null}
				<p className="text-xs text-muted-foreground">
					{FACTORY_WORKFLOW.explainer}
				</p>
				{agents.planReviewers.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						After editing this brief, scoping and the plan check run again
						before approval.
					</p>
				) : null}
				{notice ? (
					<output className="block text-xs text-success-text">{notice}</output>
				) : null}
				<h4 className={groupHeading}>Review and retries</h4>
				<div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
					<label htmlFor={`${id}-review-mode`} className="space-y-1 text-xs">
						<span>Code review</span>
						<select
							id={`${id}-review-mode`}
							className="h-9 w-full rounded-md border bg-background px-3 text-sm"
							value={config.reviewMode ?? "fixed"}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									reviewMode:
										event.target.value === "adaptive" ? "adaptive" : "fixed",
								})
							}
						>
							<option value="adaptive">
								Choose reviewers for each request
							</option>
							<option value="fixed">Run every code reviewer</option>
						</select>
					</label>
					<label htmlFor={`${id}-repairs`} className="space-y-1 text-xs">
						<span>Rounds of fixes after review</span>
						<Input
							id={`${id}-repairs`}
							type="number"
							min={0}
							max={10}
							value={config.maxRepairRounds}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									maxRepairRounds: Math.max(
										0,
										Math.min(10, Number(event.target.value)),
									),
								})
							}
						/>
					</label>
					<label htmlFor={`${id}-retries`} className="space-y-1 text-xs">
						<span>Retries per stage</span>
						<Input
							id={`${id}-retries`}
							type="number"
							min={0}
							max={5}
							value={config.maxRuntimeRetries ?? 2}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									maxRuntimeRetries: Number(event.target.value),
								})
							}
						/>
						<span className="block text-muted-foreground">
							After a failed session or unusable output.
						</span>
					</label>
				</div>
				<h4 ref={participantsRef} className={groupHeading}>
					Participants
				</h4>
				<AgentEditor
					label={FACTORY_ROLE_LABEL.designer}
					agent={agents.designer}
					disabled={disabled}
					onChange={(designer) =>
						onChange({ ...config, agents: { ...agents, designer } })
					}
				/>
				{(["planReviewers", "implementers", "reviewers"] as const).map(
					(role) => (
						<div key={role} className="space-y-2">
							{agents[role].map((agent, index) => (
								<div key={index} className="flex items-start gap-2">
									<div className="min-w-0 flex-1">
										<AgentEditor
											label={`${ROLE_COPY[role].label} ${index + 1}`}
											agent={agent}
											disabled={disabled}
											onChange={(next) =>
												onChange({
													...config,
													agents: {
														...agents,
														[role]: agents[role].map((item, i) =>
															i === index ? next : item,
														),
													},
												})
											}
										/>
									</div>
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Remove ${ROLE_COPY[role].label.toLowerCase()} ${index + 1}`}
										disabled={
											disabled ||
											(role !== "planReviewers" && agents[role].length === 1)
										}
										onClick={() =>
											onChange({
												...config,
												agents: {
													...agents,
													[role]: agents[role].filter((_, i) => i !== index),
												},
											})
										}
									>
										Remove
									</Button>
								</div>
							))}
							<Button
								variant="outline"
								size="sm"
								disabled={disabled || agents[role].length >= 4}
								onClick={() =>
									onChange({
										...config,
										agents: { ...agents, [role]: [...agents[role], {}] },
									})
								}
							>
								Add {ROLE_COPY[role].label.toLowerCase()}
							</Button>
						</div>
					),
				)}
				<p className="text-xs text-muted-foreground">
					Independent parts rotate through builders in order. The first builder
					handles a single build and fixes.
				</p>
				<label
					htmlFor={`${id}-agent-testing`}
					className="flex items-center gap-2 text-sm"
				>
					<Switch
						id={`${id}-agent-testing`}
						checked={!!agents.verifier}
						disabled={disabled}
						onCheckedChange={(checked) =>
							onChange({
								...config,
								agents: {
									...agents,
									verifier: checked ? {} : undefined,
								},
							})
						}
					/>
					{FACTORY_TERMS.agentTesting}
				</label>
				{agents.verifier ? (
					<>
						<p className="text-xs text-muted-foreground">
							Only the tester sees these instructions, after building. Describe
							what to check; with no app environment below, also how to set up,
							start and clean up the app.
						</p>
						<AgentEditor
							label={FACTORY_ROLE_LABEL.verifier}
							agent={agents.verifier}
							disabled={disabled}
							instructionsPlaceholder={
								"Setup: bun install\nStart: bun run dev, open http://localhost:3000\nReady when: the home page renders\nCleanup: stop the dev server, even after failures"
							}
							onChange={(verifier) =>
								onChange({
									...config,
									agents: {
										...agents,
										verifier: { ...agents.verifier, ...verifier },
									},
								})
							}
						/>
						<Input
							aria-label="Tester evidence paths"
							placeholder="Evidence paths, separated by commas"
							value={agents.verifier.artifacts?.join(", ") ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									agents: {
										...agents,
										verifier: {
											...agents.verifier,
											artifacts: event.target.value
												.split(",")
												.map((path) => path.trim())
												.filter(Boolean),
										},
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
								onChange({
									...config,
									agents: {
										...agents,
										verifier: environment
											? { ...verifier, environment }
											: verifier,
									},
								});
							}}
						/>
					</>
				) : null}
			</div>
		</details>
	);
	const status =
		error || loadError ? (
			<p role="alert" className="text-xs text-destructive">
				{error || loadError}
				<Button
					variant="ghost"
					size="sm"
					disabled={loading || saving}
					onClick={() => {
						setError("");
						reload();
					}}
				>
					Reload settings
				</Button>
			</p>
		) : null;
	return (
		<details className="rounded-lg border">
			<summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold">
				{factoryWorkflowSummary(agents)}
			</summary>
			<fieldset className="space-y-4 border-t px-5 py-5">
				{status}
				{everyday}
				{advanced}
			</fieldset>
		</details>
	);
}

/**
 * When a delivered PR waits for the user's review (the workflow's
 * `humanStamp`). Unset reads as "only on risky changes" for hands-off work
 * and "on every change" otherwise, as core decides it.
 */
function ReviewPolicyControl({
	config,
	disabled,
	onChange,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	onChange: (config: FactoryTaskConfig) => void;
}) {
	const name = useId();
	const current =
		config.humanStamp ?? (isFactoryHandsOff(config) ? "by_risk" : "always");
	return (
		<fieldset className="space-y-2 text-sm">
			<legend className="mb-1">{FACTORY_REVIEW_POLICY.label}</legend>
			{FACTORY_REVIEW_POLICY.options.map((option) => (
				<label
					key={option.value}
					htmlFor={`${name}-${option.value}`}
					className="flex items-start gap-2"
				>
					<input
						id={`${name}-${option.value}`}
						type="radio"
						name={name}
						className="mt-1"
						value={option.value}
						checked={current === option.value}
						disabled={disabled}
						onChange={() => onChange({ ...config, humanStamp: option.value })}
					/>
					<span className="min-w-0 flex-1">
						{option.label}
						<span className="mt-0.5 block text-xs text-muted-foreground">
							{option.hint}
						</span>
					</span>
				</label>
			))}
		</fieldset>
	);
}

/**
 * "Who checks the work": the models that plan, build, test and review in this
 * workflow, a warning when nothing independent checks the builder's work, and
 * the review requirement for automatic approval (`requireIndependentReview`).
 */
function ReviewSafetySummary({
	config,
	disabled,
	onChange,
	onEditRoles,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	onChange: (config: FactoryTaskConfig) => void;
	onEditRoles: () => void;
}) {
	const coverage = factoryReviewCoverage(
		config.agents ?? DEFAULT_FACTORY_AGENTS,
	);
	const supported = factoryIndependentReviewSupported();
	const builders = new Set(coverage.builds.map((model) => model.key));
	const line = (models: FactoryAgentModel[]) =>
		models.length === 0
			? FACTORY_REVIEW_SAFETY.nobody
			: `${factoryModelList(models)}${models.every((model) => builders.has(model.key)) ? ` (${FACTORY_REVIEW_SAFETY.sameModel})` : ""}`;
	const warnings: string[] = [
		...(coverage.independent ? [] : [FACTORY_REVIEW_SAFETY.sameModelWarning]),
		...(coverage.noPlanCheckOrTest
			? [FACTORY_REVIEW_SAFETY.noChecksWarning]
			: []),
	];
	return (
		<section aria-label={FACTORY_REVIEW_SAFETY.heading} className="space-y-3">
			<div className="flex items-center justify-between gap-3 border-t pt-4">
				<h4 className="text-sm font-medium text-foreground">
					{FACTORY_REVIEW_SAFETY.heading}
				</h4>
				{/* accent-11: link-coloured text that keeps 4.5:1 in both themes,
				    where the solid primary falls to about 3.4:1 on dark. */}
				<Button
					variant="link"
					size="sm"
					className="h-auto p-0 text-xs text-accent-foreground"
					onClick={onEditRoles}
				>
					{FACTORY_REVIEW_SAFETY.editRoles}
				</Button>
			</div>
			<ul className="space-y-0.5 text-sm">
				<li>
					{FACTORY_REVIEW_SAFETY.plans}: {factoryModelList(coverage.plans)}
				</li>
				<li>
					{FACTORY_REVIEW_SAFETY.checksPlan}: {line(coverage.planChecks)}
				</li>
				<li>
					{FACTORY_REVIEW_SAFETY.builds}: {factoryModelList(coverage.builds)}
				</li>
				<li>
					{FACTORY_REVIEW_SAFETY.tests}:{" "}
					{coverage.tests.length
						? factoryModelList(coverage.tests)
						: FACTORY_REVIEW_SAFETY.nobody}
				</li>
				<li>
					{FACTORY_REVIEW_SAFETY.reviews}: {line(coverage.reviews)}
				</li>
			</ul>
			{warnings.map((warning) => (
				<p
					key={warning}
					className={cn(
						"flex items-start gap-2 text-xs",
						toneText("attention"),
					)}
				>
					<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
					<span>{warning}</span>
				</p>
			))}
			<SettingSwitch
				label={FACTORY_REVIEW_SAFETY.requireIndependent}
				hint={
					supported
						? FACTORY_REVIEW_SAFETY.requireIndependentHint
						: FACTORY_REVIEW_SAFETY.unsupported
				}
				checked={factoryRequiresIndependentReview(config)}
				disabled={disabled || !supported}
				onCheckedChange={(checked) =>
					onChange(withRequireIndependentReview(config, checked))
				}
			/>
		</section>
	);
}

function SettingSwitch({
	label,
	hint,
	checked,
	disabled,
	onCheckedChange,
}: {
	label: string;
	hint: string;
	checked: boolean;
	disabled: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<label
			htmlFor={id}
			className="flex items-start justify-between gap-5 text-sm"
		>
			<span className="min-w-0 flex-1">
				{label}
				<span className="mt-0.5 block text-xs text-muted-foreground">
					{hint}
				</span>
			</span>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</label>
	);
}

const appEnvironmentFields = [
	["setup", "Setup command", "bun install"],
	["start", "Start command", "bun run dev --port $FACTORY_APP_PORT"],
	["healthcheck", "Healthcheck command", "curl -fsS $FACTORY_APP_URL"],
	["cleanup", "Cleanup command", "docker compose down"],
	["portEnv", "Port variable", "PORT"],
] as const;

export function AppEnvironmentEditor({
	environment,
	disabled,
	onChange,
}: {
	environment: FactoryAppEnvironment | undefined;
	disabled: boolean;
	onChange: (environment: FactoryAppEnvironment | undefined) => void;
}) {
	const id = useId();
	const update = (patch: Partial<FactoryAppEnvironment>) => {
		const next = Object.fromEntries(
			Object.entries({ ...environment, ...patch }).filter(
				([, value]) =>
					value !== undefined && !(typeof value === "string" && !value.trim()),
			),
		);
		onChange(
			Object.keys(next).length ? (next as FactoryAppEnvironment) : undefined,
		);
	};
	const issues = environment
		? (factoryAppEnvironmentSchema.safeParse(environment).error?.issues ?? [])
		: [];
	return (
		<fieldset className="space-y-2 rounded border p-3">
			<legend className="px-1 text-sm">
				App environment (Factory starts and stops it)
			</legend>
			<p className="text-xs font-medium">
				{FACTORY_VERIFICATION_SETUP.presetOverridesField}
			</p>
			<p className="text-xs text-muted-foreground">
				Each task gets its own free port in $FACTORY_APP_PORT and
				$FACTORY_APP_URL. Leave empty to use the repository's verification
				setup, or to describe setup in the verifier instructions instead.
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				{appEnvironmentFields.map(([field, label, placeholder]) => (
					<label
						key={field}
						htmlFor={`${id}-${field}`}
						className="space-y-1 text-xs"
					>
						<span>{label}</span>
						<Input
							id={`${id}-${field}`}
							aria-label={`App ${label.toLowerCase()}`}
							placeholder={placeholder}
							value={environment?.[field] ?? ""}
							disabled={disabled}
							onChange={(event) => update({ [field]: event.target.value })}
						/>
					</label>
				))}
				<label htmlFor={`${id}-ready`} className="space-y-1 text-xs">
					<span>Ready timeout (seconds)</span>
					<Input
						id={`${id}-ready`}
						aria-label="App ready timeout seconds"
						type="number"
						min={1}
						max={900}
						placeholder="120"
						value={environment?.readyTimeoutSeconds ?? ""}
						disabled={disabled}
						onChange={(event) =>
							update({
								readyTimeoutSeconds:
									event.target.value === ""
										? undefined
										: Number(event.target.value),
							})
						}
					/>
				</label>
			</div>
			{issues.length ? (
				<p className="text-xs text-destructive">
					{issues
						.map((issue) =>
							issue.path[0] === "portEnv"
								? "Port variable must be an environment variable name."
								: issue.message,
						)
						.join(" ")}
				</p>
			) : null}
		</fieldset>
	);
}

export function AgentEditor({
	label,
	agent,
	disabled,
	onChange,
	instructionsPlaceholder = "Additional instructions",
	showModel = true,
}: {
	label: string;
	agent: FactoryAgent;
	disabled: boolean;
	onChange: (agent: FactoryAgent) => void;
	instructionsPlaceholder?: string;
	/** Off where the model is picked in the row itself (Factory settings). */
	showModel?: boolean;
}) {
	const [chooseModel, setChooseModel] = useState(false);
	const id = useId();
	return (
		<details className="rounded-lg border bg-background px-3 py-2">
			<summary className="cursor-pointer select-none text-sm font-medium">
				{label}
				<span className="font-normal text-muted-foreground"> · </span>
				<span className="font-normal text-muted-foreground">
					{agent.modelSelection
						? factoryModelLabel(agent.modelSelection)
						: agent.profile
							? "Profile or default model"
							: "Default model"}
				</span>
			</summary>
			<div className="mt-3 space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					{showModel ? (
						<Button
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={() => setChooseModel(!chooseModel)}
						>
							Choose model
						</Button>
					) : null}
					{agent.modelSelection ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							onClick={() => onChange({ ...agent, modelSelection: undefined })}
						>
							{agent.profile
								? "Use profile or default model"
								: "Use default model"}
						</Button>
					) : null}
				</div>
				{showModel && chooseModel ? (
					<ModelSelector
						provider={agent.modelSelection?.providerId ?? ""}
						model={agent.modelSelection?.modelId ?? ""}
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
					/>
				) : null}
				<label htmlFor={`${id}-profile`} className="block space-y-1 text-xs">
					<span>Configured agent profile</span>
					<Input
						id={`${id}-profile`}
						aria-label={`${label} profile`}
						value={agent.profile ?? ""}
						disabled={disabled}
						placeholder="Name from .cline/agents"
						onChange={(event) =>
							onChange({
								...agent,
								profile: event.target.value || undefined,
								resolvedProfile: undefined,
							})
						}
					/>
				</label>
				<label htmlFor={`${id}-skills`} className="block space-y-1 text-xs">
					<span>Skills override</span>
					<Input
						id={`${id}-skills`}
						aria-label={`${label} skills`}
						value={agent.skills?.join(", ") ?? ""}
						disabled={disabled}
						placeholder="Comma-separated skill names"
						onChange={(event) =>
							onChange({
								...agent,
								skills: event.target.value.trim()
									? event.target.value
											.split(",")
											.map((name) => name.trim())
											.filter(Boolean)
									: undefined,
							})
						}
					/>
				</label>
				<Textarea
					aria-label={`${label} instructions`}
					placeholder={instructionsPlaceholder}
					value={agent.instructions ?? ""}
					disabled={disabled}
					rows={3}
					onChange={(event) =>
						onChange({ ...agent, instructions: event.target.value })
					}
				/>
				<div className="grid grid-cols-2 gap-3">
					{(["maxIterations", "timeoutSeconds"] as const).map((field) => (
						<label
							key={field}
							htmlFor={`${id}-${field}`}
							className="space-y-1 text-xs"
						>
							{field === "maxIterations" ? "Step limit" : "Timeout (seconds)"}
							<Input
								id={`${id}-${field}`}
								aria-label={`${label} ${field}`}
								type="number"
								min={1}
								max={field === "maxIterations" ? 1000 : 7200}
								placeholder={
									field === "timeoutSeconds"
										? `${DEFAULT_FACTORY_AGENT_TIMEOUT_SECONDS} (${DEFAULT_FACTORY_AGENT_TIMEOUT_SECONDS / 60} minutes)`
										: "Default"
								}
								value={agent[field] ?? ""}
								disabled={disabled}
								onChange={(event) =>
									onChange({
										...agent,
										[field]:
											event.target.value === ""
												? undefined
												: Number(event.target.value),
									})
								}
							/>
						</label>
					))}
				</div>
			</div>
		</details>
	);
}
