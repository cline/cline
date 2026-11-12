import { createHash } from "node:crypto";
import type {
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryReplayRequest,
} from "@cline/shared";
import {
	DEFAULT_FACTORY_AGENTS,
	factoryAcceptanceConfigurationFindings,
	factoryReplayRequestSchema,
	factoryTaskConfigSchema,
	factoryWorkflowConfigSchema,
	selectFactoryReviewAgents,
} from "@cline/shared";
import {
	normalizeFactoryTaskWorkflow,
	validateFactoryWorkflowRecipe,
} from "./factory-workflow-recipe";

export type FactoryReplayInput = FactoryReplayRequest & {
	actor: AgendaTaskActor;
};

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

/**
 * Builds one normal Factory task per workflow variant from a run's saved
 * execution inputs. Task IDs derive from the comparison ID so a retried
 * request finds the tasks it already created.
 */
export function createFactoryReplayInputs(input: {
	source: AgendaTaskRecord;
	run: AgendaTaskRunRecord;
	request: FactoryReplayInput;
}): Array<AgendaTaskCreateInput & { taskId: string }> {
	const { source, run } = input;
	const request = factoryReplayRequestSchema.parse(input.request);
	const state = run.factory;
	const snapshot = state?.inputSnapshot;
	if (
		run.taskId !== source.taskId ||
		request.taskId !== source.taskId ||
		request.runId !== run.runId
	)
		throw new Error("Replay source task and run do not match");
	if (!state || !snapshot)
		throw new Error(
			"This run has no saved execution inputs. Replay is available for runs started with an input snapshot.",
		);
	if (!snapshot.workspaceRoot || snapshot.factory.execution !== "local")
		throw new Error("Replay requires a saved local project workspace");
	if (!snapshot.factory.acceptanceCriteria?.length)
		throw new Error(
			"This run predates named acceptance criteria, so its variants would have no shared rubric. Rescope and run the work again before comparing workflows.",
		);
	const variants = request.variants.map((variant) => ({
		label: variant.label,
		recipe: variant.recipe && validateFactoryWorkflowRecipe(variant.recipe),
	}));
	if (
		new Set(variants.map((variant) => variant.label)).size !== variants.length
	)
		throw new Error("Replay variant labels must be unique");
	// Schema parsing fixes property order, so identical requests hash identically.
	const requestHash = sha256(
		JSON.stringify({ taskId: source.taskId, runId: run.runId, variants }),
	);
	const taskConfig = Object.fromEntries(
		Object.entries(snapshot.factory).filter(
			([key]) => !(key in factoryWorkflowConfigSchema.shape),
		),
	);
	return variants.map((variant, variantIndex) => {
		const { recipe } = variant;
		if (
			recipe &&
			(recipe.config.reviewMode ?? "fixed") !==
				(snapshot.factory.reviewMode ?? "fixed")
		)
			throw new Error(
				"Replay variants must keep the original review mode and approved review selection",
			);
		// The source app setup is verification context, so a variant verifier that
		// omits instructions, artifacts or environment keeps the source's; explicit
		// ones win. Each variant's run allocates its own app port.
		const recipeAgents = recipe?.config.agents;
		const sourceVerifier = snapshot.factory.agents?.verifier;
		const agents =
			recipeAgents?.verifier && sourceVerifier
				? {
						...recipeAgents,
						verifier: {
							instructions: sourceVerifier.instructions,
							artifacts: sourceVerifier.artifacts,
							environment: sourceVerifier.environment,
							...recipeAgents.verifier,
						},
					}
				: recipeAgents;
		const factory = normalizeFactoryTaskWorkflow(
			factoryTaskConfigSchema.parse({
				// A recipe replaces every workflow setting, including ones it omits.
				...(recipe
					? {
							...taskConfig,
							...recipe.config,
							agents,
							workflow: { name: recipe.name, revision: recipe.revision },
						}
					: snapshot.factory),
				sourceIssue: undefined,
				intake: undefined,
				approval: "required",
				publishPullRequest: false,
				watchPullRequest: false,
				replay: {
					sourceTaskId: source.taskId,
					sourceRunId: run.runId,
					sourceTaskRevision: run.taskRevision,
					baseCommit: state.workspace.baseCommit,
					baseBranch: state.workspace.baseBranch,
					comparisonId: request.comparisonId,
					variantIndex,
					requestHash,
					label: variant.label,
					reviewSelection: state.reviewSelection,
				},
			}),
		);
		const acceptanceFindings = factoryAcceptanceConfigurationFindings(factory);
		if (acceptanceFindings.length)
			throw new Error(
				`Replay variant "${variant.label}" cannot prove the source acceptance criteria. ${acceptanceFindings.join(" ")}`,
			);
		// The approved adaptive selection indexes the frozen pools, so it must fit each variant.
		const { planReviewers } = selectFactoryReviewAgents(
			factory.agents ?? DEFAULT_FACTORY_AGENTS,
			factory.replay?.reviewSelection,
		);
		return {
			...snapshot,
			factory,
			taskId: `task_replay_${sha256(`${request.comparisonId}\0${variantIndex}`).slice(0, 24)}`,
			type: source.type,
			title: `${snapshot.title} · ${variant.label}`,
			priority: source.priority,
			createdBy: input.request.actor,
			originTaskId: source.taskId,
			requiresApproval: true,
			automationEligible: false,
			queueFactoryDesign: planReviewers.length > 0,
			expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
		};
	});
}
