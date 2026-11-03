import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
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
	afterEach(() => vi.useRealTimers());

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
		const chunks: string[] = [];
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
			reply = await pool.command(continuation, owner, read, signal());
		}
		expect(JSON.parse(chunks.join(""))).toEqual(messages);
		expect(read).toHaveBeenCalledTimes(1);
		pool.close(owner);
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
		pool.close(owner);
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
		pool.close(owner);
	});

	it("rejects an oversized pinned transcript without leaking its admission slot", async () => {
		const pool = new HistoryTransferPool();
		const owner = {};
		await expect(
			pool.command(
				envelope,
				owner,
				async () => ({
					version: "v1",
					ok: true,
					payload: { messages: ["x".repeat(64 * 1024 * 1024)] },
				}),
				signal(),
			),
		).rejects.toThrow("byte limit");
		await expect(
			pool.command(
				envelope,
				owner,
				async () => ({ version: "v1", ok: true, payload: { messages: [] } }),
				signal(),
			),
		).resolves.toMatchObject({ payload: { historyChunk: "[]" } });
		pool.close(owner);
	});
});
