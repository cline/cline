import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoreRecord = {
	sessionId: string;
	agentId?: string;
	parentAgentId?: string;
	parentSessionId?: string;
	status: string;
	prompt?: string;
	teamName?: string;
	provider: string;
	model: string;
	startedAt: string;
	endedAt?: string | null;
	messagesPath?: string;
};

const records = new Map<string, StoreRecord>();

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		SqliteSessionStore: class {
			listChildren(parentSessionId: string, limit = 200) {
				return [...records.values()]
					.filter((record) => record.parentSessionId === parentSessionId)
					.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
					.slice(0, limit);
			}
			get(sessionId: string) {
				return records.get(sessionId);
			}
		},
	};
});

import { listSessionAgents, readChildSessionMessages } from "./agents";

let dir: string;

function writeMessages(name: string, messages: unknown[]): string {
	const path = join(dir, name);
	writeFileSync(path, JSON.stringify({ messages }), "utf8");
	return path;
}

const ROOT = "root1";

function record(overrides: Partial<StoreRecord> & { sessionId: string }) {
	return {
		agentId: "agent1",
		parentSessionId: ROOT,
		status: "completed",
		provider: "anthropic",
		model: "claude-opus-5",
		startedAt: "2026-07-27T00:00:00.000Z",
		...overrides,
	} satisfies StoreRecord;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "agents-test-"));
	records.clear();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("listSessionAgents", () => {
	it("returns nothing for a blank session id", () => {
		expect(listSessionAgents("")).toEqual([]);
		expect(listSessionAgents("   ")).toEqual([]);
	});

	it("lists only children of the requested root", () => {
		records.set("root1__a", record({ sessionId: "root1__a", agentId: "a" }));
		records.set(
			"other__b",
			record({
				sessionId: "other__b",
				agentId: "b",
				parentSessionId: "other",
			}),
		);
		const agents = listSessionAgents(ROOT);
		expect(agents.map((agent) => agent.agentId)).toEqual(["a"]);
	});

	it("classifies team-task children apart from subagents", () => {
		records.set("root1__a", record({ sessionId: "root1__a", agentId: "a" }));
		records.set(
			"root1__teamtask__b__x1",
			record({
				sessionId: "root1__teamtask__b__x1",
				agentId: "b",
				teamName: "platform",
				startedAt: "2026-07-27T00:01:00.000Z",
			}),
		);
		const agents = listSessionAgents(ROOT);
		expect(agents.map((agent) => agent.kind)).toEqual(["subagent", "teamtask"]);
		expect(agents[1]?.teamName).toBe("platform");
	});

	it("skips rows with no agent id", () => {
		records.set(
			"root1__a",
			record({ sessionId: "root1__a", agentId: undefined }),
		);
		expect(listSessionAgents(ROOT)).toEqual([]);
	});

	it("reports whether a transcript exists yet", () => {
		records.set(
			"root1__written",
			record({
				sessionId: "root1__written",
				agentId: "written",
				messagesPath: writeMessages("written.json", [
					{ role: "assistant", content: "done" },
				]),
			}),
		);
		records.set(
			"root1__empty",
			record({
				sessionId: "root1__empty",
				agentId: "empty",
				status: "running",
				messagesPath: writeMessages("empty.json", []),
				startedAt: "2026-07-27T00:01:00.000Z",
			}),
		);
		records.set(
			"root1__missing",
			record({
				sessionId: "root1__missing",
				agentId: "missing",
				status: "running",
				messagesPath: join(dir, "nope.json"),
				startedAt: "2026-07-27T00:02:00.000Z",
			}),
		);
		const agents = listSessionAgents(ROOT);
		expect(agents.map((agent) => [agent.agentId, agent.hasMessages])).toEqual([
			["written", true],
			["empty", false],
			["missing", false],
		]);
	});

	it("preserves the persisted status", () => {
		records.set(
			"root1__a",
			record({ sessionId: "root1__a", agentId: "a", status: "failed" }),
		);
		expect(listSessionAgents(ROOT)[0]?.status).toBe("failed");
	});
});

