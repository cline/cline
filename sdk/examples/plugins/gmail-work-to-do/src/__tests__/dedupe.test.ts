import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceStateForProcessedMessages, selectNewMessages } from "../dedupe";
import { runGmailWorkGate } from "../gate";
import {
	type GmailFetchedMessage,
	resolveGmailAuthCredentials,
} from "../gmail";
import type { GmailWorkState } from "../state";

const previousEnv = { ...process.env };

afterEach(() => {
	process.env = { ...previousEnv };
	vi.restoreAllMocks();
});

function message(id: string, internalDate: string): GmailFetchedMessage {
	return {
		id,
		internalDate,
		subject: `Subject ${id}`,
		from: "sender@example.com",
		bodyText: `Body ${id}`,
	};
}

describe("gmail-work-to-do dedupe", () => {
	it("identifies exactly 5 new messages when 5 were already processed", () => {
		const state: GmailWorkState = {
			maxInternalDate: "1005",
			seenIdsAtMaxInternalDate: ["m5"],
		};
		const messages = Array.from({ length: 10 }, (_, index) =>
			message(`m${index + 1}`, String(1001 + index)),
		);

		const selected = selectNewMessages(messages, state);

		expect(selected.map((item) => item.id)).toEqual([
			"m6",
			"m7",
			"m8",
			"m9",
			"m10",
		]);
	});

	it("handles same-timestamp high-water boundary ids", () => {
		const state: GmailWorkState = {
			maxInternalDate: "2000",
			seenIdsAtMaxInternalDate: ["seen-a", "seen-b"],
		};
		const messages = [
			message("old", "1999"),
			message("seen-a", "2000"),
			message("new-at-boundary", "2000"),
			message("newer", "2001"),
		];

		const selected = selectNewMessages(messages, state);
		const advanced = advanceStateForProcessedMessages(state, selected);

		expect(selected.map((item) => item.id)).toEqual([
			"new-at-boundary",
			"newer",
		]);
		expect(advanced).toEqual({
			maxInternalDate: "2001",
			seenIdsAtMaxInternalDate: ["newer"],
		});
	});

	it("returns a normal abort when there is no new mail", async () => {
		process.env.GMAIL_SEARCH_QUERY = "label:inbox newer_than:1d";
		const writeState = vi.fn();
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};

		const result = await runGmailWorkGate({
			logger,
			readState: () => ({
				maxInternalDate: "3000",
				seenIdsAtMaxInternalDate: ["m1"],
			}),
			writeState,
			fetchMessages: async () => [message("m1", "3000")],
		});

		expect(result).toEqual({
			stop: true,
			reason: "no new mail, exiting",
		});
		expect(writeState).not.toHaveBeenCalled();
		expect(logger.log).toHaveBeenCalledWith(
			"Gmail work-to-do gate: no new mail, exiting",
			expect.objectContaining({ severity: "info" }),
		);
	});

	it("updates state and hands new mail to the agent", async () => {
		process.env.GMAIL_SEARCH_QUERY = "from:alerts@example.com";
		const writeState = vi.fn();

		const result = await runGmailWorkGate({
			readState: () => ({
				maxInternalDate: "4000",
				seenIdsAtMaxInternalDate: ["old"],
			}),
			writeState,
			fetchMessages: async () => [
				message("old", "4000"),
				message("new-a", "4000"),
				message("new-b", "4001"),
			],
		});

		expect(result.stop).toBeUndefined();
		expect(result.reason).toBe("found 2 new Gmail message(s)");
		expect(result.appendMessages).toHaveLength(1);
		expect(result.appendMessages?.[0]?.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("new-b"),
		});
		expect(writeState).toHaveBeenCalledWith({
			maxInternalDate: "4001",
			seenIdsAtMaxInternalDate: ["new-b"],
		});
	});

	it("accepts a Gmail label id instead of a search query", async () => {
		process.env.GMAIL_LABEL_ID = "Label_123";
		const seenFetchInput: unknown[] = [];

		const result = await runGmailWorkGate({
			readState: () => ({ seenIdsAtMaxInternalDate: [] }),
			writeState: vi.fn(),
			fetchMessages: async (input) => {
				seenFetchInput.push(input);
				return [message("label-message", "5000")];
			},
		});

		expect(result.stop).toBeUndefined();
		expect(seenFetchInput).toEqual([
			expect.objectContaining({
				labelId: "Label_123",
				query: undefined,
			}),
		]);
	});

	it("accepts a Gmail label name instead of a search query", async () => {
		process.env.GMAIL_LABEL = "Work/To Do";
		const seenFetchInput: unknown[] = [];

		const result = await runGmailWorkGate({
			readState: () => ({ seenIdsAtMaxInternalDate: [] }),
			writeState: vi.fn(),
			fetchMessages: async (input) => {
				seenFetchInput.push(input);
				return [message("label-name-message", "6000")];
			},
		});

		expect(result.stop).toBeUndefined();
		expect(seenFetchInput).toEqual([
			expect.objectContaining({
				labelName: "Work/To Do",
				labelId: undefined,
				query: undefined,
			}),
		]);
	});

	it("requires either a Gmail search query or label", async () => {
		await expect(
			runGmailWorkGate({
				readState: () => ({ seenIdsAtMaxInternalDate: [] }),
				writeState: vi.fn(),
				fetchMessages: async () => [],
			}),
		).rejects.toThrow("Set GMAIL_SEARCH_QUERY, GMAIL_LABEL_ID, or GMAIL_LABEL");
	});
});

describe("gmail-work-to-do auth config", () => {
	it("accepts a simple access token from env", () => {
		expect(
			resolveGmailAuthCredentials({
				env: { GMAIL_ACCESS_TOKEN: " ya29.test " },
			}),
		).toEqual({ kind: "access-token", accessToken: "ya29.test" });
	});

	it("accepts an access token from GMAIL_TOKEN_PATH", () => {
		expect(
			resolveGmailAuthCredentials({
				env: { GMAIL_TOKEN_PATH: "/tmp/token.json" },
				readJsonFile: () => ({ access_token: "ya29.from-file" }),
			}),
		).toEqual({ kind: "access-token", accessToken: "ya29.from-file" });
	});

	it("keeps refresh-token OAuth config working", () => {
		expect(
			resolveGmailAuthCredentials({
				env: {
					GMAIL_CLIENT_ID: "client-id",
					GMAIL_CLIENT_SECRET: "client-secret",
					GMAIL_REFRESH_TOKEN: "refresh-token",
					GMAIL_REDIRECT_URI: "http://localhost",
				},
			}),
		).toEqual({
			kind: "refresh-token",
			clientId: "client-id",
			clientSecret: "client-secret",
			refreshToken: "refresh-token",
			redirectUri: "http://localhost",
		});
	});
});
