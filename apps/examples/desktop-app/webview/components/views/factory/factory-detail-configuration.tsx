"use client";

import type {
	FactoryAcceptanceCriterion,
	FactoryCheck,
	FactoryRunState,
	FactoryTaskConfig,
} from "@cline/shared";
import {
	factoryArtifactPathProblem,
	factoryCheckConfigurationFindings,
	factoryWatchesPullRequest,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import { Plus, Trash2, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { serializeAttachments } from "@/hooks/chat-session/attachments";
import {
	FACTORY_CARD,
	FACTORY_TERMS,
	FACTORY_VERIFICATION_ORIGIN,
	FACTORY_VERIFICATION_SETUP,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import { DetailsSummary, StatusPill, toneText } from "./factory-ui";
import { FactoryWorkflowEditor } from "./factory-workflow-editor";

const labelClass = "block space-y-2 text-sm font-medium";
/** A small visible caption above a plan-editor field. */
const captionClass =
	"block space-y-1 text-xs font-medium text-muted-foreground";
const selectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm";
// Mirrors factoryAcceptanceCriteriaSchema's limit.
const MAX_CRITERIA = 20;

export function FactoryDetailConfiguration({
	config,
	disabled,
	setConfig,
	perform,
	readOnly = false,
	workspaceRoot,
	checksShownElsewhere = false,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	setConfig: Dispatch<SetStateAction<FactoryTaskConfig>>;
	perform: (action: () => Promise<void>) => Promise<void>;
	/** Hands-off cards show a summary; editing goes through More → Edit plan. */
	readOnly?: boolean;
	/** The card's checkout, to flag checks bound to it. */
	workspaceRoot?: string;
	/**
	 * The checks are shown elsewhere on the page (hands-off Edit plan, or the
	 * Checks tab's results).
	 */
	checksShownElsewhere?: boolean;
}) {
	if (readOnly)
		return (
			<ConfigurationSummary
				config={config}
				showChecks={!checksShownElsewhere}
			/>
		);
	const criteria = config.acceptanceCriteria ?? [];
	const setCriteria = (next: FactoryAcceptanceCriterion[]) =>
		setConfig({
			...config,
			acceptanceCriteria: next.length ? next : undefined,
		});
	return (
		<details className="rounded-lg border bg-card">
			<DetailsSummary className="gap-1.5 rounded-lg px-5 py-3 text-sm font-semibold text-foreground">
				Configuration
			</DetailsSummary>
			<div className="space-y-6 border-t px-5 py-5">
				<label className={labelClass} htmlFor="feature-documents">
					Reference docs
					<Input
						id="feature-documents"
						type="file"
						accept=".md,.markdown,.txt,text/plain,text/markdown"
						multiple
						disabled={disabled}
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							event.target.value = "";
							void perform(async () => {
								if (
									files.some(
										(file) =>
											!/\.(md|markdown|txt)$/i.test(file.name) ||
											file.size > 100_000,
									)
								)
									throw new Error(
										"Use Markdown or text files up to 100 KB each.",
									);
								if ((config.documents?.length ?? 0) + files.length > 10)
									throw new Error("Attach up to 10 reference docs.");
								const attachments = await serializeAttachments(files);
								setConfig((current) => ({
									...current,
									documents: [
										...(current.documents ?? []),
										...attachments.userFiles,
									],
								}));
							});
						}}
					/>
				</label>
				{config.documents?.map((doc, index) => (
					<div
						key={`${doc.name}-${index}`}
						className="flex items-center justify-between rounded border px-3 py-1 text-xs"
					>
						<span>{doc.name}</span>
						<Button
							size="icon"
							variant="ghost"
							aria-label={`Remove ${doc.name}`}
							disabled={disabled}
							onClick={() =>
								setConfig({
									...config,
									documents: config.documents?.filter((_, i) => i !== index),
								})
							}
						>
							<X className="size-3" />
						</Button>
					</div>
				))}
				<FactoryWorkflowEditor
					config={config}
					disabled={disabled}
					onChange={setConfig}
				/>
				{checksShownElsewhere ? null : (
					<FactoryChecksEditor
						config={config}
						setConfig={setConfig}
						disabled={disabled}
						workspaceRoot={workspaceRoot}
					/>
				)}
				<AppEnvironmentSummary config={config} />
				<section className="space-y-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold">Requirements</h3>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled || criteria.length >= MAX_CRITERIA}
							onClick={() => {
								const ids = new Set(criteria.map((criterion) => criterion.id));
								let next = criteria.length + 1;
								while (ids.has(`criterion-${next}`)) next += 1;
								setCriteria([
									...criteria,
									{ id: `criterion-${next}`, text: "", required: true },
								]);
							}}
						>
							<Plus className="mr-1 size-3" />
							Add criterion
						</Button>
					</div>
					<p className="text-xs leading-5 text-muted-foreground">
						Scoping proposes these. Each one is proven by a named check above
						or, without one, by the configured verifier. Required criteria must
						pass before a result is ready; optional ones are reported as
						limitations.
					</p>
					{criteria.map((criterion, index) => (
						<CriterionEditor
							key={criterion.id}
							criterion={criterion}
							checkNames={[
								...new Set(
									config.checks
										.map((check) => check.name.trim())
										.filter(Boolean),
								),
							]}
							disabled={disabled}
							onChange={(next) =>
								setCriteria(
									criteria.map((item, i) => (i === index ? next : item)),
								)
							}
							onRemove={() =>
								setCriteria(criteria.filter((_, i) => i !== index))
							}
						/>
					))}
				</section>
				<div className={labelClass}>
					Execution<p className="pt-2 text-sm font-normal">Local</p>
					<p className="text-xs font-normal text-muted-foreground">
						Cloud runner not connected yet.
					</p>
				</div>
				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						className="mt-1"
						disabled={disabled}
						checked={config.publishPullRequest}
						onChange={(event) =>
							setConfig({
								...config,
								publishPullRequest: event.target.checked,
							})
						}
					/>
					<span>
						Publish a draft PR after deterministic checks pass
						<span className="mt-1 block text-xs text-muted-foreground">
							Independent reviews and verification may continue after the draft
							is created. Off: retain changes on the local feature branch for
							inspection.
							{isFactoryHandsOff(config)
								? " Hands-off work publishes unless you turn this off."
								: ""}
						</span>
					</span>
				</label>
				{config.publishPullRequest ? (
					<label className="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							className="mt-1"
							disabled={disabled}
							checked={factoryWatchesPullRequest(config)}
							onChange={(event) =>
								setConfig({
									...config,
									watchPullRequest: event.target.checked,
								})
							}
						/>
						<span>
							{FACTORY_TERMS.keepPrGreen}
							<span className="mt-1 block text-xs text-muted-foreground">
								Watch CI and review comments, repair within the round limit, and
								reply after verification. You decide when to merge.
							</span>
						</span>
					</label>
				) : null}
			</div>
		</details>
	);
}

