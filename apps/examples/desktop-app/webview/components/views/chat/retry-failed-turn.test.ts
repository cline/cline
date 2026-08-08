// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildUserPromptDisplayLabel } from "@/hooks/chat-session/attachments";
import { formatChatMessageContent } from "./message-content";
import {
	MAX_RETAINED_SENT_TURNS,
	recordSentTurn,
	resolveRetryTurnPayload,
	type SentTurnRecord,
} from "./retry-failed-turn";

function makeSentTurn(prompt: string, attachments: File[]): SentTurnRecord {
	return {
		displayLabel: buildUserPromptDisplayLabel(prompt, attachments),
		prompt,
		attachments,
	};
}

// What the retry wiring derives from the turn's transcript user message.
function transcriptPromptFor(turn: SentTurnRecord): string {
	return formatChatMessageContent("user", turn.displayLabel).trim();
}

describe("resolveRetryTurnPayload", () => {
	it("re-sends the original prompt text and attachments from the matching send", () => {
		const image = new File([new Uint8Array([1, 2, 3])], "diagram.png", {
			type: "image/png",
		});
		const doc = new File(["notes"], "notes.txt", { type: "text/plain" });
		const sentTurn = makeSentTurn("Describe these files", [image, doc]);

		// The transcript shows only a display label for attachments ("[attached
		// 1 file]") — retry must not send that reconstructed text or drop the
		// files.
		expect(sentTurn.displayLabel).toContain("[attached 1 file]");
		const payload = resolveRetryTurnPayload(
			[sentTurn],
			transcriptPromptFor(sentTurn),
		);

		expect(payload?.prompt).toBe("Describe these files");
		expect(payload?.attachments).toEqual([image, doc]);
	});

	it("retries the failed turn, not a newer prompt queued while it was running", () => {
		const image = new File([new Uint8Array([1])], "bug.png", {
			type: "image/png",
		});
		const failedTurn = makeSentTurn("Explain this screenshot", [image]);
		const queuedWhileRunning = makeSentTurn("Also run the tests", []);

		// The failed turn's user bubble is the transcript's last user message;
		// the queued prompt never started, so it must not be the retry target.
		const payload = resolveRetryTurnPayload(
			[failedTurn, queuedWhileRunning],
			transcriptPromptFor(failedTurn),
		);

		expect(payload?.prompt).toBe("Explain this screenshot");
		expect(payload?.attachments).toEqual([image]);
	});

	it("copies the attachment list so a retry cannot mutate the retained payload", () => {
		const image = new File([new Uint8Array([1])], "a.png", {
			type: "image/png",
		});
		const sentTurn = makeSentTurn("Look at this", [image]);

		const payload = resolveRetryTurnPayload([sentTurn], "Look at this");
		payload?.attachments.pop();

		expect(sentTurn.attachments).toEqual([image]);
	});

	it("falls back to the transcript prompt without attachments when no send matches", () => {
		const payload = resolveRetryTurnPayload([], "  Summarize the repo  ");

		expect(payload).toEqual({ prompt: "Summarize the repo", attachments: [] });
	});

	it("returns null when there is nothing to retry", () => {
		expect(resolveRetryTurnPayload([], "   ")).toBeNull();
	});
});

describe("recordSentTurn", () => {
	it("keeps the list bounded, dropping the oldest sends first", () => {
		let records: SentTurnRecord[] = [];
		for (let i = 0; i < MAX_RETAINED_SENT_TURNS + 3; i++) {
			records = recordSentTurn(records, makeSentTurn(`prompt ${i}`, []));
		}

		expect(records).toHaveLength(MAX_RETAINED_SENT_TURNS);
		expect(records[0]?.prompt).toBe("prompt 3");
		expect(records.at(-1)?.prompt).toBe(
			`prompt ${MAX_RETAINED_SENT_TURNS + 2}`,
		);
	});
});
