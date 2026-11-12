"use client";

import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryTaskConfig,
	type FactoryWorkflowConfig,
	factoryIndependentReview,
	factoryRequiresIndependentReview,
	factoryReviewMode,
	factoryWorkflowConfigSchema,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import { ArrowLeft, Check, Info, MessageSquare } from "lucide-react";
import {
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFactoryLimits } from "@/hooks/use-factory-limits";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { desktopClient } from "@/lib/desktop-client";
import {
	FACTORY_MANAGER,
	FACTORY_SETTINGS,
	FACTORY_SPENDING,
} from "@/lib/factory-copy";
import {
	FACTORY_CARD_COST_DEFAULT_USD,
	FACTORY_CARD_COST_MAX_USD,
	FACTORY_CONCURRENCY_MAX,
	FACTORY_CONCURRENCY_MIN,
	FACTORY_DAILY_COST_MAX_USD,
	factoryDailyCostSupported,
	formatFactoryUsd,
} from "@/lib/factory-limits";
import {
	type FactoryPreset,
	HANDS_OFF_PRESET_CONFIG,
	HANDS_OFF_PRESET_NAME,
} from "@/lib/factory-presets";
import { cn } from "@/lib/utils";
import { FactorySettingsModels } from "./factory-settings-models";
import { FactorySettingsProjects } from "./factory-settings-projects";
import {
	GroupHeading,
	rowLabels,
	SectionTitle,
	SettingRow,
	SettingSelect,
	useCostText,
} from "./factory-settings-rows";
import { useFactoryStages } from "./factory-stages-settings";
import { toneText } from "./factory-ui";
import { withHandsOff } from "./factory-workflow-editor";
import { useElementWidth } from "./use-element-width";

export type FactorySettingsSection = "general" | "models" | "projects";
const SECTIONS: readonly FactorySettingsSection[] = [
	"general",
	"models",
	"projects",
];
/** The open section, kept beside the Factory destination for the session. */
export const FACTORY_SETTINGS_SECTION_KEY = "factory.settingsSection";
/** Below this settings-area width the section list folds to tabs. */
const SECTION_LIST_MIN_WIDTH = 720;
const SAVED_MS = 2000;

function savedSection(): FactorySettingsSection {
	if (typeof window === "undefined") return "general";
	const saved = sessionStorage.getItem(FACTORY_SETTINGS_SECTION_KEY);
	return SECTIONS.includes(saved as FactorySettingsSection)
		? (saved as FactorySettingsSection)
		: "general";
}

/** A workflow row's change: the next config and the row that made it. */
export type CommitWorkflow = (next: FactoryWorkflowConfig, row: string) => void;

/**
 * The default workflow for new work, saved on every change through
 * `factory_save_preset` (the default in use, else the built-in Hands-off
 * workflow, kept as the default). A change shows at once; a rejected save
 * returns to the last saved value and reports under the row that made it.
 * `draft` holds edits not saved yet (text fields save on blur).
 */
function useDefaultWorkflow(onSaved: () => void) {
	const presets = useFactoryPresets();
	const { setPresets, setDefaultPreset } = presets;
	const name =
		presets.defaultPreset &&
		presets.presets.some((preset) => preset.name === presets.defaultPreset)
			? presets.defaultPreset
			: HANDS_OFF_PRESET_NAME;
	const stored: FactoryWorkflowConfig =
		presets.presets.find((preset) => preset.name === name)?.config ??
		HANDS_OFF_PRESET_CONFIG;
	const [draft, setDraft] = useState<FactoryWorkflowConfig>();
	const [rowError, setRowError] = useState<{ row: string; message: string }>();
	const latest = useRef(0);
	const commit = useCallback<CommitWorkflow>(
		(next, row) => {
			const attempt = ++latest.current;
			setDraft(next);
			setRowError(undefined);
			void Promise.resolve()
				.then(() =>
					desktopClient.invoke<FactoryPreset[]>("factory_save_preset", {
						name,
						config: factoryWorkflowConfigSchema.parse(next),
						useByDefault: true,
					}),
				)
				.then(
					(items) => {
						setPresets(items);
						setDefaultPreset(name);
						if (attempt === latest.current) onSaved();
						setDraft((current) => (current === next ? undefined : current));
					},
					(cause: unknown) => {
						if (attempt !== latest.current) return;
						setDraft(undefined);
						setRowError({
							row,
							message:
								cause instanceof Error && cause.message
									? cause.message
									: FACTORY_SETTINGS.saveFailed,
						});
					},
				);
		},
		[name, onSaved, setPresets, setDefaultPreset],
	);
	return {
		config: draft ?? stored,
		/** Shows an edit without saving it; `flush` saves it. */
		edit: setDraft,
		flush: (row: string) => {
			if (draft && draft !== stored) commit(draft, row);
		},
		commit,
		errorFor: (row: string) =>
			rowError?.row === row ? rowError.message : undefined,
		presets,
		name,
	};
}
export type DefaultWorkflow = ReturnType<typeof useDefaultWorkflow>;