/**
 * Artifact paths no build can produce: absolute, or outside the worktree.
 * Saving is blocked until they are fixed or removed.
 */
function artifactPathBlocked(artifact: string, kind: FactoryCheck["kind"]) {
	const problem = factoryArtifactPathProblem(artifact, kind);
	return Boolean(problem && /absolute|escapes/.test(problem));
}

/** Whether any check declares an absolute or out-of-worktree artifact path. */
export function factoryChecksBlockSave(checks: readonly FactoryCheck[]) {
	return checks.some((check) =>
		check.artifacts.some((artifact) =>
			artifactPathBlocked(artifact, check.kind),
		),
	);
}

/**
 * The plan's checks, editable: name, type, command and each evidence path.
 * Problems are flagged inline in the engine's own words before saving.
 */
export function FactoryChecksEditor({
	config,
	setConfig,
	disabled,
	workspaceRoot,
}: {
	config: FactoryTaskConfig;
	setConfig: Dispatch<SetStateAction<FactoryTaskConfig>>;
	disabled: boolean;
	workspaceRoot?: string;
}) {
	return (
		<section className="space-y-3" aria-label="Required checks and evidence">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold">Required checks and evidence</h3>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() =>
						setConfig({
							...config,
							checks: [
								...config.checks,
								{ name: "", command: "", kind: "test", artifacts: [] },
							],
						})
					}
				>
					<Plus className="mr-1 size-3" />
					Add check
				</Button>
			</div>
			<p className="text-xs leading-5 text-muted-foreground">
				Commands run in the feature worktree. For UI changes, require
				screenshots or recordings; for backend changes, include route/API or
				end-to-end tests. Artifact paths are relative to the worktree.
			</p>
			{config.checks.map((check, index) => (
				<CheckEditor
					key={index}
					check={check}
					disabled={disabled}
					workspaceRoot={workspaceRoot}
					onChange={(next) =>
						setConfig({
							...config,
							checks: config.checks.map((item, i) =>
								i === index ? next : item,
							),
						})
					}
					onRemove={() =>
						setConfig({
							...config,
							checks: config.checks.filter((_, i) => i !== index),
						})
					}
				/>
			))}
			{config.checks.length === 0 && !isFactoryHandsOff(config) ? (
				<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
					Add at least one concrete verification command before approval.
				</p>
			) : null}
		</section>
	);
}

