import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionStatus } from "@cline/core";
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

import {
	forgetTeammateSession,
	latestTeammateSessionId,
	listSessionAgents,
	readChildSessionMessages,
	resolveTeammateSessionId,
} from "./agents";

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

describe("resolveTeammateSessionId", () => {
	const ROUTING_ROOT = "root-routing";
	let store: InstanceType<typeof import("@cline/core").SqliteSessionStore>;

	beforeEach(async () => {
		const { SqliteSessionStore } =
			await vi.importActual<typeof import("@cline/core")>("@cline/core");
		store = new SqliteSessionStore({ sessionsDir: dir });
	});

	afterEach(() => {
		store.close();
	});

	function addRun(
		sessionId: string,
		agentId: string,
		startedAt: string,
		status: SessionStatus = "running",
	) {
		store.create({
			sessionId,
			source: "cli",
			pid: 1,
			startedAt,
			status,
			interactive: false,
			provider: "anthropic",
			model: "claude-opus-5",
			cwd: "/repo",
			workspaceRoot: "/repo",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			parentSessionId: ROUTING_ROOT,
			parentAgentId: "lead",
			agentId,
			isSubagent: true,
			updatedAt: startedAt,
		});
	}

	it("routes to the teammate's newest team-task run while it runs", () => {
		addRun(
			`${ROUTING_ROOT}__teamtask__reviewer__a`,
			"reviewer",
			"2026-10-20T20:00:00.000Z",
			"completed",
		);
		addRun(
			`${ROUTING_ROOT}__teamtask__reviewer__b`,
			"reviewer",
			"2026-10-20T20:05:00.000Z",
		);
		addRun(
			`${ROUTING_ROOT}__subagent__reviewer`,
			"reviewer",
			"2026-10-20T20:09:00.000Z",
		);
		addRun(
			`${ROUTING_ROOT}__teamtask__ui-dev__a`,
			"ui-dev",
			"2026-10-20T20:10:00.000Z",
		);

		expect(
			resolveTeammateSessionId(ROUTING_ROOT, "reviewer", { now: 0, store }),
		).toBe(`${ROUTING_ROOT}__teamtask__reviewer__b`);
		expect(
			resolveTeammateSessionId(ROUTING_ROOT, "ghost", { now: 0, store }),
		).toBeUndefined();
	});

	it("never routes into a run that has finished", () => {
		addRun(
			`${ROUTING_ROOT}__teamtask__writer__a`,
			"writer",
			"2026-10-20T20:00:00.000Z",
			"running",
		);
		addRun(
			`${ROUTING_ROOT}__teamtask__writer__b`,
			"writer",
			"2026-10-20T20:01:00.000Z",
			"completed",
		);
		expect(
			resolveTeammateSessionId(ROUTING_ROOT, "writer", { now: 0, store }),
		).toBeUndefined();
	});

	it("finds the newest run beyond the first few hundred children", () => {
		for (let index = 0; index < 250; index++) {
			const minute = String(index % 60).padStart(2, "0");
			const hour = String(10 + Math.floor(index / 60)).padStart(2, "0");
			addRun(
				`${ROUTING_ROOT}__teamtask__busy__${index}`,
				"busy",
				`2026-10-20T${hour}:${minute}:00.000Z`,
				"completed",
			);
		}
		addRun(
			`${ROUTING_ROOT}__teamtask__late__a`,
			"late",
			"2026-10-20T23:00:00.000Z",
		);
		expect(
			resolveTeammateSessionId(ROUTING_ROOT, "late", { now: 0, store }),
		).toBe(`${ROUTING_ROOT}__teamtask__late__a`);
	});

	it("caches a hit briefly, then picks up the teammate's next run", () => {
		const root = ROUTING_ROOT;
		addRun(`${root}__teamtask__qa__a`, "qa", "2026-10-20T20:00:00.000Z");
		expect(resolveTeammateSessionId(root, "qa", { now: 1_000, store })).toBe(
			`${root}__teamtask__qa__a`,
		);

		addRun(`${root}__teamtask__qa__b`, "qa", "2026-10-20T20:03:00.000Z");
		expect(resolveTeammateSessionId(root, "qa", { now: 2_000, store })).toBe(
			`${root}__teamtask__qa__a`,
		);
		expect(resolveTeammateSessionId(root, "qa", { now: 3_500, store })).toBe(
			`${root}__teamtask__qa__b`,
		);
	});

	it("re-reads at once after the teammate's run starts or ends", () => {
		const root = ROUTING_ROOT;
		addRun(`${root}__teamtask__ops__a`, "ops", "2026-10-20T20:00:00.000Z");
		expect(resolveTeammateSessionId(root, "ops", { now: 1_000, store })).toBe(
			`${root}__teamtask__ops__a`,
		);

		store.update({
			sessionId: `${root}__teamtask__ops__a`,
			status: "completed",
		});
		addRun(`${root}__teamtask__ops__b`, "ops", "2026-10-20T20:03:00.000Z");
		forgetTeammateSession(root, "ops");
		expect(resolveTeammateSessionId(root, "ops", { now: 1_001, store })).toBe(
			`${root}__teamtask__ops__b`,
		);
	});

	it("names the run that just ended, whatever its status", () => {
		addRun(
			`${ROUTING_ROOT}__teamtask__docs__a`,
			"docs",
			"2026-10-20T20:00:00.000Z",
			"completed",
		);
		addRun(
			`${ROUTING_ROOT}__teamtask__docs__b`,
			"docs",
			"2026-10-20T20:04:00.000Z",
			"failed",
		);
		expect(latestTeammateSessionId(ROUTING_ROOT, "docs", { store })).toBe(
			`${ROUTING_ROOT}__teamtask__docs__b`,
		);
		expect(
			latestTeammateSessionId(ROUTING_ROOT, "ghost", { store }),
		).toBeUndefined();
	});

	it("retries a miss soon, since the run's row may not be written yet", () => {
		const root = ROUTING_ROOT;
		expect(
			resolveTeammateSessionId(root, "new", { now: 1_000, store }),
		).toBeUndefined();
		addRun(`${root}__teamtask__new__a`, "new", "2026-10-20T20:00:00.000Z");
		expect(
			resolveTeammateSessionId(root, "new", { now: 1_100, store }),
		).toBeUndefined();
		expect(resolveTeammateSessionId(root, "new", { now: 1_300, store })).toBe(
			`${root}__teamtask__new__a`,
		);
	});
});
