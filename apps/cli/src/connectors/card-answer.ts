/**
 * Turning what a person naturally types into what the card's prompt actually accepts.
 *
 * Measured on 11/10/2026 with a real person: the notification showed
 * "Qual fruta você prefere? — 1) Manga 2) Caju", they replied "Manga", and the connector
 * answered "Passed to card e192e." -- which was true and useless. The text did reach the
 * agent's terminal, where an interactive selection ignored it, and the card sat waiting.
 *
 * The connector is not guessing here: it displayed those options itself, so it knows that
 * "Manga" is choice 1. Anything it cannot place is refused with the choices repeated, because
 * "passed it on" for an answer that will be ignored is worse than saying nothing.
 */

export type CardAnswer =
	| { kind: "send"; text: string }
	| { kind: "ask"; message: string };

/** Options as they were written into the notification: `1) Manga 2) Caju`. */
export function parseNotifiedOptions(notificationText: string): string[] {
	const options: string[] = [];
	// Each option runs until the next "<n>)" or the end. Written as a single pass so an option
	// label containing a digit does not split it.
	const pattern = /(\d+)\)\s*([^\n]*?)(?=\s+\d+\)|$)/g;
	for (const match of notificationText.matchAll(pattern)) {
		const index = Number(match[1]);
		const label = match[2]?.trim();
		if (label && index === options.length + 1) {
			options.push(label);
		}
	}
	return options;
}

function fold(value: string): string {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.toLocaleLowerCase();
}

export function resolveCardAnswer(
	reply: string,
	options: readonly string[],
): CardAnswer {
	const text = reply.trim();
	if (!text) {
		return { kind: "ask", message: "Nothing to pass on: the reply was empty." };
	}
	// A prompt with no choices takes free text, which is the ordinary case: an idle agent
	// waiting for its next instruction.
	if (options.length === 0) {
		return { kind: "send", text };
	}
	const asNumber = Number(text);
	if (
		Number.isInteger(asNumber) &&
		asNumber >= 1 &&
		asNumber <= options.length
	) {
		return { kind: "send", text: String(asNumber) };
	}
	const folded = fold(text);
	const exact = options.findIndex((option) => fold(option) === folded);
	if (exact >= 0) {
		return { kind: "send", text: String(exact + 1) };
	}
	// A single unambiguous prefix is still the person being clear, just briefer.
	const prefixed = options.filter((option) => fold(option).startsWith(folded));
	if (folded.length > 0 && prefixed.length === 1) {
		return {
			kind: "send",
			text: String(options.indexOf(prefixed[0] as string) + 1),
		};
	}
	const listed = options
		.map((option, index) => `${index + 1}) ${option}`)
		.join("  ");
	return {
		kind: "ask",
		message: `That card is waiting on a choice, so I did not pass this on. Reply with: ${listed}`,
	};
}
