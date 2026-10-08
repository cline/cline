import type { SessionRecordedModelCall } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveRecordedRequestMessages } from "./recording-messages";

describe("resolveRecordedRequestMessages", () => {
	const record = (
		callIndex: number,
		messageCount: number,
		messagePrefix: { callIndex: number; count: number } | null,
		messageSha256s: string[],
	) =>
		({
			callIndex,
			request: { messageCount, messagePrefix, messageSha256s },
		}) as unknown as SessionRecordedModelCall;

	it("reports prefixes that name a missing call or overrun it", () => {
		const { messages, errors } = resolveRecordedRequestMessages([
			record(0, 1, null, ["a"]),
			record(1, 3, { callIndex: 0, count: 2 }, ["b"]),
			record(2, 2, { callIndex: 5, count: 1 }, ["c"]),
			record(3, 4, { callIndex: 0, count: 1 }, ["d"]),
		]);
		expect([...messages.keys()]).toEqual([0]);
		expect(errors).toEqual([
			"model call 1 shares 2 messages with call 0, which has only 1",
			"model call 2 shares 1 messages with call 5, which is not an earlier recorded call",
			"model call 3 resolves to 2 messages but records messageCount 4",
		]);
	});
});
