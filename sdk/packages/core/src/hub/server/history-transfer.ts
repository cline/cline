import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { extractSessionId } from "./handlers/context";

const CHUNK_LENGTH = 128 * 1024;
const TRANSFER_TIMEOUT_MS = 5 * 60_000;
const RETAINED_BYTE_LIMIT = 64 * 1024 * 1024;

type Transfer = {
	owner: object;
	clientId: string | undefined;
	sessionId: string;
	text: string;
	offset: number;
	timer: ReturnType<typeof setTimeout>;
	state: "reading" | "ready" | "closed";
};

function closedReply(envelope: HubCommandEnvelope): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: false,
		error: {
			code: "history_transfer_closed",
			message: "History transfer closed",
		},
	};
}

/** Pins an opt-in history reply while the connection pulls bounded chunks. */
export class HistoryTransferPool {
	private readonly transfers = new Map<string, Transfer>();
	private retainedBytes = 0;
	private readonly available = new EventEmitter();

	async command(
		envelope: HubCommandEnvelope,
		owner: object,
		read: () => Promise<HubReplyEnvelope>,
		signal: AbortSignal,
	): Promise<HubReplyEnvelope> {
		const cursor = envelope.payload?.historyCursor;
		if (cursor !== undefined) {
			if (typeof cursor !== "string") throw new Error("Invalid history cursor");
			const [key] = cursor.split(":");
			const transfer = this.transfers.get(key);
			if (
				!transfer ||
				transfer.owner !== owner ||
				transfer.clientId !== envelope.clientId ||
				transfer.sessionId !== extractSessionId(envelope) ||
				transfer.state !== "ready" ||
				cursor !== `${key}:${transfer.offset}`
			)
				throw new Error("History transfer expired or cursor is invalid");
			return this.chunk(envelope, key, transfer);
		}
		try {
			signal.throwIfAborted();
			while (this.transfers.size >= 2) {
				if (this.available.listenerCount("slot") >= 8)
					throw new Error("History transfers are busy");
				await once(this.available, "slot", { signal });
				signal.throwIfAborted();
			}
		} catch (error) {
			if (signal.aborted) return closedReply(envelope);
			throw error;
		}
		const key = randomUUID();
		const transfer: Transfer = {
			owner,
			clientId: envelope.clientId,
			sessionId: extractSessionId(envelope),
			text: "",
			offset: 0,
			state: "reading",
			timer: setTimeout(() => this.release(key), TRANSFER_TIMEOUT_MS),
		};
		transfer.timer.unref();
		this.transfers.set(key, transfer);
		const cancel = () => this.release(key);
		signal.addEventListener("abort", cancel, { once: true });
		try {
			const reply = await read();
			if (transfer.state === "closed") return closedReply(envelope);
			if (!reply.ok) {
				this.release(key);
				return reply;
			}
			const text = JSON.stringify(reply.payload?.messages ?? []);
			const bytes = Buffer.byteLength(text);
			if (bytes + this.retainedBytes > RETAINED_BYTE_LIMIT) {
				throw new Error("History transfer exceeds the retained byte limit");
			}
			transfer.text = text;
			transfer.state = "ready";
			this.retainedBytes += bytes;
			return this.chunk(envelope, key, transfer);
		} catch (error) {
			this.release(key);
			throw error;
		} finally {
			signal.removeEventListener("abort", cancel);
			if (transfer.state === "closed") {
				this.transfers.delete(key);
				this.available.emit("slot");
			}
		}
	}

	close(owner: object): void {
		for (const [key, transfer] of this.transfers) {
			if (transfer.owner === owner) this.release(key);
		}
	}

	private chunk(
		envelope: HubCommandEnvelope,
		key: string,
		transfer: Transfer,
	): HubReplyEnvelope {
		// JSON escaping uses at most six bytes per UTF-16 code unit.
		const historyChunk = transfer.text.slice(
			transfer.offset,
			transfer.offset + CHUNK_LENGTH,
		);
		transfer.offset += historyChunk.length;
		const historyCursor =
			transfer.offset < transfer.text.length
				? `${key}:${transfer.offset}`
				: undefined;
		if (!historyCursor) this.release(key);
		return {
			version: envelope.version,
			requestId: envelope.requestId,
			ok: true,
			payload: { historyChunk, ...(historyCursor ? { historyCursor } : {}) },
		};
	}

	private release(key: string): void {
		const transfer = this.transfers.get(key);
		if (!transfer) return;
		clearTimeout(transfer.timer);
		// Closing a connection cannot cancel its underlying file read.
		if (transfer.state !== "ready") {
			transfer.state = "closed";
			return;
		}
		this.retainedBytes -= Buffer.byteLength(transfer.text);
		this.transfers.delete(key);
		this.available.emit("slot");
	}
}
