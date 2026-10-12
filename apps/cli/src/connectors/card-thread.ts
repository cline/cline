/**
 * Posting a card's messages so they hang off the card's own anchor.
 *
 * A conversation that runs several cards at once used to be a flat stream: a question from one
 * card sat between two progress lines from another, and nothing said which belonged to which.
 * Replying to the anchor is what gives the thread its shape -- the question, the answer and the
 * review notice stay attached to the card they are about, and tapping the reply jumps to it.
 *
 * The thread is taken as an interface rather than the adapter's own type so this can be tested
 * without a chat platform behind it.
 */

export type CardMessagePayload<TCard> =
	| { raw: string }
	| { card: TCard; fallbackText: string };

export interface CardPostingThread<TSent, TCard> {
	post(message: CardMessagePayload<TCard>): Promise<TSent>;
	reply(target: string, message: CardMessagePayload<TCard>): Promise<TSent>;
}

export interface PostCardMessageInput<TSent, TCard> {
	thread: CardPostingThread<TSent, TCard>;
	/** The card's anchor, when one exists. Absent means this message stands on its own. */
	anchor?: { id: string };
	/** The rendered card, when the message carries choices. */
	card?: TCard;
	/** The text, which is also what a surface that cannot render a card falls back to. */
	text: string;
}

function toPayload<TCard>(
	card: TCard | undefined,
	text: string,
): CardMessagePayload<TCard> {
	return card === undefined ? { raw: text } : { card, fallbackText: text };
}

/**
 * Posts as a reply to the anchor, or on its own when there is no anchor to hang from.
 *
 * A failed reply falls through to a plain post rather than propagating: the anchor can have
 * been deleted by hand, and losing a question because the message it pointed at is gone would
 * leave the card waiting forever on an answer that was never asked for.
 */
export async function postCardMessage<TSent extends { id: string }, TCard>(
	input: PostCardMessageInput<TSent, TCard>,
): Promise<TSent> {
	const payload = toPayload(input.card, input.text);
	if (!input.anchor) {
		return await input.thread.post(payload);
	}
	try {
		return await input.thread.reply(input.anchor.id, payload);
	} catch {
		return await input.thread.post(payload);
	}
}
