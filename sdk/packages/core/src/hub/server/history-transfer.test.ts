import { createHash } from "node:crypto";
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
	] as const)("cancels continuation reads (%s)", async (mode) => {
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
		const abort = new AbortController();
		let transferFile: FileHandle | undefined;
		if (mode === "already") abort.abort();
		else {
			diskRead.mockImplementationOnce(function (
				this: FileHandle,
				...args: unknown[]
			) {
				transferFile = this;
				const pending: ReturnType<FileHandle["read"]> = Reflect.apply(
					originalRead,
					this,
					args,
				);
				abort.abort();
				return pending;
			});
		}
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
			await expect(pending).resolves.toMatchObject({
				ok: false,
				error: { code: "history_transfer_closed" },
			});
			if (mode !== "already") expect(transferFile?.fd).toBe(-1);
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

	it.each([
		{ name: "escaped Unicode", content: () => '\\"\u0000🌍'.repeat(40_000) },
		{ name: "larger than 64 MiB", content: () => "x".repeat(65 * 1024 * 1024) },
	])("streams $name history with bounded replies and connection-bound cursors", async ({
		content,
	}) => {
		const pool = new HistoryTransferPool();
		const owner = {};
		const messages = [{ role: "tool", content: content() }];
		const read = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				...envelope,
				ok: true,
				payload: { messages },
			}),
		);
		let reply = await pool.command(envelope, owner, read, signal());
		expect(await readdir(join(directory, "history-transfers"))).toEqual([]);
		const actual = createHash("sha256");
		let chunkCount = 0;
		while (true) {
			expect(
				Buffer.byteLength(JSON.stringify({ kind: "reply", envelope: reply })),
			).toBeLessThan(1024 * 1024);
			actual.update(String(reply.payload?.historyChunk));
			chunkCount++;
			const cursor = reply.payload?.historyCursor;
			if (cursor === undefined) break;
			const continuation = {
				...envelope,
				payload: { chunkHistory: true, historyCursor: cursor },
			};
			if (chunkCount === 1) {
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

				const [first, overlapping] = await Promise.allSettled([
					pool.command(continuation, owner, read, signal()),
					pool.command(continuation, owner, read, signal()),
				]);
				expect(overlapping.status).toBe("rejected");
				if (first.status !== "fulfilled") throw first.reason;
				reply = first.value;
			} else reply = await pool.command(continuation, owner, read, signal());
		}
		expect(actual.digest("hex")).toBe(
			createHash("sha256").update(JSON.stringify(messages)).digest("hex"),
		);
		expect(read).toHaveBeenCalledTimes(1);
		await pool.close(owner);
	});

	it.each([
		"close",
		"cancel",
		"abort",
		"expire",
	] as const)("%s retains admission until uncancellable producers settle", async (mode) => {
		if (mode === "expire") vi.useFakeTimers();
		const pool = new HistoryTransferPool();
		const owner = {};
		const abort = new AbortController();
		const finishers: Array<(reply: HubReplyEnvelope) => void> = [];
		const read = vi.fn(
			() =>
				new Promise<HubReplyEnvelope>((resolve) => {
					finishers.push(resolve);
				}),
		);
		const first = pool.command(envelope, owner, read, abort.signal);
		const second = pool.command(
			{ ...envelope, requestId: "history-2" },
			owner,
			read,
			abort.signal,
		);
		const queuedRead = vi.fn(() => read());
		const queuedEnvelope = { ...envelope, requestId: "history-queued" };
		const queued = pool.command(
			queuedEnvelope,
			owner,
			queuedRead,
			abort.signal,
		);
		const queuedReply = vi.fn();
		void queued.then(queuedReply);
		await expect(pool.command(envelope, owner, read, signal())).rejects.toThrow(
			"Duplicate live history request ID",
		);
		await expect(
			pool.command(queuedEnvelope, owner, read, signal()),
		).rejects.toThrow("Duplicate live history request ID");
		const thirdRead = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				version: "v1",
				ok: true,
				payload: { messages: [] },
			}),
		);
		if (mode === "expire") await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
		const third = pool.command(envelope, {}, thirdRead, signal());
		expect(thirdRead).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledTimes(2);
		if (mode === "close") void pool.close(owner);
		else if (mode === "abort") abort.abort();
		else if (mode === "expire") {
			await vi.advanceTimersByTimeAsync(1);
			expect(queuedReply).toHaveBeenCalledWith(
				expect.objectContaining({
					ok: false,
					error: expect.objectContaining({ code: "history_transfer_closed" }),
				}),
			);
		} else {
			pool.cancel(owner, "history-queued", "session-1");
			pool.cancel(owner, "history-1", "session-1");
			pool.cancel(owner, "history-2", "session-1");
		}
		await expect(queued).resolves.toMatchObject({
			ok: false,
			error: { code: "history_transfer_closed" },
		});
		await expect(first).resolves.toEqual({
			version: "v1",
			requestId: "history-1",
			ok: false,
			error: {
				code: "history_transfer_closed",
				message: "History transfer closed",
			},
		});
		await expect(second).resolves.toMatchObject({
			ok: false,
			error: { code: "history_transfer_closed" },
		});
		expect(thirdRead).not.toHaveBeenCalled();
		expect(queuedRead).not.toHaveBeenCalled();
		for (const finish of finishers)
			finish({ version: "v1", ok: true, payload: { messages: [] } });
		await expect(third).resolves.toMatchObject({
			payload: { historyChunk: "[]" },
		});
		expect(thirdRead).toHaveBeenCalledTimes(1);
		expect(queuedRead).not.toHaveBeenCalled();
		await expect(
			pool.command(envelope, owner, thirdRead, signal()),
		).resolves.toMatchObject({ payload: { historyChunk: "[]" } });
		await pool.close(owner);
	});

	it("expires a paused cursor after the initial reply", async () => {
		vi.useFakeTimers();
		const pool = new HistoryTransferPool();
		const owner = {};
		const read = vi.fn(
			async (): Promise<HubReplyEnvelope> => ({
				version: "v1",
				ok: true,
				payload: { messages: ["x".repeat(200_000)] },
			}),
		);
		const first = await pool.command(envelope, owner, read, signal());
		expect(first.payload?.historyCursor).toBeTypeOf("string");
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		const [result] = await Promise.allSettled([
			pool.command(
				{
					...envelope,
					payload: { historyCursor: first.payload?.historyCursor },
				},
				owner,
				read,
				signal(),
			),
		]);
		if (result.status === "fulfilled") {
			expect(result.value).toMatchObject({
				ok: false,
				error: { code: "history_transfer_closed" },
			});
		} else {
			const error: unknown = result.reason;
			expect(error).toBeInstanceOf(Error);
			expect(error instanceof Error ? error.message : "").toContain(
				"cursor is invalid",
			);
		}
		expect(read).toHaveBeenCalledTimes(1);
		await pool.close(owner);
	});
});
