import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { type FileHandle, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { extractSessionId } from "./handlers/context";
import { logHubMessage } from "./hub-server-logging";

// Leave room for the UTF-8 decoder's carry without exceeding 128 Ki code units.
const CHUNK_BYTES = 128 * 1024 - 4;
const TRANSFER_TIMEOUT_MS = 5 * 60_000;

type Snapshot = {
	file: FileHandle;
	size: number;
	offset: number;
	decoder: TextDecoder;
	reading: boolean;
};

type Transfer = {
	clientId: string | undefined;
	sessionId: string;
	snapshot: Promise<Snapshot | undefined>;
	cancelled: boolean;
	timer: ReturnType<typeof setTimeout>;
	cleanup?: Promise<void>;
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

/** Pins opt-in history in an anonymous file while its connection pulls chunks. */
export class HistoryTransferPool {
	private readonly owners = new Map<object, Map<string, Transfer>>();
	private preparations = 0;
	private readonly available = new EventEmitter().setMaxListeners(0);

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
			const transfer = this.owners.get(owner)?.get(key);
			if (
				!transfer ||
				transfer.clientId !== envelope.clientId ||
				transfer.sessionId !== extractSessionId(envelope)
			) {
				throw new Error("History transfer expired or cursor is invalid");
			}
			const cancel = () => {
				void this.release(owner, key);
			};
			if (signal.aborted) {
				await this.release(owner, key);
				return closedReply(envelope);
			}
			signal.addEventListener("abort", cancel, { once: true });
			try {
				return await this.chunk(envelope, owner, key, transfer, cursor);
			} finally {
				signal.removeEventListener("abort", cancel);
			}
		}

		const deadline = Date.now() + TRANSFER_TIMEOUT_MS;
		const boundedSignal = AbortSignal.any([
			signal,
			AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
		]);
		try {
			boundedSignal.throwIfAborted();
			while (
				this.preparations >= 2 ||
				(this.owners.get(owner)?.size ?? 0) >= 2
			) {
				await once(this.available, "slot", { signal: boundedSignal });
				boundedSignal.throwIfAborted();
			}
		} catch (error) {
			if (boundedSignal.aborted) return closedReply(envelope);
			throw error;
		}

		this.preparations++;
		const key = randomUUID();
		let resolveSnapshot!: (snapshot: Snapshot | undefined) => void;
		const prepared = new Promise<Snapshot | undefined>((resolve) => {
			resolveSnapshot = resolve;
		});
		const transfer: Transfer = {
			clientId: envelope.clientId,
			sessionId: extractSessionId(envelope),
			snapshot: prepared,
			cancelled: false,
			timer: setTimeout(() => {
				void this.release(owner, key);
			}, deadline - Date.now()),
		};
		transfer.timer.unref();
		const entries = this.owners.get(owner) ?? new Map<string, Transfer>();
		this.owners.set(owner, entries);
		entries.set(key, transfer);
		const cancel = () => {
			void this.release(owner, key);
		};
		boundedSignal.addEventListener("abort", cancel, { once: true });
		let snapshot: Snapshot | undefined;
		try {
			let reply: HubReplyEnvelope;
			try {
				reply = await read();
				if (reply.ok && !transfer.cancelled) {
					snapshot = await this.capture(
						key,
						reply.payload?.messages ?? [],
						transfer,
					);
					reply = { version: envelope.version, ok: true };
				}
			} catch (error) {
				const cancelled = transfer.cancelled;
				resolveSnapshot(snapshot);
				await this.release(owner, key);
				if (cancelled) return closedReply(envelope);
				throw error;
			} finally {
				resolveSnapshot(snapshot);
				this.preparations--;
				this.available.emit("slot");
			}
			if (transfer.cancelled) {
				await this.release(owner, key);
				return closedReply(envelope);
			}
			if (!reply.ok) {
				await this.release(owner, key);
				return reply;
			}
			return await this.chunk(envelope, owner, key, transfer);
		} finally {
			boundedSignal.removeEventListener("abort", cancel);
		}
	}

	async close(owner: object): Promise<void> {
		await Promise.all(
			Array.from(this.owners.get(owner)?.keys() ?? [], (key) =>
				this.release(owner, key),
			),
		);
	}

	private async capture(
		key: string,
		messages: unknown,
		transfer: Transfer,
	): Promise<Snapshot | undefined> {
		const directory = join(resolveClineDataDir(), "history-transfers");
		await mkdir(directory, { recursive: true, mode: 0o700 });
		if (transfer.cancelled) return undefined;
		const path = join(directory, `${key}.json`);
		const file = await open(path, "wx+", 0o600);
		let linked = true;
		let captured = false;
		try {
			// Unlink before writing history: close/process exit reclaims the snapshot.
			await unlink(path);
			linked = false;
			if (transfer.cancelled) return undefined;
			await file.writeFile(JSON.stringify(messages), "utf8");
			const { size } = await file.stat();
			if (transfer.cancelled) return undefined;
			captured = true;
			return {
				file,
				size,
				offset: 0,
				decoder: new TextDecoder("utf-8", { fatal: true }),
				reading: false,
			};
		} finally {
			if (!captured) await file.close();
			if (linked) {
				await unlink(path).catch((error) => {
					logHubMessage("warn", "history transfer empty-file cleanup failed", {
						error,
					});
				});
			}
		}
	}

	private async chunk(
		envelope: HubCommandEnvelope,
		owner: object,
		key: string,
		transfer: Transfer,
		cursor?: string,
	): Promise<HubReplyEnvelope> {
		const snapshot = await transfer.snapshot;
		if (transfer.cancelled || !snapshot) {
			await this.release(owner, key);
			return closedReply(envelope);
		}
		if (
			snapshot.reading ||
			(cursor !== undefined && cursor !== `${key}:${snapshot.offset}`)
		) {
			throw new Error("History transfer expired or cursor is invalid");
		}
		snapshot.reading = true;
		try {
			const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
			let historyChunk = "";
			do {
				const { bytesRead } = await snapshot.file.read(
					buffer,
					0,
					Math.min(buffer.length, snapshot.size - snapshot.offset),
					snapshot.offset,
				);
				if (transfer.cancelled) {
					await this.release(owner, key);
					return closedReply(envelope);
				}
				if (bytesRead === 0)
					throw new Error("History snapshot ended before its recorded size");
				snapshot.offset += bytesRead;
				historyChunk = snapshot.decoder.decode(buffer.subarray(0, bytesRead), {
					stream: snapshot.offset < snapshot.size,
				});
			} while (!historyChunk && snapshot.offset < snapshot.size);
			const historyCursor =
				snapshot.offset < snapshot.size
					? `${key}:${snapshot.offset}`
					: undefined;
			if (!historyCursor) await this.release(owner, key);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: { historyChunk, ...(historyCursor ? { historyCursor } : {}) },
			};
		} catch (error) {
			const cancelled = transfer.cancelled;
			await this.release(owner, key);
			if (cancelled) return closedReply(envelope);
			throw error;
		} finally {
			snapshot.reading = false;
		}
	}

	private release(owner: object, key: string): Promise<void> {
		const entries = this.owners.get(owner);
		const transfer = entries?.get(key);
		if (!transfer) return Promise.resolve();
		if (transfer.cleanup) return transfer.cleanup;
		transfer.cancelled = true;
		clearTimeout(transfer.timer);
		transfer.cleanup = (async () => {
			try {
				const snapshot = await transfer.snapshot;
				await snapshot?.file.close();
			} catch (error) {
				logHubMessage("warn", "history transfer close failed", { error });
			} finally {
				entries?.delete(key);
				if (entries?.size === 0) this.owners.delete(owner);
				this.available.emit("slot");
			}
		})();
		return transfer.cleanup;
	}
}
