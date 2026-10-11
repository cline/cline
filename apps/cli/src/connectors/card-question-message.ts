import { Actions, Button, Card, CardText, Section, toCardElement } from "chat";
import { jsx, jsxs } from "chat/jsx-runtime";

/**
 * A card's question as buttons, instead of a line asking someone to type a number.
 *
 * Measured with a real person on 11/10/2026: shown "1) Manga 2) Caju", they replied "Manga",
 * which the terminal's interactive selection ignored. Translating the name to its number fixed
 * the dead end, but the person still had to read a list and type. A button is the answer they
 * expected, and the Telegram adapter renders one as an inline keyboard.
 *
 * The id carried by each button is the whole routing: which card, and which choice. It travels
 * through Telegram as `callback_data`, which is capped at 64 bytes -- a task id is five
 * characters, so the budget is not a concern, but the format stays short for that reason.
 */

const PREFIX = "kbq";

export function buildCardActionId(taskId: string, optionIndex: number): string {
	return `${PREFIX}:${taskId}:${optionIndex}`;
}

export function parseCardActionId(
	actionId: string | undefined,
): { taskId: string; optionIndex: number } | undefined {
	const parts = actionId?.split(":");
	if (!parts || parts.length !== 3 || parts[0] !== PREFIX) {
		return undefined;
	}
	const taskId = parts[1]?.trim();
	const optionIndex = Number(parts[2]);
	if (!taskId || !Number.isInteger(optionIndex) || optionIndex < 1) {
		return undefined;
	}
	return { taskId, optionIndex };
}

export interface QuestionCardInput {
	/** The notification text, shown above the buttons and kept as the fallback. */
	text: string;
	taskId: string;
	options: readonly string[];
}

/**
 * Returns nothing when there is nothing to choose: a notification with no options is an
 * announcement, and wrapping it in an empty card would only make it harder to read.
 */
export function buildQuestionCard(input: QuestionCardInput) {
	if (input.options.length === 0) {
		return undefined;
	}
	return toCardElement(
		jsxs(Card, {
			children: [
				jsx(Section, { children: jsx(CardText, { children: input.text }) }),
				jsxs(Actions, {
					children: input.options.map((label, index) =>
						jsx(Button, {
							id: buildCardActionId(input.taskId, index + 1),
							children: label,
						}),
					),
				}),
			],
		}),
	);
}
