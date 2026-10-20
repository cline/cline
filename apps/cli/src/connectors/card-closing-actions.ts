import type { HubUINotifyAction } from "@cline/shared";

import type { CardButton } from "./card-question-message";
import {
	type AnswerKanbanCardDependencies,
	type CardReplyResult,
	describeKanbanFailure,
	runKanban,
	type TrackedCardMessage,
} from "./kanban-card-reply";

/**
 * Closing a finished card from the conversation: the step still missing to get its work onto
 * its base, and Concluir. Kanban decides which ones apply, from git; this only renders them and
 * runs the command each one names.
 *
 * A separate prefix from the question buttons (`kbq:`), because a tap here runs a command
 * rather than typing an answer into the card's session.
 */

const PREFIX = "kba";

export type ClosingActionId =
	| "integrate"
	| "push"
	| "done"
	| "done!"
	| "cancel";

/** The commands a tap can end in: the confirmed Concluir runs `done`, Cancelar runs nothing. */
export type ClosingCommand = HubUINotifyAction["id"];

const CLOSING_ACTION_IDS = new Set<string>([
	"integrate",
	"push",
	"done",
	"done!",
	"cancel",
]);

function isClosingActionId(
	value: string | undefined,
): value is ClosingActionId {
	return value !== undefined && CLOSING_ACTION_IDS.has(value);
}

export function buildClosingActionId(
	taskId: string,
	action: ClosingActionId,
): string {
	return `${PREFIX}:${taskId}:${action}`;
}

export function parseClosingActionId(
	actionId: string | undefined,
): { taskId: string; action: ClosingActionId } | undefined {
	const parts = actionId?.split(":");
	if (!parts || parts.length !== 3 || parts[0] !== PREFIX) {
		return undefined;
	}
	const taskId = parts[1]?.trim();
	const action = parts[2];
	if (!taskId || !isClosingActionId(action)) {
		return undefined;
	}
	return { taskId, action };
}

export function buildClosingButtons(
	taskId: string,
	actions: readonly HubUINotifyAction[],
): CardButton[] {
	return actions.map((action) => ({
		label: action.label,
		actionId: buildClosingActionId(taskId, action.id),
	}));
}

export function buildConfirmButtons(taskId: string): CardButton[] {
	return [
		{
			label: "Concluir mesmo assim",
			actionId: buildClosingActionId(taskId, "done!"),
		},
		{ label: "Cancelar", actionId: buildClosingActionId(taskId, "cancel") },
	];
}

export function buildClosingCommandArgs(
	card: TrackedCardMessage,
	action: ClosingCommand,
): string[] {
	return [
		"task",
		action,
		"--task-id",
		card.taskId,
		"--project-path",
		card.projectPath,
	];
}

/** What the command printed for a person, when it printed something: a push's output. */
function readOutput(stdout: string): string | undefined {
	try {
		const parsed = JSON.parse(stdout) as { output?: unknown };
		return typeof parsed.output === "string" && parsed.output.trim()
			? parsed.output.trim()
			: undefined;
	} catch {
		return undefined;
	}
}

/** What a refusal names, as the person would say it. */
const CLOSING_ACTION_NOUNS: Record<ClosingCommand, string> = {
	integrate: "the integration",
	push: "the push",
	done: "Concluir",
};

export async function runClosingAction(
	card: TrackedCardMessage,
	action: ClosingCommand,
	deps: AnswerKanbanCardDependencies = {},
): Promise<CardReplyResult> {
	const run = deps.run ?? runKanban;
	try {
		const { stdout } = await run(buildClosingCommandArgs(card, action));
		return { ok: true, message: readOutput(stdout) ?? "" };
	} catch (error) {
		return {
			ok: false,
			message: describeKanbanFailure(error, CLOSING_ACTION_NOUNS[action]),
		};
	}
}

/**
 * What Concluir would discard, from `kanban task closing-state` -- git as it is now. A notification
 * can be older than the agent's latest commits, so the confirm it carried is not trusted.
 */
export async function readClosingConfirm(
	card: TrackedCardMessage,
	deps: AnswerKanbanCardDependencies = {},
): Promise<{ ok: true; confirm?: string } | { ok: false }> {
	const run = deps.run ?? runKanban;
	try {
		const { stdout } = await run([
			"task",
			"closing-state",
			"--task-id",
			card.taskId,
			"--project-path",
			card.projectPath,
		]);
		const parsed = JSON.parse(stdout) as { ok?: unknown; actions?: unknown };
		if (parsed.ok !== true || !Array.isArray(parsed.actions)) {
			return { ok: false };
		}
		const done = parsed.actions.find(
			(entry): entry is { id: "done"; confirm?: unknown } =>
				Boolean(entry) &&
				typeof entry === "object" &&
				(entry as { id?: unknown }).id === "done",
		);
		return typeof done?.confirm === "string" && done.confirm.trim()
			? { ok: true, confirm: done.confirm.trim() }
			: { ok: true };
	} catch {
		return { ok: false };
	}
}