describe("readChildSessionMessages", () => {
	it("reads a child transcript from the path recorded on its row", () => {
		records.set(
			"root1__a",
			record({
				sessionId: "root1__a",
				agentId: "a",
				messagesPath: writeMessages("a.json", [
					{ role: "user", content: "do the thing" },
					{ role: "assistant", content: "did the thing" },
				]),
			}),
		);
		expect(JSON.stringify(readChildSessionMessages("root1__a"))).toContain(
			"did the thing",
		);
	});

	it("returns null for a root session so ordinary reads are untouched", () => {
		records.set(
			"root1",
			record({ sessionId: "root1", parentSessionId: undefined }),
		);
		expect(readChildSessionMessages("root1")).toBeNull();
	});

	it("returns null for an unknown or blank session", () => {
		expect(readChildSessionMessages("root1__ghost")).toBeNull();
		expect(readChildSessionMessages("  ")).toBeNull();
	});

	it("returns null when the recorded transcript has not been written yet", () => {
		records.set(
			"root1__a",
			record({
				sessionId: "root1__a",
				agentId: "a",
				status: "running",
				messagesPath: join(dir, "not-yet.json"),
			}),
		);
		expect(readChildSessionMessages("root1__a")).toBeNull();
	});
});

describe("listSessionAgents last action", () => {
	it("reports the most recent tool call", () => {
		records.set(
			"root1__a",
			record({
				sessionId: "root1__a",
				agentId: "a",
				status: "running",
				messagesPath: writeMessages("a.json", [
					{ role: "user", content: "investigate" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: "Let me look around." },
							{ type: "tool_use", name: "read_files", input: {} },
						],
					},
				]),
			}),
		);
		expect(listSessionAgents(ROOT)[0]?.lastAction).toBe("Running read_files");
	});

	it("falls back to the latest assistant text", () => {
		records.set(
			"root1__a",
			record({
				sessionId: "root1__a",
				agentId: "a",
				messagesPath: writeMessages("a.json", [
					{ role: "assistant", content: [{ type: "tool_use", name: "grep" }] },
					{ role: "user", content: [{ type: "tool_result", content: "hits" }] },
					{ role: "assistant", content: "Found three call sites." },
				]),
			}),
		);
		expect(listSessionAgents(ROOT)[0]?.lastAction).toBe(
			"Found three call sites.",
		);
	});

	it("skips reasoning blocks, which are intent rather than action", () => {
		records.set(
			"root1__a",
			record({
				sessionId: "root1__a",
				agentId: "a",
				messagesPath: writeMessages("a.json", [
					{
						role: "assistant",
						content: [
							{ type: "text", text: "Checked the parser." },
							{ type: "thinking", thinking: "I should double check" },
						],
					},
				]),
			}),
		);
		expect(listSessionAgents(ROOT)[0]?.lastAction).toBe("Checked the parser.");
	});

	it("collapses whitespace and truncates a long action", () => {
		records.set(
			"root1__a",
			record({
				sessionId: "root1__a",
				agentId: "a",
				messagesPath: writeMessages("a.json", [
					{ role: "assistant", content: `line one\n\n${"x".repeat(400)}` },
				]),
			}),
		);
		const lastAction = listSessionAgents(ROOT)[0]?.lastAction ?? "";
		expect(lastAction.endsWith("...")).toBe(true);
		expect(lastAction.length).toBeLessThanOrEqual(163);
		expect(lastAction).not.toContain("\n");
	});

	it("leaves the action undefined when no transcript exists", () => {
		records.set(
			"root1__a",
			record({ sessionId: "root1__a", agentId: "a", status: "running" }),
		);
		expect(listSessionAgents(ROOT)[0]?.lastAction).toBeUndefined();
	});
});
