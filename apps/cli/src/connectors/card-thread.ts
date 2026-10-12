/**
 * Posting a card's messages so they read as belonging to the card.
 *
 * A conversation that runs several cards at once used to be a flat stream: a question from one
 * card sat between two progress lines from another, and nothing said which belonged to which.
 *
 * The obvious way to tie them -- a platform reply to the card's anchor -- is not available:
 * the Telegram adapter in use implements no `reply`, so asking for one throws
 * `NotImplementedError` and the message would be lost or silently flattened. Measured, not
 * assumed: `reply_to_message_id` appears nowhere in that adapter's send path.
 *
 * So the tie is made in the text, with a line naming the card the message belongs to. It reads
 * the same on every surface and cannot fail, at the cost of not being tappable. When an
 * adapter does support replies, `postCardMessage` is the one place that has to change.
 */

/**
 * Prefixes a message with the card it belongs to.
 *
 * The reference is the card id alone: the anchor already carries the column and the title, and
 * repeating the coloured dot here would put two of them in the same thread showing the same
 * thing -- which is the confusion this was meant to remove.
 *
 * It goes into the text before any card is built from it, because a rendered card is what the
 * surface shows; a reference added only to the fallback would never be seen.
 */
export function buildCardReference(taskId: string, text: string): string {
	return `\u21b3 ${taskId}\n${text}`;
}
