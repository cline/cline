import { type FileHandle, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryTransferPool } from "./history-transfer";

const envelope: HubCommandEnvelope = {
	version: "v1",
	command: "session.messages",
	requestId: "history-1",
	clientId: "client-1",
	sessionId: "session-1",
	payload: { chunkHistory: true },
};
const signal = () => new AbortController().signal;

describe("HistoryTransferPool", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "hub-history-transfer-"));
		vi.stubEnv("CLINE_DATA_DIR", directory);
	});
	afterEach(async () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	});

	it.each([
		"already",
		"during",
	] as const)("cancels a continuation when aborted %s its disk read", async (mode) => {
		const pool = new HistoryTransferPool();
		const owner = {};
		const read = async (): Promise<HubReplyEnvelope> => ({
			version: "v1",
			ok: true,
			payload: { messages: ["x".repeat(512 * 1024)] },
		});
		const first = await pool.command(envelope, owner, read, signal());
		const probe = await open(join(directory, "probe"), "wx+");
		const prototype: Pick<FileHandle, "read"> = Object.getPrototypeOf(probe);
		await probe.close();
		const originalRead = prototype.read;
		const diskRead = vi.spyOn(prototype, "read");
		let resume: (() => void) | undefined;
		let transferFile: FileHandle | undefined;
		if (mode === "during") {
			diskRead.mockImplementationOnce(function (
				this: FileHandle,
				...args: unknown[]
			) {
				transferFile = this;
				return new Promise<Awaited<ReturnType<FileHandle["read"]>>>(
					(resolve, reject) => {
						resume = () => {
							Promise.resolve()
								.then(() => Reflect.apply(originalRead, this, args))
								.then(resolve, reject);
						};
					},
				);
			});
		}
		const abort = new AbortController();
		if (mode === "already") abort.abort();
		try {
			const pending = pool.command(
				{
					...envelope,
					payload: { historyCursor: first.payload?.historyCursor },
				},
				owner,
				read,
				abort.signal,
			);
			if (mode === "during") {
				await vi.waitFor(() => expect(resume).toBeTypeOf("function"));
				abort.abort();
				if (!resume) throw new Error("Delayed file read did not start");
				resume();
			}
			await expect(pending).resolves.toMatchObject({
				ok: false,
				error: { code: "history_transfer_closed" },
			});
			if (mode === "during") expect(transferFile?.fd).toBe(-1);
			if (mode === "already") expect(diskRead).not.toHaveBeenCalled();
			await expect(
				pool.command(
					{
						...envelope,
						payload: { historyCursor: first.payload?.historyCursor },
					},
					owner,
					read,
					signal(),
				),
			).rejects.toThrow("cursor is invalid");
		} finally {
			await pool.close(owner);
		}
	});

	it("pins one exact transcript across escaped Unicode chunks and rejects foreign cursors", async () => {
		const pool = new HistoryTransferPool();
		const owner = {};
		const messages = [{ role: "tool", content: '\\"\u0000🌍'.repeat(40_000) }];
		const read = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				...envelope,
				ok: true,
				payload: { messages },
			}),
		);
		let reply = await pool.command(envelope, owner, read, signal());
		expect(await readdir(join(directory, "history-transfers"))).toEqual([]);
		const chunks: string[] = [];
		let checkedOverlap = false;
		while (true) {
			expect(
				Buffer.byteLength(JSON.stringify({ kind: "reply", envelope: reply })),
			).toBeLessThan(1024 * 1024);
			chunks.push(String(reply.payload?.historyChunk));
			const cursor = reply.payload?.historyCursor;
			if (cursor === undefined) break;
			const continuation = {
				...envelope,
				payload: { chunkHistory: true, historyCursor: cursor },
			};
			await expect(
				pool.command(continuation, {}, read, signal()),
			).rejects.toThrow("cursor is invalid");
			await expect(
				pool.command(
					{ ...continuation, sessionId: "other" },
					owner,
					read,
					signal(),
				),
			).rejects.toThrow("cursor is invalid");
			await expect(
				pool.command(
					{
						...continuation,
						payload: { ...continuation.payload, sessionId: "other" },
					},
					owner,
					read,
					signal(),
				),
			).rejects.toThrow("cursor is invalid");
			if (!checkedOverlap) {
				const [first, overlapping] = await Promise.allSettled([
					pool.command(continuation, owner, read, signal()),
					pool.command(continuation, owner, read, signal()),
				]);
				expect(overlapping.status).toBe("rejected");
				if (first.status !== "fulfilled") throw first.reason;
				reply = first.value;
				checkedOverlap = true;
			} else reply = await pool.command(continuation, owner, read, signal());
		}
		expect(JSON.parse(chunks.join(""))).toEqual(messages);
		expect(read).toHaveBeenCalledTimes(1);
		await pool.close(owner);
	});

	it.each([
		"close",
		"abort",
		"expire",
	] as const)("discards a late read after %s and frees admission", async (mode) => {
		vi.useFakeTimers();
		const pool = new HistoryTransferPool();
		const owner = {};
		const abort = new AbortController();
		let finish!: (reply: HubReplyEnvelope) => void;
		const pending = pool.command(
			envelope,
			owner,
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			abort.signal,
		);
		if (mode === "close") pool.close(owner);
		if (mode === "abort") abort.abort();
		if (mode === "expire") await vi.advanceTimersByTimeAsync(5 * 60_000);
		finish({ version: "v1", ok: true, payload: { messages: [] } });
		await expect(pending).resolves.toEqual({
			version: "v1",
			requestId: "history-1",
			ok: false,
			error: {
				code: "history_transfer_closed",
				message: "History transfer closed",
			},
		});
		await expect(
			pool.command(
				envelope,
				owner,
				async () => ({ version: "v1", ok: true, payload: { messages: [] } }),
				signal(),
			),
		).resolves.toMatchObject({ payload: { historyChunk: "[]" } });
		await pool.close(owner);
	});

	it("waits for admission until two uncancellable producers actually settle", async () => {
		const pool = new HistoryTransferPool();
		const owner = {};
		const finishers: Array<(reply: HubReplyEnvelope) => void> = [];
		const read = vi.fn(
			() =>
				new Promise<HubReplyEnvelope>((resolve) => {
					finishers.push(resolve);
				}),
		);
		const first = pool.command(envelope, owner, read, signal());
		const second = pool.command(envelope, owner, read, signal());
		const thirdRead = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				version: "v1",
				ok: true,
				payload: { messages: [] },
			}),
		);
		const third = pool.command(envelope, {}, thirdRead, signal());
		expect(thirdRead).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledTimes(2);
		pool.close(owner);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(thirdRead).not.toHaveBeenCalled();
		for (const finish of finishers)
			finish({ version: "v1", ok: true, payload: { messages: [] } });
		await expect(first).resolves.toMatchObject({
			ok: false,
			error: { code: "history_transfer_closed" },
		});
		await expect(second).resolves.toMatchObject({
			ok: false,
			error: { code: "history_transfer_closed" },
		});
		await expect(third).resolves.toMatchObject({
			payload: { historyChunk: "[]" },
		});
		expect(thirdRead).toHaveBeenCalledTimes(1);
		await pool.close(owner);
	});

	it("allows another viewer to prepare while two 32 MiB downloads are paused", async () => {
		const pool = new HistoryTransferPool();
		const owners = [{}, {}];
		const messages = ["x".repeat(32 * 1024 * 1024)];
		const read = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				version: "v1",
				ok: true,
				payload: { messages },
			}),
		);
		try {
			const replies = await Promise.all(
				owners.map((owner) => pool.command(envelope, owner, read, signal())),
			);
			expect(
				replies.every(
					(reply) => typeof reply.payload?.historyCursor === "string",
				),
			).toBe(true);
			const third = await pool.command(
				envelope,
				{},
				async () => ({
					version: "v1",
					ok: true,
					payload: { messages: ["small"] },
				}),
				signal(),
			);
			expect(third.payload?.historyChunk).toBe('["small"]');
			expect(third.payload?.historyCursor).toBeUndefined();
			expect(await readdir(join(directory, "history-transfers"))).toEqual([]);
		} finally {
			await Promise.all(owners.map((owner) => pool.close(owner)));
		}
	});

	it("streams a history larger than 64 MiB without a new transcript-size limit", async () => {
		const pool = new HistoryTransferPool();
		const owner = {};
		const messages = ["x".repeat(65 * 1024 * 1024)];
		const read = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				version: "v1",
				ok: true,
				payload: { messages },
			}),
		);
		let reply = await pool.command(envelope, owner, read, signal());
		const chunks: string[] = [];
		while (true) {
			chunks.push(String(reply.payload?.historyChunk));
			const cursor = reply.payload?.historyCursor;
			if (cursor === undefined) break;
			reply = await pool.command(
				{ ...envelope, payload: { historyCursor: cursor } },
				owner,
				read,
				signal(),
			);
		}
		expect(JSON.parse(chunks.join(""))).toEqual(messages);
		expect(read).toHaveBeenCalledTimes(1);
		await pool.close(owner);
	});
});
