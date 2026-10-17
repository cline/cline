import { REROLL_LIMIT } from "../../config";
import { sendable } from "../candidates";
import { labelHeader } from "../labels/labels";
import type { OfferedSet, TrayAction, TrayPush } from "../tray/tray";
import type { SessionCore } from "./core";
import { startPlanner } from "./planner-call";
import {
	exclude,
	rerollsLeft,
	rowFields,
	rowOf,
	type TurnState,
} from "./turn-state";

/** What an action Next would not apply asks the host to do instead: show the stale line, or offer Use only. */
export type TrayRefusal = "stale" | "unsendable";

/** The label verb a refused Send or Use would have recorded. */
const STALE_VERB: Partial<Record<TrayAction["type"], string>> = {
	send: "do",
	use: "adjust",
};

/** The offer an action names, or the set on screen when it names none. */
function resolveOffer(
	core: SessionCore,
	offerId: string | undefined,
): OfferedSet | undefined {
	if (!offerId) return core.shown;
	return core.state?.offers.findLast((offer) => offer.offerId === offerId);
}

/**
 * A tray action, answered with the push the tray should show next and,
 * when Next would not apply it, why. Skip, Unskip and Reroll serve a new
 * set from the same turn; Use, Send, Exposed, Hide and Label update state
 * and labels. An action naming a set when none is on screen (after `off`,
 * or while a run is going) is refused as stale.
 */
export function invoke(
	core: SessionCore,
	action: TrayAction,
): { push: TrayPush; refused?: TrayRefusal } {
	if (action.type === "label") {
		if (action.event === "undo_adjust")
			forgetUse(core, action.offerId, action.fields?.candidateId);
		core.label({
			...action.fields,
			...labelHeader(
				action.event,
				new Date(),
				resolveOffer(core, action.offerId) ?? {
					sessionId: core.options.sessionId,
					offerId: action.offerId,
					turnKey: core.lastTurn?.turnKey,
					runCount: core.lastTurn?.runCount,
				},
			),
		});
		return { push: core.currentPush() };
	}
	if (action.type === "hide") {
		core.labelFor(core.shown, "hidden_by_user", { scope: action.scope });
		if (action.scope === "chat") {
			core.hiddenForChat = true;
			core.persist();
		}
		return { push: core.off("hidden") };
	}
	const state = core.state;
	const current = core.shown;
	const computing = core.lastPush?.state === "computing";
	if (!state || !current) {
		if (computing && action.offerId)
			core.labelFor(undefined, "refused_stale", {
				offerId: action.offerId,
				reason: "computing",
				verb: STALE_VERB[action.type],
			});
		return { push: core.currentPush(), refused: "stale" };
	}
	const target = computing ? undefined : resolveOffer(core, action.offerId);
	if (!target) {
		core.labelFor(current, "refused_stale", {
			reason: computing ? "computing" : "set_changed",
			verb: STALE_VERB[action.type],
		});
		return { push: core.currentPush(), refused: "stale" };
	}
	const refused = apply(core, state, current, target, action);
	return { push: core.currentPush(), ...(refused ? { refused } : {}) };
}

/** A Use the host cleared no longer explains the next message, which is then labelled from its text. */
function forgetUse(
	core: SessionCore,
	offerId: string | undefined,
	candidateId: unknown,
): void {
	const state = core.state;
	const intent = state?.pendingIntent;
	if (
		!state ||
		intent?.verb !== "use" ||
		intent.candidate.id !== candidateId ||
		(offerId !== undefined && intent.offer.offerId !== offerId)
	)
		return;
	state.pendingIntent = undefined;
	core.persist();
}

function apply(
	core: SessionCore,
	state: TurnState,
	current: OfferedSet,
	target: OfferedSet,
	action: Exclude<TrayAction, { type: "label" | "hide" }>,
): TrayRefusal | undefined {
	switch (action.type) {
		case "exposed":
			state.exposedOffers.add(target.offerId);
			core.labelFor(target, "exposed", { candidateId: action.candidateId });
			core.persist();
			return;
		case "use":
		case "send": {
			const row = rowOf(target, action.candidateId);
			if (!row) return;
			if (action.type === "send" && !sendable(row.item)) {
				core.labelFor(target, "key_inert", {
					...rowFields(row.item, row.index),
					reason: "unsendable",
					input: action.input,
				});
				return "unsendable";
			}
			if (action.type === "use")
				core.labelFor(target, "adjust", {
					...rowFields(row.item, row.index),
					input: action.input,
					msSinceExposed: action.msSinceExposed,
				});
			state.pendingIntent = {
				verb: action.type,
				offer: target,
				candidate: row.item,
				position: row.index,
				input: action.input,
				msSinceExposed: action.msSinceExposed,
				at: Date.now(),
			};
			core.persist();
			return;
		}
		case "unskip": {
			const prompt = state.excludedIds.get(action.candidateId);
			if (!prompt) return;
			state.excludedIds.delete(action.candidateId);
			const index = state.excluded.indexOf(prompt);
			if (index !== -1) state.excluded.splice(index, 1);
			core.labelFor(target, "undo_skip", {
				candidateId: action.candidateId,
				input: action.input,
			});
			core.serve(state, current.model);
			return;
		}
		case "skip": {
			const row = rowOf(target, action.candidateId);
			if (!row) return;
			core.labelFor(target, "skip", {
				...rowFields(row.item, row.index),
				input: action.input,
				msSinceExposed: action.msSinceExposed,
			});
			exclude(state, [row.item]);
			core.serve(state, current.model);
			return;
		}
		case "reroll":
			reroll(core, state, current, target, action);
	}
}

function reroll(
	core: SessionCore,
	state: TurnState,
	current: OfferedSet,
	target: OfferedSet,
	action: Extract<TrayAction, { type: "reroll" }>,
): void {
	if (state.rerollsUsed >= REROLL_LIMIT) {
		core.serve(state, current.model, []);
		return;
	}
	state.rerollsUsed += 1;
	const excludedIds = target.candidates.map((item) => item.id);
	core.labelFor(target, "reroll", {
		rerollIndex: state.rerollsUsed,
		excluded: excludedIds.length > 0 ? excludedIds : undefined,
		input: action.input,
		cause: action.cause,
	});
	exclude(state, target.candidates);
	const poolLeft = state.pool?.some(
		(item) => !state.excluded.includes(item.prompt),
	);
	if (
		!poolLeft &&
		!state.planning &&
		core.plannerModel(core.options.settings())?.status === "pending"
	) {
		core.pushState("computing", {
			turnKey: state.turn.turnKey,
			rerollsLeft: rerollsLeft(state),
			computingFor: "reroll",
		});
		startPlanner(core, state, core.generation);
		return;
	}
	core.serve(state, current.model);
}
