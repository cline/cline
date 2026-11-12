import { describe, expect, it } from "vitest";
import {
	withAttachedFilesLabel,
	withoutAttachedFilesLabel,
} from "@/lib/attached-files-label";
import { findSentMessage, samePrompt, snapshotAtSend } from "./sent-prompt";
import { userMessage } from "./test-support/fixtures";

const PROMPT = "Run the tests and fix what fails";

const earlierTurns = [
	userMessage("m-earlier", PROMPT, 1),
	userMessage("m-between", "Refactor the parser", 2),
];
const sentAfter = (messages: typeof earlierTurns) =>
	snapshotAtSend(messages, []).runCount;

describe("findSentMessage", () => {
	it("finds the prompt's own message after the run count it was sent at, never an earlier copy", () => {
		const messages = [
			...earlierTurns,
			userMessage("m-sent", withAttachedFilesLabel(PROMPT, 1), 3),
		];

		expect(findSentMessage(messages, PROMPT, sentAfter(earlierTurns))).toEqual({
			messageId: "m-sent",
			runCount: 3,
		});
	});

	it("finds nothing while only an earlier copy exists", () => {
		expect(
			findSentMessage(earlierTurns, PROMPT, sentAfter(earlierTurns)),
		).toBeUndefined();
	});
});

describe("snapshotAtSend", () => {
	it("takes the newest user turn's run count, or 0 for an empty chat, and the files going with the send", () => {
		const notes = new File(["hello"], "notes.txt");
		expect(snapshotAtSend([], [])).toEqual({ runCount: 0, attachments: [] });
		expect(snapshotAtSend(earlierTurns, [notes])).toEqual({
			runCount: 2,
			attachments: [notes],
		});
	});
});

describe("samePrompt", () => {
	it("reads past the attached-files label the desktop adds to a sent prompt", () => {
		expect(samePrompt(withAttachedFilesLabel(PROMPT, 1), PROMPT)).toBe(true);
		expect(samePrompt(withAttachedFilesLabel(PROMPT, 2), PROMPT)).toBe(true);
		expect(samePrompt(withAttachedFilesLabel("", 2), "")).toBe(true);
		expect(samePrompt(withAttachedFilesLabel(PROMPT, 1), "Run the tests")).toBe(
			false,
		);
	});
});

describe("attached-files label", () => {
	it("comes off exactly as it went on", () => {
		for (const prompt of ["", PROMPT, "First line\n\nSecond line"]) {
			for (const fileCount of [0, 1, 2]) {
				expect(
					withoutAttachedFilesLabel(withAttachedFilesLabel(prompt, fileCount)),
				).toBe(prompt);
			}
		}
		expect(withAttachedFilesLabel(PROMPT, 2)).toBe(
			`${PROMPT}\n\n[attached 2 files]`,
		);
		expect(withAttachedFilesLabel("", 1)).toBe("[attached 1 file]");
	});
});
