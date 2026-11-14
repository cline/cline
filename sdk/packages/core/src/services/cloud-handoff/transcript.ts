function comparableMessages(messages: readonly unknown[]): unknown[] {
	return messages.map((message) => {
		const record =
			message && typeof message === "object"
				? (message as Record<string, unknown>)
				: {};
		return { role: record.role, content: record.content };
	});
}

/** Compares the durable JSON wire shape, including image content and order. */
export function cloudHandoffTranscriptsEqual(
	localMessages: readonly unknown[],
	cloudMessages: readonly unknown[],
): boolean {
	return (
		localMessages.length === cloudMessages.length &&
		JSON.stringify(comparableMessages(localMessages)) ===
			JSON.stringify(comparableMessages(cloudMessages))
	);
}

export class CloudHandoffTranscriptMismatchError extends Error {
	constructor(localCount: number, cloudCount: number) {
		super(
			`Cloud transcript verification failed (local ${localCount} messages, cloud ${cloudCount}).`,
		);
		this.name = "CloudHandoffTranscriptMismatchError";
	}
}
