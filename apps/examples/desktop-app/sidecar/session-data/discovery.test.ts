import { describe, expect, it, vi } from "vitest";
vi.mock("@cline/core", () => ({
	SqliteSessionStore: class {
		get() {
			return { metadata: {} };
		}
	},
}));
vi.mock("../paths", () => ({
	sharedSessionDataDir: () => "/nonexistent-cline-discovery-test",
	readSessionManifest: () => undefined,
}));
vi.mock("./messages", () => ({ readPersistedChatMessages: () => [] }));
import { discoverChatSessions } from "./discovery";
describe("desktop session discovery", () => {
	it.each([
		"idle",
		"running",
		"pending",
		"completed",
	])("hides promptless %s sessions with recovery messages", (status) => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"empty",
						{
							busy: status === "running",
							status,
							startedAt: 1,
							config: {},
							messages: [
								{
									role: "user",
									content: "Recovered",
									metadata: { kind: "recovery_notice" },
								},
							],
						},
					],
				]),
			}),
		).toEqual([]);
	});
	it("keeps a first prompt before messages arrive", () => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"started",
						{
							busy: true,
							status: "running",
							startedAt: 1,
							config: {},
							prompt: "Hello",
							messages: [],
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "started", prompt: "Hello" }]);
	});
	it("recovers a prompt from history", () => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"history",
						{
							busy: false,
							status: "completed",
							startedAt: 1,
							config: {},
							prompt: " ",
							messages: [{ role: "user", content: "Hello" }],
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "history", prompt: "Hello" }]);
	});
});
