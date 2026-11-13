import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryWorkflowConfig,
	factoryCardCostLimitUsd,
	factoryWatchesPullRequest,
	factoryWorkflowRecipeSchema,
} from "@cline/shared/browser";
import {
	FACTORY_SETTINGS,
	FACTORY_WORKFLOW,
	factoryShortModel,
} from "@/lib/factory-copy";
import { formatFactoryUsd } from "@/lib/factory-limits";
import {
	type FactoryPreset,
	HANDS_OFF_PRESET_NAME,
} from "@/lib/factory-presets";
import { FS_WORKFLOWS } from "@/lib/factory-settings-copy/workflows";
import { effectiveDraftReview } from "../../default-workflow";

const W = FS_WORKFLOWS;
const G = FACTORY_SETTINGS.general;

export const isBuiltIn = (name: string) => name === HANDS_OFF_PRESET_NAME;

/** Hands-off first, then the saved workflows in the order they were saved. */
export function orderedWorkflows(
	presets: readonly FactoryPreset[],
): FactoryPreset[] {
	return [
		...presets.filter((preset) => isBuiltIn(preset.name)),
		...presets.filter((preset) => !isBuiltIn(preset.name)),
	];
}

/** "Plans only when needed · 2 builders · tester on · $10 per card" */
export function workflowSummary(config: FactoryWorkflowConfig): string {
	const agents = config.agents ?? DEFAULT_FACTORY_AGENTS;
	const limit = factoryCardCostLimitUsd(config);
	return [
		W.summary[config.approval],
		W.summary.builders(agents.implementers.length),
		W.summary.tester(Boolean(agents.verifier)),
		limit === undefined
			? W.summary.noCardLimit
			: W.summary.perCard(formatFactoryUsd(limit)),
	].join(" · ");
}

/** Why a new name can't be used, or undefined when it can. */
export function workflowNameProblem(
	next: string,
	presets: readonly FactoryPreset[],
	current?: string,
): string | undefined {
	const name = next.trim();
	if (!name) return W.nameEmpty;
	if (name.length > 100) return W.nameTooLong;
	if (name === current) return undefined;
	if (isBuiltIn(name)) return W.nameBuiltIn(name);
	if (presets.some((preset) => preset.name === name)) return W.nameTaken(name);
	return undefined;
}

/** "Careful copy", then "Careful copy 2"… the first name not taken. */
export function copyName(name: string, presets: readonly FactoryPreset[]) {
	for (let n = 1; ; n++) {
		const candidate = W.copyName(name, n);
		if (!presets.some((preset) => preset.name === candidate)) return candidate;
	}
}

/** The JSON Copy as JSON puts on the clipboard (and Import reads). */
export function workflowJson(preset: FactoryPreset): string {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			name: preset.name,
			revision: preset.revision,
			config: preset.config,
		},
		null,
		2,
	)}\n`;
}

export type ImportCheck =
	| { ok: true; name: string; revision: string; config: FactoryWorkflowConfig }
	| { ok: false; error: string };

/**
 * Pasted text as a workflow to import: valid JSON, a version 1 workflow
 * (the shared schema), and not a name another saved workflow already uses
 * with a different revision.
 */
export function checkImport(
	text: string,
	presets: readonly FactoryPreset[],
): ImportCheck {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: W.invalidJson };
	}
	const result = factoryWorkflowRecipeSchema.safeParse(parsed);
	if (!result.success) {
		const issue = result.error.issues[0];
		return {
			ok: false,
			error: FACTORY_WORKFLOW.notVersion1(
				`${issue?.path.join(".") || "workflow"} ${issue?.message ?? ""}`,
			),
		};
	}
	const recipe = result.data;
	const same = presets.find((preset) => preset.name === recipe.name);
	if (same && same.revision !== recipe.revision)
		return { ok: false, error: FACTORY_WORKFLOW.nameTaken(recipe.name) };
	if (same) return { ok: false, error: W.alreadySaved(recipe.name) };
	return {
		ok: true,
		name: recipe.name,
		revision: recipe.revision,
		config: recipe.config,
	};
}

function agentModels(agents: readonly FactoryAgent[]): string {
	return agents
		.map((agent) => {
			const model = agent.modelSelection?.modelId
				? factoryShortModel(agent.modelSelection.modelId)
				: W.preview.defaultModel;
			return agent.instructions?.trim()
				? `${model} ${W.preview.instructions}`
				: model;
		})
		.join(", ");
}

/** What an import sets, as label and value pairs for its preview. */
export function workflowPreview(
	config: FactoryWorkflowConfig,
): [label: string, value: string][] {
	const P = W.preview;
	const agents = config.agents ?? DEFAULT_FACTORY_AGENTS;
	const limit = factoryCardCostLimitUsd(config);
	const count = (list: readonly FactoryAgent[]) =>
		list.length === 0 ? P.none : `${list.length}: ${agentModels(list)}`;
	return [
		[P.planApproval, G.planApprovalOptions[config.approval]],
		[P.draftReview, G.draftReviewOptions[effectiveDraftReview(config)]],
		[P.pullRequests, G.pullRequestOptions[config.pullRequestReady ?? "never"]],
		[P.keepPassing, factoryWatchesPullRequest(config) ? P.on : P.off],
		[P.builders, count(agents.implementers)],
		[P.planCheckers, count(agents.planReviewers)],
		[P.reviewers, count(agents.reviewers)],
		[P.tester, agents.verifier ? agentModels([agents.verifier]) : P.off],
		[P.cardLimit, limit === undefined ? P.noLimit : formatFactoryUsd(limit)],
		[P.repairRounds, String(config.maxRepairRounds)],
		[P.retries, String(config.maxRuntimeRetries ?? 2)],
	];
}