export function describeClosingOutcome(
	action: ClosingCommand,
	label: string,
): string {
	if (action === "integrate") {
		// The agent is doing it now; its conclusion arrives as the next review notice.
		return `⏳ ${label}…`;
	}
	return action === "push" ? "✅ Push feito" : "🟢 Concluído";
}

export type ClosingTapDecision =
	| { kind: "unknown" }
	| { kind: "cancel" }
	| { kind: "run"; action: ClosingCommand; label: string };

/** Which card a tap belongs to, and what command it names. Whether to ask first is not here. */
export function resolveClosingTap(
	card: TrackedCardMessage | undefined,
	tap: { taskId: string; action: ClosingActionId },
): ClosingTapDecision {
	if (!card || card.taskId !== tap.taskId) {
		return { kind: "unknown" };
	}
	if (tap.action === "cancel") {
		return { kind: "cancel" };
	}
	const action: ClosingCommand = tap.action === "done!" ? "done" : tap.action;
	const offered = card.actions?.find((entry) => entry.id === action);
	return {
		kind: "run",
		action,
		label: offered?.label ?? (action === "done" ? "Concluir" : action),
	};
}

const UNVERIFIED_DISCARD =
	"Não consegui verificar se há trabalho não integrado.";

export interface ClosingTapEffects {
	/** Rewrites the tapped message; without `buttons` its keyboard is removed. */
	edit(text: string, buttons?: CardButton[]): Promise<boolean>;
	post(text: string): Promise<void>;
	run(action: ClosingCommand): Promise<CardReplyResult>;
	/**
	 * What Concluir would discard, asked of git now. `confirm` is absent when nothing would be
	 * lost; `ok: false` when it could not be found out.
	 */
	readConfirm(): Promise<{ ok: true; confirm?: string } | { ok: false }>;
}

/**
 * Everything a tap on a closing button does, apart from the surface it happens on.
 *
 * Three guarantees, each from a defect: the keyboard comes off before the command runs, so a
 * slow push cannot be tapped twice; the message is rewritten from what was remembered on disk,
 * so a tap after a restart still shows its outcome; and Concluir asks git what it would discard
 * at the moment of the tap, because the button may come from a notification older than the
 * agent's latest commits.
 */
export async function handleClosingTap(input: {
	card: TrackedCardMessage | undefined;
	tap: { taskId: string; action: ClosingActionId };
	/** The tapped message, for the in-flight guard. */
	messageId: string;
	inFlight: Set<string>;
	effects: ClosingTapEffects;
}): Promise<void> {
	const { card, effects } = input;
	const decision = resolveClosingTap(card, input.tap);
	if (decision.kind === "unknown" || !card) {
		await effects.post("I no longer know which card that button belongs to.");
		return;
	}
	const baseText = card.text ?? "";
	const offered = buildClosingButtons(card.taskId, card.actions ?? []);
	if (decision.kind === "cancel") {
		await effects.edit(baseText, offered);
		return;
	}
	if (input.inFlight.has(input.messageId)) {
		return;
	}
	input.inFlight.add(input.messageId);
	try {
		if (input.tap.action === "done") {
			const fresh = await effects.readConfirm();
			const confirm = fresh.ok ? fresh.confirm : UNVERIFIED_DISCARD;
			if (confirm) {
				await effects.edit(
					`${baseText}\n\n⚠️ ${confirm}`,
					buildConfirmButtons(card.taskId),
				);
				return;
			}
		}
		await effects.edit(`${baseText}\n\n⏳ ${decision.label}…`);
		const result = await effects.run(decision.action);
		if (!result.ok) {
			// The buttons come back: a refused push or integrate can be tried again.
			await effects.edit(baseText, offered);
			await effects.post(result.message);
			return;
		}
		await effects.edit(
			`${baseText}\n\n${describeClosingOutcome(decision.action, decision.label)}`,
		);
		if (result.message) {
			await effects.post(result.message);
		}
	} finally {
		input.inFlight.delete(input.messageId);
	}
}
