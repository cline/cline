import { collectFacts, withCurrentSources } from "../../context/manifest";
import { sourceOff } from "../../context/policy";
import type { Settings } from "../../settings/settings";
import { stableJson } from "../../values";
import { fnv1a32 } from "../candidates";
import { offerableKinds } from "../kinds";
import { buildPlannerInput } from "../model/input";
import { generatePool } from "../model/model";
import type { SessionCore } from "./core";
import type { TurnState } from "./turn-state";

/**
 * The planner answer the tray still waits for when nothing is asking for
 * it: one a detach held back, or one a respawn cut off. The planner is
 * asked now, or, when the allowance ran out meanwhile, the rules answer.
 */
export function resumePlanner(core: SessionCore, settings: Settings): void {
	const state = core.state;
	if (!state || state.planning || !core.awaitingPlanner()) return;
	const model = core.plannerModel(settings);
	if (model?.status === "pending") startPlanner(core, state, core.generation);
	else core.serve(state, model);
}

export function startPlanner(
	core: SessionCore,
	state: TurnState,
	gen: number,
): void {
	core.track(
		planModel(core, state, gen).catch((error: unknown) => {
			core.options.log?.("the planner failed", error);
			if (core.isCurrent(gen, state) && core.awaitingPlanner())
				core.serve(state, { status: "error" });
		}),
	);
}

/**
 * The detached half: facts, one model call (or a cached pool), and the model
 * set if this turn is still current. A pool is cached by the chat position
 * and the person's message, so a run resumed on the same message reuses it
 * and a new message at a position the chat returned to asks again.
 */
async function planModel(
	core: SessionCore,
	state: TurnState,
	gen: number,
): Promise<void> {
	state.planning = true;
	try {
		await requestModelSet(core, state, gen);
	} finally {
		state.planning = false;
	}
}

async function requestModelSet(
	core: SessionCore,
	state: TurnState,
	gen: number,
): Promise<void> {
	const complete = core.options.complete;
	if (!complete || !core.isCurrent(gen, state) || !core.isViewed()) return;
	if (state.restored) {
		state.backlog = await core.options.backlog(state.manifest);
		state.restored = false;
		if (!core.isCurrent(gen, state)) return;
	}
	const settings = core.options.settings();
	const sources = core.options.sources();
	const manifest = withCurrentSources(
		state.manifest,
		sources,
		state.env,
		sourceOff(settings, state.env),
		state.respawned ? state.capabilitiesBySource : undefined,
	);
	const facts = await collectFacts(sources, manifest, state.env);
	if (!core.isCurrent(gen, state)) return;
	const kinds = offerableKinds(manifest);
	const key = `${state.turn.revision}:${state.turn.userMessageId}:${fnv1a32(stableJson({ backlog: state.backlog, facts, manifest }))}`;
	let pool = core.cache
		.get(key)
		?.filter((item) => !state.excluded.includes(item.prompt));
	if (!pool || pool.length === 0) {
		if (!core.isViewed()) return;
		const input = buildPlannerInput({
			turn: state.turn.facts,
			context: state.turn.context,
			backlog: state.backlog,
			manifest,
			facts,
			names: Object.fromEntries(
				sources.map((source) => [source.id, source.displayName ?? source.id]),
			),
			kinds,
			excluded: state.excluded,
		});
		const slot = core.options.ledger?.reserve(core.options.sessionId);
		const attempt = await generatePool(
			complete,
			input,
			kinds,
			settings,
			core.options.ledger?.timeoutMs(core.options.sessionId),
			core.generationSignal,
		);
		if ("reason" in attempt && attempt.reason === "no_provider")
			slot?.release();
		else
			slot?.record({
				path: "summary",
				outcome: "reason" in attempt ? attempt.reason : "ok",
				totalMs: attempt.totalMs,
				firstTokenMs: attempt.firstTokenMs,
				...attempt.usage,
				costUsd: attempt.costUsd,
				providerId: attempt.providerId,
				modelId: attempt.modelId,
			});
		if (!core.isCurrent(gen, state)) return;
		if ("reason" in attempt) {
			core.options.log?.(
				`model suggestions unavailable (${attempt.reason}); the rules answer`,
				attempt.error,
			);
			core.serve(state, {
				status: attempt.reason === "no_provider" ? "no_provider" : "error",
			});
			return;
		}
		pool = attempt.pool;
		core.cache.set(key, pool);
	}
	state.pool = pool;
	state.poolManifest = manifest;
	core.serve(state);
}
