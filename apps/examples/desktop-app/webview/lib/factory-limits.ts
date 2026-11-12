import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryTaskConfig,
	factoryWorkflowConfigSchema,
	isFactoryHandsOff,
} from "@cline/shared/browser";

/** Bounds the Hub accepts for `task.factory.limits.set`. */
export const FACTORY_CONCURRENCY_MIN = 1;
export const FACTORY_CONCURRENCY_MAX = 8;

/**
 * How much Factory work the Hub runs at once, and whether new work is paused.
 * `supported: false` means the Hub predates the limit, so the setting cannot
 * be read or changed. `paused` is present only from a Hub that persists the
 * pause; an older Hub omits it and the app keeps its own.
 *
 * `dailyCostUsd` is the daily spending limit across all Factory work on this
 * machine (`null` = no limit) and `spentTodayUsd` what Factory has spent
 * today. Both are absent from a Hub that predates the daily limit, which reads
 * as unsupported (see `factoryDailyCostSupported`).
 */
export type FactoryLimits =
	| {
			supported: true;
			concurrency: number;
			paused?: boolean;
			dailyCostUsd?: number | null;
			spentTodayUsd?: number;
	  }
	| { supported: false };

/** Daily limit when a Hub that supports it reports none. */
export const FACTORY_DAILY_COST_DEFAULT_USD = 50;
/** Highest daily spending limit the app accepts. */
export const FACTORY_DAILY_COST_MAX_USD = 10_000;
/** Per-card spending limit of the built-in Hands-off workflow. */
export const FACTORY_CARD_COST_DEFAULT_USD = 10;
/** Highest per-card spending limit the app accepts. */
export const FACTORY_CARD_COST_MAX_USD = 1_000;

/** Whether the Hub reads and sets the daily spending limit. */
export function factoryDailyCostSupported(
	limits: FactoryLimits | undefined,
): limits is Extract<FactoryLimits, { supported: true }> & {
	dailyCostUsd: number | null;
} {
	return Boolean(limits?.supported && limits.dailyCostUsd !== undefined);
}

/**
 * Parses a dollar amount typed into a spending field. Empty means no limit
 * (`null`); anything else must be a finite number in [min, max].
 */
export function parseFactoryCostInput(
	text: string,
	{ min, max }: { min: number; max: number },
): { ok: true; value: number | null } | { ok: false } {
	const trimmed = text.trim();
	if (!trimmed) return { ok: true, value: null };
	const value = Number(trimmed);
	if (!Number.isFinite(value) || value < min || value > max)
		return { ok: false };
	return { ok: true, value: Math.round(value * 100) / 100 };
}

/** "$3", "$3.50". */
export function formatFactoryUsd(value: number): string {
	return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/**
 * Workflow config with the review requirement for automatic approval.
 * Typed locally until @cline/shared adds `requireIndependentReview` to
 * `factoryWorkflowConfigSchema`. Until then the shared schema drops it on
 * save, so the switch stays disabled (see `factoryIndependentReviewSupported`).
 */
export type FactoryReviewSafetyConfig = FactoryTaskConfig & {
	requireIndependentReview?: boolean;
};

/** Whether the shared workflow schema keeps `requireIndependentReview`. */
export function factoryIndependentReviewSupported(
	shape: object = factoryWorkflowConfigSchema.shape,
): boolean {
	return "requireIndependentReview" in shape;
}

/** Unset means required for hands-off work and not otherwise. */
export function factoryRequiresIndependentReview(
	config: FactoryTaskConfig,
): boolean {
	return (
		(config as FactoryReviewSafetyConfig).requireIndependentReview ??
		isFactoryHandsOff(config)
	);
}

export function withRequireIndependentReview(
	config: FactoryTaskConfig,
	required: boolean | undefined,
): FactoryTaskConfig {
	const { requireIndependentReview: _previous, ...rest } =
		config as FactoryReviewSafetyConfig;
	const next: FactoryReviewSafetyConfig =
		required === undefined
			? rest
			: { ...rest, requireIndependentReview: required };
	return next;
}

/** A participant's model: who it is for comparison, and how it reads. */
export type FactoryAgentModel = { key: string; label: string };

/**
 * The model a participant runs on as far as the app knows: a chosen model, a
 * profile's model, the profile itself when its model is not resolved yet, or
 * the Factory feature model.
 */
export function factoryAgentModel(agent: FactoryAgent): FactoryAgentModel {
	if (agent.modelSelection)
		return {
			key: `${agent.modelSelection.providerId}/${agent.modelSelection.modelId}`,
			label: agent.modelSelection.modelId,
		};
	const resolved = agent.resolvedProfile;
	if (resolved?.modelId)
		return {
			key: `${resolved.providerId ?? ""}/${resolved.modelId}`,
			label: resolved.modelId,
		};
	if (agent.profile)
		return {
			key: `profile:${agent.profile}`,
			label: `${agent.profile} profile`,
		};
	return { key: "feature", label: "feature model" };
}

export type FactoryReviewCoverage = {
	plans: FactoryAgentModel[];
	planChecks: FactoryAgentModel[];
	builds: FactoryAgentModel[];
	tests: FactoryAgentModel[];
	reviews: FactoryAgentModel[];
	/** At least one plan checker or code reviewer uses a model no builder uses. */
	independent: boolean;
	/** Neither a plan checker nor a tester checks the work. */
	noPlanCheckOrTest: boolean;
};

/** Who plans, builds and checks the work, and whether checking is independent. */
export function factoryReviewCoverage(
	agents: NonNullable<FactoryTaskConfig["agents"]> = DEFAULT_FACTORY_AGENTS,
): FactoryReviewCoverage {
	const builds = agents.implementers.map(factoryAgentModel);
	const planChecks = agents.planReviewers.map(factoryAgentModel);
	const reviews = agents.reviewers.map(factoryAgentModel);
	const builders = new Set(builds.map((model) => model.key));
	return {
		plans: [factoryAgentModel(agents.designer)],
		planChecks,
		builds,
		tests: agents.verifier ? [factoryAgentModel(agents.verifier)] : [],
		reviews,
		independent: [...planChecks, ...reviews].some(
			(model) => !builders.has(model.key),
		),
		noPlanCheckOrTest: planChecks.length === 0 && !agents.verifier,
	};
}

/** "claude-opus, gpt-5" without repeats. */
export function factoryModelList(models: FactoryAgentModel[]): string {
	return [...new Set(models.map((model) => model.label))].join(", ");
}
