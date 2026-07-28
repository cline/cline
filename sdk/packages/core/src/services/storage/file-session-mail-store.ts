import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionMessage } from "@cline/shared";
import { safeJsonParse } from "@cline/shared";
import { resolveSessionMailDir } from "@cline/shared/storage";
import type { ListInboxOptions, SessionMailStore } from "../../types/storage";

export interface FileSessionMailStoreOptions {
	mailDir?: string;
}

/**
 * Append-only record types in `mail.jsonl`.
 *
 * The log is replayed to reconstruct current state rather than rewritten in
 * place. Appends of a single line are atomic under O_APPEND, so two processes
 * writing concurrently interleave lines instead of clobbering each other's
 * updates the way a read-modify-write of a JSON blob would.
 */
type MailLogRecord =
	| { k: "msg"; m: SerializedMessage }
	| { k: "delivered"; id: string; at: string }
	| { k: "read"; id: string; at: string }
	| { k: "dropped"; id: string; reason: string };

interface SerializedMessage
	extends Omit<SessionMessage, "sentAt" | "deliveredAt" | "readAt"> {
	sentAt: string;
	deliveredAt?: string;
	readAt?: string;
}

function serialize(message: SessionMessage): SerializedMessage {
	return {
		...message,
		sentAt: message.sentAt.toISOString(),
		deliveredAt: message.deliveredAt?.toISOString(),
		readAt: message.readAt?.toISOString(),
	};
}

function deserialize(raw: SerializedMessage): SessionMessage {
	return {
		...raw,
		hopChain: Array.isArray(raw.hopChain) ? raw.hopChain : [],
		sentAt: new Date(raw.sentAt),
		deliveredAt: raw.deliveredAt ? new Date(raw.deliveredAt) : undefined,
		readAt: raw.readAt ? new Date(raw.readAt) : undefined,
	};
}

export class FileSessionMailStore implements SessionMailStore {
	private readonly dirPath: string;
	private readonly logPath: string;

	constructor(options: FileSessionMailStoreOptions = {}) {
		this.dirPath = options.mailDir?.trim() || resolveSessionMailDir();
		this.logPath = join(this.dirPath, "mail.jsonl");
	}

	init(): void {
		this.ensureDir();
	}

	private ensureDir(): void {
		if (!existsSync(this.dirPath)) {
			mkdirSync(this.dirPath, { recursive: true });
		}
	}

	private appendRecord(record: MailLogRecord): void {
		this.ensureDir();
		appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
	}

	/** Replays the log into current message state, keyed by message id. */
	private replay(): Map<string, SessionMessage> {
		const messages = new Map<string, SessionMessage>();
		if (!existsSync(this.logPath)) {
			return messages;
		}
		let raw: string;
		try {
			raw = readFileSync(this.logPath, "utf8");
		} catch {
			return messages;
		}
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const record = safeJsonParse<MailLogRecord>(trimmed);
			if (!record || typeof record !== "object") {
				continue;
			}
			if (record.k === "msg") {
				try {
					messages.set(record.m.id, deserialize(record.m));
				} catch {
					// Skip records we cannot revive rather than failing the read.
				}
				continue;
			}
			const existing = messages.get(record.id);
			if (!existing || existing.status === "dropped") {
				continue;
			}
			if (record.k === "delivered" && existing.status === "pending") {
				existing.status = "delivered";
				existing.deliveredAt = new Date(record.at);
			} else if (record.k === "read") {
				existing.status = "read";
				existing.readAt = existing.readAt ?? new Date(record.at);
			} else if (record.k === "dropped") {
				existing.status = "dropped";
				existing.droppedReason = record.reason;
			}
		}
		return messages;
	}

	append(message: SessionMessage): void {
		this.appendRecord({ k: "msg", m: serialize(message) });
	}

	get(messageId: string): SessionMessage | undefined {
		return this.replay().get(messageId);
	}

	listInbox(
		sessionId: string,
		options: ListInboxOptions = {},
	): SessionMessage[] {
		const limit = options.limit && options.limit > 0 ? options.limit : 100;
		const all = Array.from(this.replay().values())
			.filter((message) => {
				if (message.toSessionId !== sessionId) {
					return false;
				}
				if (message.status === "dropped") {
					return false;
				}
				if (options.unreadOnly && message.readAt) {
					return false;
				}
				if (options.status && message.status !== options.status) {
					return false;
				}
				return true;
			})
			.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
		return all.slice(0, limit);
	}

	markDelivered(messageId: string): void {
		this.appendRecord({
			k: "delivered",
			id: messageId,
			at: new Date().toISOString(),
		});
	}

	markRead(messageIds: string[]): void {
		const at = new Date().toISOString();
		for (const id of messageIds) {
			this.appendRecord({ k: "read", id, at });
		}
	}

	markDropped(messageId: string, reason: string): void {
		this.appendRecord({ k: "dropped", id: messageId, reason });
	}

	countSentSince(fromSessionId: string, since: Date): number {
		let total = 0;
		for (const message of this.replay().values()) {
			if (
				message.fromSessionId === fromSessionId &&
				message.sentAt.getTime() >= since.getTime()
			) {
				total++;
			}
		}
		return total;
	}
}
