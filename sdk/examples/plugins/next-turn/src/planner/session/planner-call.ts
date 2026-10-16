import { collectFacts, withCurrentSources } from "../../context/manifest";
import { sourceOff } from "../../context/policy";
import type { Settings } from "../../settings/settings";
import { isRecord } from "../../values";
import { fnv1a32 } from "../candidates";
import { offerableKinds } from "../kinds";
import { buildPlannerInput } from "../model/input";
import { generatePool } from "../model/model";
import type { OfferedSet } from "../tray/tray";
import type { SessionCore } from "./core";
import {
	type PlannerStatus,
	pausedOf,
	rerollsLeft,
	type TurnState,
	trayState,
} from "./turn-state";

/** JSON with every object's keys sorted, so the same input always hashes the same. */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (isRecord(value)) {
		const fields = Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
		return `{${fields.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/**
 * The planner answer the tray still waits for when nothing is asking for
 * it: one a detach held back, or one a respawn cut off. The planner is
 * asked now, or, when the allowance ran out meanwhile, the rules answer.
 */
export function resumePlanner(core: SessionCore, settings: Settings): void {
	const state = core.state;
	if (!state || state.planning) return;
	const awaitingReroll = core.awaitingReroll();
	if (!awaitingReroll && core.shown?.model?.status !== "pending") return;
	const model = core.plannerModel(settings);
	if (model?.status === "pending") startPlanner(core, state, core.generation);
	else if (awaitingReroll) core.serve(state, model);
	else if (model) reportPlannerStatus(core, state, model);
}

export function startPlanner(
	core: SessionCore,
	state: TurnState,
	gen: number,
): void {
	core.track(
		planModel(core, state, gen).catch((error: unknown) => {
			core.options.log?.("the planner failed", error);
			if (core.isCurrent(gen, state) && core.awaitingReroll())
				reportPlannerStatus(core, state, { status: "error" });
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
		const attempt = await generatePool(complete, input, kinds, settings);
		const chat = state.turn.chat ?? core.lastChat;
		if ("reason" in attempt && attempt.reason === "no_provider")
			slot?.release();
		else
			slot?.record({
				costUsd: attempt.costUsd,
				providerId: attempt.providerId ?? chat?.providerId,
				modelId: attempt.modelId ?? chat?.modelId,
			});
		if (!core.isCurrent(gen, state)) return;
		if ("reason" in attempt) {
			core.options.log?.(
				`model suggestions unavailable (${attempt.reason}); the rule-based set stays`,
				attempt.error,
			);
			reportPlannerStatus(core, state, {
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

/**
 * The rule-based set stays on screen; only its model status changes. A
 * reroll that was waiting on the planner gets the rules' next page instead.
 */
function reportPlannerStatus(
	core: SessionCore,
	state: TurnState,
	model: PlannerStatus,
): void {
	if (core.awaitingReroll()) {
		core.serve(state, model);
		return;
	}
	const shown = core.shown;
	if (shown?.turnKey !== state.turn.turnKey) return;
	const { paused: _paused, ...rest } = shown;
	const paused = pausedOf(model);
	const updated: OfferedSet = {
		...rest,
		model,
		...(paused ? { paused } : {}),
	};
	const index = state.offers.findIndex(
		(offer) => offer.offerId === updated.offerId,
	);
	if (index !== -1) state.offers[index] = updated;
	core.pushState(trayState(state, updated.candidates), {
		turnKey: state.turn.turnKey,
		rerollsLeft: rerollsLeft(state),
		set: updated,
	});
}