/**
 * Factory settings: a sibling of the board in the same app shell. One header
 * row with the only way back, a section list (tabs when the area is narrow)
 * and one column of rows that save as they change.
 */
export function FactorySettingsPage({
	onBack,
	onAskFactory,
	askFactoryOpen = false,
	projects,
	limits: limitsProp,
	focus,
}: {
	onBack: () => void;
	onAskFactory?: () => void;
	askFactoryOpen?: boolean;
	/** Project checkouts with Factory work, for the Projects section. */
	projects: readonly string[];
	/** The board's Hub limits, so both show one state; read here when absent. */
	limits?: ReturnType<typeof useFactoryLimits>;
	/** Open General with this field focused (the spending banner's link). */
	focus?: "dailyCostUsd";
}) {
	const [section, setSection] = useState<FactorySettingsSection>(() =>
		focus ? "general" : savedSection(),
	);
	useEffect(() => {
		sessionStorage.setItem(FACTORY_SETTINGS_SECTION_KEY, section);
	}, [section]);
	const [savedAt, setSavedAt] = useState(0);
	const flashSaved = useCallback(() => setSavedAt(Date.now()), []);
	useEffect(() => {
		if (!savedAt) return;
		const timer = setTimeout(() => setSavedAt(0), SAVED_MS);
		return () => clearTimeout(timer);
	}, [savedAt]);
	const ownLimits = useFactoryLimits({ enabled: !limitsProp });
	const limits = limitsProp ?? ownLimits;
	// A Hub limit saved: the hook rolls back and reports a failure itself.
	const limitsSaving = useRef(false);
	useEffect(() => {
		if (limitsSaving.current && !limits.saving && !limits.error) flashSaved();
		limitsSaving.current = limits.saving;
	}, [limits.saving, limits.error, flashSaved]);
	const workflow = useDefaultWorkflow(flashSaved);
	const [setRoot, width] = useElementWidth();
	// 0 is "not measured" (jsdom, first paint): the wide layout.
	const tabs = width > 0 && width < SECTION_LIST_MIN_WIDTH;
	const [project, setProject] = useState(projects[0]);
	const shownProject =
		project && projects.includes(project) ? project : projects[0];
	const stages = useFactoryStages(projects);
	const awaiting = stages.awaiting;
	const sectionIds = Object.fromEntries(
		SECTIONS.map((id) => [id, `factory-settings-${id}`]),
	) as Record<FactorySettingsSection, string>;

	const header = (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-2.5">
			<Button
				variant="ghost"
				size="sm"
				className="size-7 px-0"
				aria-label={FACTORY_SETTINGS.back}
				title={FACTORY_SETTINGS.back}
				onClick={onBack}
			>
				<ArrowLeft aria-hidden className="size-4" />
			</Button>
			<h1 className="truncate text-[15px] font-semibold">
				{FACTORY_SETTINGS.title}
			</h1>
			<span className="flex-1" />
			<output
				aria-live="polite"
				className="flex items-center gap-1 text-xs text-muted-foreground"
			>
				{savedAt ? (
					<>
						<Check
							aria-hidden
							className={cn("size-3.5", toneText("success"))}
						/>
						{FACTORY_SETTINGS.saved}
					</>
				) : null}
			</output>
			{onAskFactory ? (
				<Button
					size="sm"
					variant={askFactoryOpen ? "secondary" : "default"}
					aria-expanded={askFactoryOpen}
					data-ask-factory=""
					onClick={onAskFactory}
					className={cn("h-7 px-2.5", askFactoryOpen && "border")}
				>
					<MessageSquare aria-hidden className="size-3.5" />
					{FACTORY_MANAGER.ask}
				</Button>
			) : null}
		</header>
	);

	const count = (id: FactorySettingsSection) =>
		id === "projects" && awaiting > 0 ? (
			<span
				className={cn(
					"rounded-full bg-amber-500/15 px-1.5 text-[10.5px] leading-4 font-semibold",
					toneText("attention"),
				)}
				title={FACTORY_SETTINGS.projects.awaiting(awaiting)}
			>
				{awaiting}
				<span className="sr-only">
					{` (${FACTORY_SETTINGS.projects.awaiting(awaiting)})`}
				</span>
			</span>
		) : null;

	const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
		const step =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const next =
			SECTIONS[
				(SECTIONS.indexOf(section) + step + SECTIONS.length) % SECTIONS.length
			];
		setSection(next);
		event.currentTarget
			.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)
			?.focus();
	};

	const navigation = tabs ? (
		<div
			role="tablist"
			aria-label={FACTORY_SETTINGS.sectionsLabel}
			className="flex h-9 shrink-0 items-stretch gap-1 border-b px-3"
			onKeyDown={onTabKey}
		>
			{SECTIONS.map((id) => (
				<button
					key={id}
					type="button"
					role="tab"
					data-section={id}
					id={`${sectionIds[id]}-tab`}
					aria-selected={section === id}
					aria-controls={sectionIds[id]}
					tabIndex={section === id ? 0 : -1}
					onClick={() => setSection(id)}
					className={cn(
						"flex items-center gap-1.5 border-b-2 px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
						section === id
							? "border-primary text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
				>
					{FACTORY_SETTINGS.sections[id]}
					{count(id)}
				</button>
			))}
		</div>
	) : (
		<nav
			aria-label={FACTORY_SETTINGS.sectionsLabel}
			className="flex w-44 shrink-0 flex-col gap-0.5 border-r px-2 py-3"
		>
			{SECTIONS.map((id) => (
				<Button
					key={id}
					type="button"
					variant="sidebarItem"
					data-section={id}
					aria-current={section === id ? "page" : undefined}
					onClick={() => setSection(id)}
					className={cn(
						"!h-[30px] !px-2.5 py-0 font-normal",
						section === id &&
							"bg-surface-hover font-medium text-sidebar-foreground",
					)}
				>
					<span className="truncate">{FACTORY_SETTINGS.sections[id]}</span>
					<span className="ml-auto">{count(id)}</span>
				</Button>
			))}
		</nav>
	);

	return (
		<div
			ref={setRoot}
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			data-testid="factory-settings"
			data-layout={tabs ? "tabs" : "list"}
		>
			{header}
			<div className={cn("flex min-h-0 flex-1", tabs && "flex-col")}>
				{navigation}
				<ScrollArea className="min-h-0 min-w-0 flex-1">
					<section
						id={sectionIds[section]}
						aria-labelledby={`${sectionIds[section]}-heading`}
						{...(tabs ? { role: "tabpanel" } : {})}
						className={cn(
							"@container/settings max-w-[720px]",
							tabs ? "px-4 pt-3.5 pb-4" : "px-7 pt-5 pb-6",
						)}
					>
						{section === "general" ? (
							<GeneralSection
								headingId={`${sectionIds.general}-heading`}
								workflow={workflow}
								limits={limits}
								focus={focus}
							/>
						) : section === "models" ? (
							<FactorySettingsModels
								headingId={`${sectionIds.models}-heading`}
								workflow={workflow}
							/>
						) : (
							<FactorySettingsProjects
								headingId={`${sectionIds.projects}-heading`}
								projects={projects}
								project={shownProject}
								onProjectChange={setProject}
								stages={stages}
							/>
						)}
					</section>
				</ScrollArea>
			</div>
		</div>
	);
}

/** Plan approval as the person sees it: "Only when needed" or "Every plan". */
type PlanApproval = FactoryWorkflowConfig["approval"];
type DraftReview = NonNullable<FactoryWorkflowConfig["humanStamp"]>;
type PullRequestReady = NonNullable<FactoryWorkflowConfig["pullRequestReady"]>;

/** The review policy in effect: unset is by risk when hands-off, else always. */
export function effectiveDraftReview(
	config: FactoryWorkflowConfig,
): DraftReview {
	return (
		config.humanStamp ?? (isFactoryHandsOff(config) ? "by_risk" : "always")
	);
}

/**
 * Update on an older workflow: turns hands-off on and pins every value the
 * page was showing, so only retry and re-scoping change.
 */
export function updateOlderWorkflow(
	config: FactoryWorkflowConfig,
): FactoryWorkflowConfig {
	return factoryWorkflowConfigSchema.parse(
		withHandsOff(
			{
				...config,
				humanStamp: effectiveDraftReview(config),
				reviewMode: factoryReviewMode(config),
				requireIndependentReview: factoryRequiresIndependentReview(config),
			} as FactoryTaskConfig,
			true,
		),
	);
}

function GeneralSection({
	headingId,
	workflow,
	limits,
	focus,
}: {
	headingId: string;
	workflow: DefaultWorkflow;
	limits: ReturnType<typeof useFactoryLimits>;
	focus?: "dailyCostUsd";
}) {
	const { config, commit, errorFor } = workflow;
	const loading = workflow.presets.loading;
	const S = FACTORY_SETTINGS.general;
	const older =
		!loading && !workflow.presets.error && !isFactoryHandsOff(config);
	// The engine's own test: a code reviewer on a model no author uses.
	const independent = factoryIndependentReview(
		config.agents ?? DEFAULT_FACTORY_AGENTS,
		undefined,
	).independent;
	const pullRequestReady: PullRequestReady = config.pullRequestReady ?? "never";
	const draftReview = effectiveDraftReview(config);
	const dailyRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (focus === "dailyCostUsd" && !limits.loading) dailyRef.current?.focus();
	}, [focus, limits.loading]);
	return (
		<>
			<SectionTitle
				id={headingId}
				title={FACTORY_SETTINGS.sections.general}
				scope={S.scope}
				workflow={workflow}
			/>
			<GroupHeading>{S.approvalGroup}</GroupHeading>
			<SettingRow
				id="approval"
				title={S.planApproval}
				description={S.planApprovalHint[config.approval]}
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
									{S.olderTitle}
								</span>{" "}
								{S.olderBody(
									config.approval === "required",
									config.maxCostUsd === undefined,
								)}
							</p>
							<Button
								variant="outline"
								size="xs"
								className="h-[26px]"
								onClick={() => commit(updateOlderWorkflow(config), "approval")}
							>
								{S.update}
							</Button>
						</div>
					) : null
				}
			>
				<SettingSelect<PlanApproval>
					id="approval"
					value={config.approval}
					disabled={loading}
					options={(["automatic", "required"] as const).map((value) => ({
						value,
						label: S.planApprovalOptions[value],
					}))}
					onChange={(approval) => commit({ ...config, approval }, "approval")}
				/>
			</SettingRow>
			<SettingRow
				id="humanStamp"
				title={S.draftReview}
				description={S.draftReviewHint[draftReview]}
				error={errorFor("humanStamp")}
				top
			>
				<SettingSelect<DraftReview>
					id="humanStamp"
					value={draftReview}
					disabled={loading}
					options={(["by_risk", "always", "never"] as const).map((value) => ({
						value,
						label: S.draftReviewOptions[value],
					}))}
					onChange={(humanStamp) =>
						commit({ ...config, humanStamp }, "humanStamp")
					}
				/>
			</SettingRow>
			<SettingRow
				id="pullRequestReady"
				title={S.pullRequests}
				description={S.pullRequestHint[pullRequestReady]}
				extra={
					independent ? null : (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{S.needsIndependentReviewer}
						</p>
					)
				}
				error={errorFor("pullRequestReady")}
				top
			>
				<SettingSelect<PullRequestReady>
					id="pullRequestReady"
					value={pullRequestReady}
					disabled={loading}
					options={(["never", "when_no_review_required"] as const).map(
						(value) => ({
							value,
							label: S.pullRequestOptions[value],
							disabled: value === "when_no_review_required" && !independent,
						}),
					)}
					onChange={(value) =>
						commit({ ...config, pullRequestReady: value }, "pullRequestReady")
					}
				/>
			</SettingRow>
			<GroupHeading>{S.limitsGroup}</GroupHeading>
			<WorkAtOnceRow limits={limits} />
			<CardLimitRow workflow={workflow} />
			<DailyLimitRow limits={limits} inputRef={dailyRef} />
		</>
	);
}