function CriterionEditor({
	criterion,
	checkNames,
	disabled,
	onChange,
	onRemove,
}: {
	criterion: FactoryAcceptanceCriterion;
	checkNames: string[];
	disabled: boolean;
	onChange: (criterion: FactoryAcceptanceCriterion) => void;
	onRemove: () => void;
}) {
	return (
		<div className="space-y-2 rounded-lg border p-3">
			<div className="flex items-center gap-2">
				<span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
					{criterion.id}
				</span>
				<Input
					aria-label={`Criterion ${criterion.id}`}
					placeholder="Exported CSV opens with the visible columns"
					maxLength={2000}
					value={criterion.text}
					disabled={disabled}
					onChange={(event) =>
						onChange({ ...criterion, text: event.target.value })
					}
				/>
				<Button
					size="icon"
					variant="ghost"
					aria-label={`Remove criterion ${criterion.id}`}
					disabled={disabled}
					onClick={onRemove}
				>
					<X className="size-4" />
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-3 text-xs">
				<select
					aria-label="Proven by"
					className={selectClass}
					value={criterion.check ?? ""}
					disabled={disabled}
					onChange={(event) =>
						onChange({ ...criterion, check: event.target.value || undefined })
					}
				>
					<option value="">Agent verification</option>
					{criterion.check && !checkNames.includes(criterion.check) ? (
						<option value={criterion.check}>
							Check “{criterion.check}” (not configured)
						</option>
					) : null}
					{checkNames.map((name) => (
						<option key={name} value={name}>
							Check “{name}”
						</option>
					))}
				</select>
				<label className="flex items-center gap-1">
					<input
						type="checkbox"
						checked={criterion.required}
						disabled={disabled}
						onChange={(event) =>
							onChange({ ...criterion, required: event.target.checked })
						}
					/>
					Required
				</label>
			</div>
		</div>
	);
}

