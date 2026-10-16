import type { ComposerSuggestionsAction } from "@cline/shared";
import type { TrayAction } from "./tray";

/**
 * The tray actions one slot verb asks of Next, or undefined for a verb Next
 * does not know. Presence and `show` ask for none: the plugin answers those
 * itself. Labels the host records go through Next's own label events, with
 * fields Next chooses.
 */
export function toTrayActions(
	action: ComposerSuggestionsAction,
): TrayAction[] | undefined {
	switch (action.verb) {
		case "attach":
		case "detach":
		case "show":
			return [];
		case "exposed":
			return action.itemIds.map((candidateId) => ({
				type: "exposed",
				offerId: action.revision,
				candidateId,
			}));
		case "use":
		case "send":
		case "skip":
			return [
				{
					type: action.verb,
					candidateId: action.itemId,
					offerId: action.revision,
					input: action.input,
					...(action.msSinceExposed === undefined
						? {}
						: { msSinceExposed: action.msSinceExposed }),
				},
			];
		case "unskip":
			return [
				{
					type: "unskip",
					candidateId: action.itemId,
					offerId: action.revision,
					input: action.input,
				},
			];
		case "refresh":
			return [
				{
					type: "reroll",
					offerId: action.revision,
					input: action.input,
					cause: action.cause,
				},
			];
		case "hide":
			return action.scope === "chat"
				? [{ type: "hide", scope: "chat" }]
				: [
						{
							type: "label",
							event: "ignored",
							...(action.revision ? { offerId: action.revision } : {}),
							fields: { input: action.input },
						},
					];
		case "clear":
		case "undo":
			return [
				{
					type: "label",
					event: action.verb === "clear" ? "undo_adjust" : "undo_turn",
					offerId: action.revision,
					fields: { candidateId: action.itemId },
				},
			];
		case "signal":
			return [
				{
					type: "label",
					event: "key_inert",
					...(action.revision ? { offerId: action.revision } : {}),
					fields: { reason: action.reason },
				},
			];
		default:
			return undefined;
	}
}
