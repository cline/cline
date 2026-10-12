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

/** A button as every card message carries it: what it says, and what a tap is routed by. */
export interface CardButton {
	label: string;
	actionId: string;
}

/** A question's choices as buttons, each answering with its own number. */
export function buildQuestionButtons(
	taskId: string,
	options: readonly string[],
): CardButton[] {
	return options.map((label, index) => ({
		label,
		actionId: buildCardActionId(taskId, index + 1),
	}));
}

export interface QuestionCardInput {
	/** The notification text, shown above the buttons and kept as the fallback. */
	text: string;
	buttons: readonly CardButton[];
}

/**
 * Returns nothing when there is nothing to choose: a notification with no options is an
 * announcement, and wrapping it in an empty card would only make it harder to read.
 */
export function buildQuestionCard(input: QuestionCardInput) {
	if (input.buttons.length === 0) {
		return undefined;
	}
	return toCardElement(
		jsxs(Card, {
			children: [
				jsx(Section, { children: jsx(CardText, { children: input.text }) }),
				jsxs(Actions, {
					children: input.buttons.map((button) =>
						jsx(Button, {
							id: button.actionId,
							children: button.label,
						}),
					),
				}),
			],
		}),
	);
}

/**
 * The question, rewritten for after it has been answered.
 *
 * A question whose buttons stay live is a question that can be answered twice. Reported from
 * use: "I can click several times because the button stays active and there is no indication
 * it was answered." Posting this text as a plain edit is what removes the keyboard -- an edit
 * carrying no card clears the markup -- so the rewrite and the deactivation are the same act.
 *
 * The chosen option is kept in the message rather than only in a reply, because the reply can
 * scroll away from the question while the question itself stays on screen.
 */
export function buildAnsweredQuestionText(
	questionText: string,
	chosenOption: string,
): string {
	const trimmed = questionText.trimEnd();
	return `${trimmed}\n\n✅ ${chosenOption}`;
}

/**
 * The question as it should read once it is a card with buttons.
 *
 * Two things are redundant the moment the choices are rendered as taps. The tool's name --
 * "AskUserQuestion: Gravar?" tells the person which internal tool asked, which is not a thing
 * they can act on; a question mark says the same in one character. And the numbered options,
 * which exist so a question can be answered by typing a number: with buttons on screen they
 * are the same list written twice, and the second copy is the one nobody needs.
 *
 * Both are kept when there are no choices to tap. The numbers are then the only way to answer,
 * and removing them would leave a question that cannot be replied to.
 */
export function formatQuestionBody(
	text: string,
	options: { hasChoices: boolean },
): string {
	let body = text.replace(
		/(^|\n)(?:Using\s+)?AskUserQuestion:\s*/g,
		(_match, lead: string) => `${lead}❓ `,
	);
	if (options.hasChoices) {
		// The numbered list the summary appends, and only at the end of a line: a question
		// whose own text contains "1)" keeps it.
		body = body.replace(/\s+—\s+1\)\s.*?(?=\n|$)/g, "");
	}
	return body.trimEnd();
}
