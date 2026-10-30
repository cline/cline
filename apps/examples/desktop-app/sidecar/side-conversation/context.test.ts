import { captureSideReference, countUserRunMessages } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	readSideConversation,
	parseSideCommand,
} from "../../shared/side-conversation";
import { derivePromptFromMessages } from "../session-data/common";
import { readSessionMessagesSync } from "../session-data/messages";

describe("side reference display", () => {
	it("projects reference as status and first actual question as run 1 with no inherited usage", () => {
		const seed = captureSideReference({
			messages: [
				{ role: "user", content: "parent goal" },
				{ role: "assistant", content: "parent answer" },
			],
			activeParentTurn: false,
		});
		const messages = [
			seed,
			{ role: "user" as const, content: "actual question" },
		];
		expect(countUserRunMessages(messages)).toBe(1);
		expect(derivePromptFromMessages(messages)).toBe("actual question");
		const displayed = readSessionMessagesSync(
			{ liveSessions: new Map() },
			"side-projection",
			800,
			messages,
		);
		expect(displayed).toMatchObject([
			{ role: "status", meta: { messageKind: "desktop_side_reference" } },
			{ role: "user", meta: { runCount: 1 } },
		]);
		expect(displayed[0]).not.toHaveProperty("usage");
	});
});

describe("side slash commands", () => {
	it("parses both aliases and bare commands without matching other commands", () => {
		expect(parseSideCommand(" /btw  explain this\nplease ")).toEqual({
			question: "explain this\nplease",
		});
		expect(parseSideCommand("/side")).toEqual({ question: "" });
		expect(parseSideCommand("/sidekick question")).toBeUndefined();
	});
});

it.each([
	1, 2,
])("recognizes side identity v%s independently of capture diagnostics", (version) => {
	expect(
		readSideConversation({
			desktopSideConversation: {
				version,
				parentSessionId: "main",
				sourceMessageCount: "old-format",
			},
		}),
	).toEqual({ version, parentSessionId: "main" });
	expect(
		readSideConversation({
			desktopSideConversation: { version, sourceMessageCount: 1 },
		}),
	).toBeUndefined();
});