function WorkAtOnceRow({
	limits,
}: {
	limits: ReturnType<typeof useFactoryLimits>;
}) {
	const S = FACTORY_SETTINGS.general;
	const supported = limits.limits?.supported === true;
	const unsupported = limits.limits?.supported === false;
	const error =
		limits.errorFor === "concurrency" || limits.errorFor === "read"
			? limits.error
			: null;
	return (
		<SettingRow
			id="concurrency"
			title={S.workAtOnce}
			description={unsupported ? S.workAtOnceUnsupported : S.workAtOnceHint}
			error={error}
		>
			<SettingSelect
				id="concurrency"
				className="min-w-0"
				value={
					limits.limits?.supported
						? String(limits.limits.concurrency)
						: undefined
				}
				disabled={limits.loading || limits.saving || !supported}
				options={Array.from(
					{ length: FACTORY_CONCURRENCY_MAX - FACTORY_CONCURRENCY_MIN + 1 },
					(_, index) => {
						const value = String(FACTORY_CONCURRENCY_MIN + index);
						return { value, label: value };
					},
				)}
				onChange={(value) => void limits.setConcurrency(Number(value))}
			/>
		</SettingRow>
	);
}

/** "$ [10.00]": a dollar field that commits on blur or Enter. */
function CostInput({
	id,
	field,
	disabled,
	onCommit,
	inputRef,
}: {
	id: string;
	field: ReturnType<typeof useCostText>;
	disabled: boolean;
	onCommit: (value: number | null) => void;
	inputRef?: RefObject<HTMLInputElement | null>;
}) {
	const commit = () => {
		const change = field.changed();
		if (change) onCommit(change.value);
	};
	return (
		<InputGroup className="h-[30px] w-24" data-disabled={disabled || undefined}>
			<InputGroupAddon className="pr-0 pl-2.5 text-xs">$</InputGroupAddon>
			<InputGroupInput
				ref={inputRef}
				id={`${id}-input`}
				type="number"
				inputMode="decimal"
				step={0.01}
				placeholder={FACTORY_SETTINGS.general.noLimitPlaceholder}
				className="h-full [appearance:textfield] pr-2 pl-1 text-[13px] tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
		</InputGroup>
	);
}

