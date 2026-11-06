import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { type FileHandle, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { errorReply, extractSessionId, okReply } from "./handlers/context";
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
	initialRequestId: string;
	sessionId: string;
	snapshot: Promise<Snapshot | undefined>;
	cancelled: boolean;
	cancelPending: () => void;
	timer: ReturnType<typeof setTimeout>;
	cleanup?: Promise<void>;
};

type WaitingTransfer = { sessionId: string; abort: AbortController };

function closedReply(envelope: HubCommandEnvelope): HubReplyEnvelope {
	return errorReply(
		envelope,
		"history_transfer_closed",
		"History transfer closed",
	);
}

export class HistoryTransferPool {
	private readonly owners = new Map<object, Map<string, Transfer>>();
	private readonly waiting = new Map<object, Map<string, WaitingTransfer>>();
	private preparations = 0;
	private readonly available = new EventEmitter().setMaxListeners(0);

	cancel(owner: object, requestId: string, sessionId: string): void {
		const queued = this.waiting.get(owner)?.get(requestId);
		if (queued?.sessionId === sessionId) queued.abort.abort();
		for (const [key, transfer] of this.owners.get(owner) ?? []) {
			if (
				transfer.initialRequestId === requestId &&
				transfer.sessionId === sessionId
			) {
				void this.cancelTransfer(owner, key);
			}
		}
	}

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
			if (!transfer || transfer.sessionId !== extractSessionId(envelope)) {
				throw new Error("History transfer expired or cursor is invalid");
			}
			const cancel = () => {
				void this.cancelTransfer(owner, key);
			};
			if (signal.aborted) {
				await this.cancelTransfer(owner, key);
				return closedReply(envelope);
			}
			signal.addEventListener("abort", cancel, { once: true });
			try {
				return await this.chunk(envelope, owner, key, transfer, cursor);
			} finally {
				signal.removeEventListener("abort", cancel);
			}
		}

		const sessionId = extractSessionId(envelope);
		const initialRequestId = envelope.requestId;
		if (typeof initialRequestId !== "string" || !initialRequestId.trim()) {
			throw new Error("Chunked history requires an initial request ID");
		}
		const waitingEntries =
			this.waiting.get(owner) ?? new Map<string, WaitingTransfer>();
		if (
			waitingEntries.has(initialRequestId) ||
			Array.from(this.owners.get(owner)?.values() ?? []).some(
				(transfer) => transfer.initialRequestId === initialRequestId,
			)
		) {
			throw new Error("Duplicate live history request ID");
		}
		const waitingAbort = new AbortController();
		this.waiting.set(owner, waitingEntries);
		waitingEntries.set(initialRequestId, { sessionId, abort: waitingAbort });
		const timer = setTimeout(
			() => this.cancel(owner, initialRequestId, sessionId),
			TRANSFER_TIMEOUT_MS,
		);
		timer.unref();
		const boundedSignal = AbortSignal.any([signal, waitingAbort.signal]);
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
			clearTimeout(timer);
			if (boundedSignal.aborted) return closedReply(envelope);
			throw error;
		} finally {
			waitingEntries.delete(initialRequestId);
			if (waitingEntries.size === 0) this.waiting.delete(owner);
		}

		this.preparations++;
		const key = randomUUID();
		let resolveSnapshot!: (snapshot: Snapshot | undefined) => void;
		const prepared = new Promise<Snapshot | undefined>((resolve) => {
			resolveSnapshot = resolve;
		});
		let cancelPending!: () => void;
		const cancelledReply = new Promise<HubReplyEnvelope>((resolve) => {
			cancelPending = () => resolve(closedReply(envelope));
		});
		const transfer: Transfer = {
			initialRequestId,
			sessionId,
			snapshot: prepared,
			cancelled: false,
			cancelPending,
			timer,
		};
		const entries = this.owners.get(owner) ?? new Map<string, Transfer>();
		this.owners.set(owner, entries);
		entries.set(key, transfer);
		const cancel = () => {
			void this.cancelTransfer(owner, key);
		};
		boundedSignal.addEventListener("abort", cancel, { once: true });
		let snapshot: Snapshot | undefined;
		const response = (async (): Promise<HubReplyEnvelope> => {
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
		})();
		try {
			return await Promise.race([response, cancelledReply]);
		} finally {
			boundedSignal.removeEventListener("abort", cancel);
		}
	}

	async close(owner: object): Promise<void> {
		for (const queued of this.waiting.get(owner)?.values() ?? []) {
			queued.abort.abort();
		}
		await Promise.all(
			Array.from(this.owners.get(owner)?.keys() ?? [], (key) =>
				this.cancelTransfer(owner, key),
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
			return okReply(envelope, {
				historyChunk,
				...(historyCursor ? { historyCursor } : {}),
			});
		} catch (error) {
			const cancelled = transfer.cancelled;
			await this.release(owner, key);
			if (cancelled) return closedReply(envelope);
			throw error;
		} finally {
			snapshot.reading = false;
		}
	}

	private cancelTransfer(owner: object, key: string): Promise<void> {
		this.owners.get(owner)?.get(key)?.cancelPending();
		return this.release(owner, key);
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