function CheckEditor({
	check,
	disabled,
	workspaceRoot,
	onChange,
	onRemove,
}: {
	check: FactoryCheck;
	disabled: boolean;
	workspaceRoot?: string;
	onChange: (check: FactoryCheck) => void;
	onRemove: () => void;
}) {
	const label = check.name.trim();
	const findings = factoryCheckConfigurationFindings([check], workspaceRoot);
	const setArtifacts = (artifacts: string[]) =>
		onChange({ ...check, artifacts });
	const fieldId = useId();
	return (
		<div
			className="space-y-3 rounded-lg border p-3"
			data-testid="factory-check-editor"
		>
			<div className="flex flex-wrap items-end gap-2">
				<label
					htmlFor={`${fieldId}-name`}
					className={cn(captionClass, "min-w-40 flex-1")}
				>
					{FACTORY_CARD.checkName}
					<Input
						id={`${fieldId}-name`}
						aria-label={FACTORY_CARD.checkName}
						placeholder="API integration tests"
						value={check.name}
						disabled={disabled}
						onChange={(event) =>
							onChange({ ...check, name: event.target.value })
						}
					/>
				</label>
				<label className={captionClass}>
					{FACTORY_CARD.checkType}
					<select
						aria-label={FACTORY_CARD.checkType}
						className={cn(selectClass, "block")}
						value={check.kind}
						disabled={disabled}
						onChange={(event) => {
							const kind = event.target.value;
							if (kind === "test" || kind === "api" || kind === "ui")
								onChange({ ...check, kind });
						}}
					>
						<option value="test">Tests</option>
						<option value="api">API / E2E</option>
						<option value="ui">UI</option>
					</select>
				</label>
				{/* Removes the whole check: a labelled button in the check's header
				    row, apart from the per-path remove buttons below. */}
				<Button
					size="sm"
					variant="ghost"
					className="text-muted-foreground hover:text-destructive"
					aria-label={
						label
							? `${FACTORY_CARD.removeCheck} ${label}`
							: FACTORY_CARD.removeCheck
					}
					disabled={disabled}
					onClick={onRemove}
				>
					<Trash2 className="mr-1 size-3.5" />
					{FACTORY_CARD.removeCheck}
				</Button>
			</div>
			<label htmlFor={`${fieldId}-command`} className={captionClass}>
				{FACTORY_CARD.checkCommand}
				<Textarea
					id={`${fieldId}-command`}
					aria-label={FACTORY_CARD.checkCommand}
					className="min-h-16 resize-y break-all font-mono text-xs leading-5"
					placeholder="bun run test:api"
					rows={Math.min(6, Math.max(2, Math.ceil(check.command.length / 60)))}
					spellCheck={false}
					value={check.command}
					disabled={disabled}
					onChange={(event) =>
						onChange({ ...check, command: event.target.value })
					}
				/>
			</label>
			<fieldset
				className="space-y-1.5 border-l-2 pl-3"
				data-testid="factory-evidence-paths"
			>
				<legend className={captionClass}>{FACTORY_CARD.evidencePaths}</legend>
				<p className="text-xs text-muted-foreground">
					{FACTORY_CARD.evidencePathsHint}
				</p>
				{check.artifacts.map((artifact, index) => {
					const blocked = artifactPathBlocked(artifact, check.kind);
					return (
						<div key={index} className="flex items-center gap-1">
							<Input
								aria-label={FACTORY_CARD.evidencePath}
								aria-invalid={blocked || undefined}
								className={cn(
									"h-8 font-mono text-xs",
									blocked && "border-destructive",
								)}
								placeholder="evidence/export.png"
								value={artifact}
								disabled={disabled}
								onChange={(event) =>
									setArtifacts(
										check.artifacts.map((item, i) =>
											i === index ? event.target.value : item,
										),
									)
								}
							/>
							<Button
								size="icon"
								variant="ghost"
								className="size-8 shrink-0"
								aria-label={`Remove evidence path ${artifact}`}
								title="Remove this path"
								disabled={disabled}
								onClick={() =>
									setArtifacts(check.artifacts.filter((_, i) => i !== index))
								}
							>
								<X className="size-3.5" />
							</Button>
						</div>
					);
				})}
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setArtifacts([...check.artifacts, ""])}
				>
					<Plus className="mr-1 size-3" />
					Add evidence path
				</Button>
			</fieldset>
			{findings.length ? (
				<ul
					aria-label={label ? `Problems with ${label}` : "Check problems"}
					className="space-y-1 text-xs text-destructive"
				>
					{findings.map((finding) => (
						<li key={finding} className="break-words">
							{finding}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

/** A plain read-only view of a hands-off card's plan settings. */
function ConfigurationSummary({
	config,
	showChecks,
}: {
	config: FactoryTaskConfig;
	showChecks: boolean;
}) {
	const watch = factoryWatchesPullRequest(config);
	return (
		<section
			aria-label="Configuration"
			className="space-y-4 rounded-lg border bg-card px-5 py-4 text-sm"
		>
			<div className="min-w-0">
				<h3 className="font-semibold">Plan settings</h3>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{config.workflow ? `Workflow “${config.workflow.name}” · ` : ""}
					{config.publishPullRequest
						? watch
							? "Publishes a draft PR · Keeps it green"
							: "Publishes a draft PR"
						: "Keeps changes on a local branch"}
				</p>
			</div>
			{showChecks ? (
				<div className="space-y-1.5">
					<h4 className="text-xs font-medium text-muted-foreground">Checks</h4>
					{config.checks.length ? (
						<ul className="space-y-1">
							{config.checks.map((check) => (
								<li key={`${check.name}:${check.command}`} className="min-w-0">
									<span className="font-medium">
										{check.name || "Unnamed check"}
									</span>{" "}
									<code className="break-all text-xs text-muted-foreground">
										{check.command}
									</code>
								</li>
							))}
						</ul>
					) : (
						<p className="text-xs text-muted-foreground">
							Scoping proposes the checks.
						</p>
					)}
				</div>
			) : null}
			<AppEnvironmentSummary config={config} />
		</section>
	);
}

const appEnvironmentCommands = [
	["setup", "Setup"],
	["start", "Start"],
	["healthcheck", "Healthcheck"],
	["cleanup", "Cleanup"],
] as const;

/** The verifier app commands, shown beside the checks so approval covers them. */
function AppEnvironmentSummary({ config }: { config: FactoryTaskConfig }) {
	const environment = config.agents?.verifier?.environment;
	if (!environment) return null;
	return (
		<section className="space-y-2" aria-label="Verifier app environment">
			<h3 className="text-sm font-semibold">Verifier app environment</h3>
			<p className="text-xs leading-5 text-muted-foreground">
				Approving also runs these commands in the feature worktree before
				verification, on a free port in $FACTORY_APP_PORT. Edit them under
				Workflow, Agent verification.
			</p>
			<dl className="space-y-1 text-xs">
				{appEnvironmentCommands.map(([field, label]) =>
					environment[field] ? (
						<div key={field} className="flex gap-2">
							<dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
							<dd>
								<code className="break-all">{environment[field]}</code>
							</dd>
						</div>
					) : null,
				)}
			</dl>
		</section>
	);
}

const verificationCommands = [
	["setup", "Setup"],
	["start", "Start"],
	["healthcheck", "Health check"],
	["cleanup", "Cleanup"],
] as const;

/**
 * How Factory runs the app for the tester: the repository's verification
 * setup frozen in this plan, where it came from, and its dry run. A preset's
 * own app environment overrides it whole. With neither, says how to get one.
 */
export function FactoryVerificationSetup({
	config,
	dryRun,
	hasVerifier,
	showEmpty = true,
}: {
	config: Pick<FactoryTaskConfig, "verificationProfile" | "agents">;
	/** The run's dry run of the setup; ignored when it ran another version. */
	dryRun?: FactoryRunState["verificationProfile"];
	/** The workflow has a tester (or a run used one). */
	hasVerifier: boolean;
	/** Show the "nothing configured" note when there is no setup. */
	showEmpty?: boolean;
}) {
	const frozen = config.verificationProfile;
	const presetEnvironment = config.agents?.verifier?.environment;
	if (!frozen) {
		if (hasVerifier || !showEmpty) return null;
		return (
			<div className="space-y-1 text-xs text-muted-foreground">
				<p>{FACTORY_VERIFICATION_SETUP.noneConfigured}</p>
				<p>{FACTORY_VERIFICATION_SETUP.proposesWhenNeeded}</p>
			</div>
		);
	}
	const { profile } = frozen;
	const overridden =
		presetEnvironment !== undefined &&
		JSON.stringify(presetEnvironment) !== JSON.stringify(profile.environment);
	const result = dryRun?.hash === frozen.hash ? dryRun : undefined;
	return (
		<section
			aria-label={FACTORY_VERIFICATION_SETUP.title}
			className="space-y-3 text-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<h4 className="font-semibold">{FACTORY_VERIFICATION_SETUP.title}</h4>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{FACTORY_VERIFICATION_ORIGIN[frozen.origin]} ·{" "}
						<code className="font-mono" title={frozen.hash}>
							{frozen.hash.slice(0, 12)}
						</code>
					</p>
				</div>
				{result ? (
					<StatusPill
						tone={result.preflight === "passed" ? "success" : "danger"}
					>
						{result.preflight === "passed"
							? FACTORY_VERIFICATION_SETUP.dryRunPassed
							: FACTORY_VERIFICATION_SETUP.dryRunFailed(result.stage)}
					</StatusPill>
				) : (
					<StatusPill>{FACTORY_VERIFICATION_SETUP.dryRunPending}</StatusPill>
				)}
			</div>
			{overridden ? (
				<p className={cn("text-xs", toneText("attention"))}>
					{FACTORY_VERIFICATION_SETUP.presetOverrides}
				</p>
			) : null}
			<dl className="space-y-1 text-xs">
				{verificationCommands.map(([field, label]) =>
					profile.environment[field] ? (
						<div key={field} className="flex gap-2">
							<dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
							<dd className="min-w-0">
								<code className="break-all font-mono">
									{profile.environment[field]}
								</code>
							</dd>
						</div>
					) : null,
				)}
			</dl>
			<details className="text-xs">
				<DetailsSummary>{FACTORY_VERIFICATION_SETUP.exercise}</DetailsSummary>
				<p className="mt-2 whitespace-pre-wrap break-words rounded bg-muted/40 p-3">
					{profile.exercise}
				</p>
			</details>
			{result?.preflight === "failed" && result.detail ? (
				<details className="text-xs">
					<DetailsSummary>{FACTORY_VERIFICATION_SETUP.showLog}</DetailsSummary>
					<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono">
						{result.detail}
					</pre>
				</details>
			) : null}
		</section>
	);
}
