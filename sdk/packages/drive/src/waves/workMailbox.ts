import { newId, nowIso, type DriveWorkMessage } from "./types";

/** Inter-worker message bus. Supports direct and broadcast (`to: "*"`) delivery. */
export class DriveWorkMailbox {
	#messages: DriveWorkMessage[] = [];

	get messages(): readonly DriveWorkMessage[] {
		return this.#messages;
	}

	send(
		input: Omit<DriveWorkMessage, "id" | "createdAt"> & {
			id?: string;
			createdAt?: string;
		},
	): DriveWorkMessage {
		const message: DriveWorkMessage = {
			id: input.id ?? newId("wmsg"),
			from: input.from,
			to: input.to,
			topic: input.topic,
			body: input.body,
			createdAt: input.createdAt ?? nowIso(),
		};
		this.#messages.push(message);
		return message;
	}

	/** Messages addressed to recipient or broadcast. */
	inbox(recipient: string, topic?: string): DriveWorkMessage[] {
		return this.#messages.filter((message) => {
			const addressed = message.to === "*" || message.to === recipient;
			const topicOk = topic === undefined || message.topic === topic;
			return addressed && topicOk;
		});
	}

	snapshot(): DriveWorkMessage[] {
		return this.#messages.map((message) => ({ ...message, body: { ...message.body } }));
	}

	restore(messages: readonly DriveWorkMessage[]): void {
		this.#messages = messages.map((message) => ({
			...message,
			body: { ...message.body },
		}));
	}

	clear(): void {
		this.#messages = [];
	}
}