function CardLimitRow({ workflow }: { workflow: DefaultWorkflow }) {
	const S = FACTORY_SETTINGS.general;
	const { config, commit, errorFor } = workflow;
	const value = config.maxCostUsd ?? null;
	const field = useCostText(value, {
		min: 0.01,
		max: FACTORY_CARD_COST_MAX_USD,
	});
	const empty = field.valid && field.text.trim() === "";
	return (
		<SettingRow
			id="maxCostUsd"
			title={S.cardLimit}
			description={S.cardLimitHint}
			extra={
				!field.valid ? (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{FACTORY_SPENDING.cardLimitInvalid(FACTORY_CARD_COST_MAX_USD)}
					</p>
				) : empty ? (
					// Hands-off work stops at the built-in limit when none is set.
					isFactoryHandsOff(config) ? (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{S.cardBuiltInLimit(
								formatFactoryUsd(FACTORY_CARD_COST_DEFAULT_USD),
							)}
						</p>
					) : (
						<p className={cn("mt-0.5 text-xs", toneText("attention"))}>
							{S.cardNoLimit}
						</p>
					)
				) : null
			}
			error={errorFor("maxCostUsd")}
		>
			<CostInput
				id="maxCostUsd"
				field={field}
				disabled={workflow.presets.loading}
				onCommit={(maxCostUsd) =>
					commit(
						{ ...config, maxCostUsd: maxCostUsd ?? undefined },
						"maxCostUsd",
					)
				}
			/>
		</SettingRow>
	);
}

