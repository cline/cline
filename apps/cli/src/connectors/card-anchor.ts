/**
 * The one message a card keeps in a conversation, and the shape of the thread hanging off it.
 *
 * Before this, a single card produced five unrelated messages in a row -- a progress line, a
 * "started" line, a question, an acknowledgement, a review notice -- and a person scrolling
 * back could not tell which belonged to which card, nor what state anything was in. The
 * complaint that prompted it: "visually it is still confusing, several messages arrive in
 * sequence and they are not very informative".
 *
 * So one message per card is posted and then edited for the card's whole life. It carries the
 * column as a coloured dot, matching the board's own column colours, and the line below says
 * what the card is doing right now. Everything else -- questions, answers, the review notice --
 * is posted as a reply to it, which is what gives the thread its shape and keeps the history
 * attached to the card it belongs to.
 */

/** Board columns, as the Kanban names them. */
export type CardColumn =
	| "backlog"
	| "in_progress"
	| "review"
	| "done"
	| "trash";

/**
 * Dots rather than words: the headline has to survive being read at a glance on a phone, and
 * the colours are the ones the board already uses for its columns, so the two read the same.
 */
const COLUMN_DOTS: Record<CardColumn, string> = {
	backlog: "⚪",
	in_progress: "🔵",
	review: "🟠",
	// The column whose id is `trash` is titled "Done" on the board and painted green there.
	// Red was wrong twice over: it contradicted the board, and it told someone their finished
	// card had been thrown away. `done` is the alias the CLI accepts for the same column.
	trash: "🟢",
	done: "🟢",
};

/** The dot for a column, falling back to the backlog grey for a column we do not know. */
export function resolveColumnDot(column: string | undefined): string {
	if (!column) {
		return COLUMN_DOTS.backlog;
	}
	return COLUMN_DOTS[column as CardColumn] ?? COLUMN_DOTS.backlog;
}

export interface CardAnchorInput {
	/** Card title, already short -- this is a headline, not the demand. */
	title: string;
	/** Short card id, so the message can be matched to the board by eye. */
	taskId: string;
	/** Column the card is in right now. */
	column?: string;
	/**
	 * The second line, as the notification already wrote it ("kanban · Bash").
	 *
	 * Taken whole rather than rebuilt from parts: the notification is the one that knows what
	 * the card is doing, and re-deriving it here would mean parsing a sentence to reassemble
	 * the same sentence.
	 */
	detail?: string;
}

const TITLE_MAX_LENGTH = 70;

function clipTitle(value: string): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	if (collapsed.length <= TITLE_MAX_LENGTH) {
		return collapsed;
	}
	const clipped = collapsed.slice(0, TITLE_MAX_LENGTH);
	const lastSpace = clipped.lastIndexOf(" ");
	const base =
		lastSpace > TITLE_MAX_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped;
	return `${base.trimEnd()}…`;
}

/**
 * The anchor's text. Two lines at most: what the card is, and what it is doing.
 *
 * The second line is dropped entirely when there is nothing to say, rather than left blank or
 * filled with a placeholder -- a card sitting in review has nothing to report, and saying so
 * is what made the old stream of messages noise.
 */
export function buildCardAnchorText(input: CardAnchorInput): string {
	const headline = `${resolveColumnDot(input.column)} ${clipTitle(input.title)} · ${input.taskId}`;
	const detail = input.detail?.replace(/\s+/g, " ").trim();
	return detail ? `${headline}\n${detail}` : headline;
}