function DailyLimitRow({
	limits,
	inputRef,
}: {
	limits: ReturnType<typeof useFactoryLimits>;
	inputRef: RefObject<HTMLInputElement | null>;
}) {
	const S = FACTORY_SETTINGS.general;
	const current = limits.limits;
	const supported = factoryDailyCostSupported(current);
	const value = supported ? current.dailyCostUsd : null;
	const field = useCostText(value, { min: 0, max: FACTORY_DAILY_COST_MAX_USD });
	const spent =
		supported && current.spentTodayUsd !== undefined
			? formatFactoryUsd(current.spentTodayUsd)
			: undefined;
	return (
		<SettingRow
			id="dailyCostUsd"
			title={S.dailyLimit}
			description={
				!limits.loading && !supported
					? FACTORY_SPENDING.unsupported
					: S.dailyLimitHint(spent)
			}
			extra={
				!field.valid ? (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{FACTORY_SPENDING.dailyLimitInvalid(FACTORY_DAILY_COST_MAX_USD)}
					</p>
				) : supported && value === null ? (
					<p className={cn("mt-0.5 text-xs", toneText("attention"))}>
						{FACTORY_SPENDING.noLimit}
					</p>
				) : null
			}
			error={limits.errorFor === "dailyCostUsd" ? limits.error : null}
		>
			<CostInput
				id="dailyCostUsd"
				field={field}
				inputRef={inputRef}
				disabled={limits.loading || limits.saving || !supported}
				onCommit={(dailyCostUsd) => void limits.setDailyCostUsd(dailyCostUsd)}
			/>
			<span className="text-xs text-muted-foreground">{S.perDay}</span>
		</SettingRow>
	);
}
