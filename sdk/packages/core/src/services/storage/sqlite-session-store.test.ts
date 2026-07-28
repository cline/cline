import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionRecord } from "../../types/sessions";
import { SqliteSessionStore } from "./sqlite-session-store";

let dir: string;
let store: SqliteSessionStore;

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		sessionId: "s1",
		source: "chat",
		pid: 0,
		startedAt: "2026-07-27T00:00:00.000Z",
		status: "completed",
		interactive: false,
		provider: "anthropic",
		model: "claude-opus-5",
		cwd: "/w",
		workspaceRoot: "/w",
		enableTools: true,
		enableSpawn: true,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-07-27T00:00:00.000Z",
		...overrides,
	} as SessionRecord;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sqlite-session-store-"));
	store = new SqliteSessionStore({ sessionsDir: dir });
	store.init();
});

afterEach(() => {
	store.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("SqliteSessionStore.listChildren", () => {
	it("returns only the children of the requested parent", () => {
		store.create(record({ sessionId: "root" }));
		store.create(
			record({
				sessionId: "root__a",
				parentSessionId: "root",
				agentId: "a",
				isSubagent: true,
			}),
		);
		store.create(
			record({
				sessionId: "other__b",
				parentSessionId: "other",
				agentId: "b",
				isSubagent: true,
			}),
		);

		const children = store.listChildren("root");
		expect(children.map((child) => child.sessionId)).toEqual(["root__a"]);
	});

	it("returns an empty list for a parent with no children", () => {
		store.create(record({ sessionId: "root" }));
		expect(store.listChildren("root")).toEqual([]);
	});

	it("orders children oldest first, so they read in spawn order", () => {
		store.create(record({ sessionId: "root" }));
		for (const [id, startedAt] of [
			["root__second", "2026-07-27T00:02:00.000Z"],
			["root__third", "2026-07-27T00:03:00.000Z"],
			["root__first", "2026-07-27T00:01:00.000Z"],
		]) {
			store.create(
				record({
					sessionId: id,
					parentSessionId: "root",
					agentId: id,
					isSubagent: true,
					startedAt,
				}),
			);
		}

		expect(store.listChildren("root").map((child) => child.sessionId)).toEqual([
			"root__first",
			"root__second",
			"root__third",
		]);
	});

	it("honours the limit, keeping the oldest", () => {
		store.create(record({ sessionId: "root" }));
		for (let index = 1; index <= 4; index += 1) {
			store.create(
				record({
					sessionId: `root__${index}`,
					parentSessionId: "root",
					agentId: `${index}`,
					isSubagent: true,
					startedAt: `2026-07-27T00:0${index}:00.000Z`,
				}),
			);
		}

		expect(
			store.listChildren("root", 2).map((child) => child.sessionId),
		).toEqual(["root__1", "root__2"]);
	});

	it("carries the lineage and artifact fields a caller needs", () => {
		store.create(record({ sessionId: "root" }));
		store.create(
			record({
				sessionId: "root__a",
				parentSessionId: "root",
				parentAgentId: "lead",
				agentId: "a",
				conversationId: "conv1",
				isSubagent: true,
				status: "running",
				prompt: "review the diff",
				teamName: "platform",
				messagesPath: "/w/root/a.messages.json",
			}),
		);

		const child = store.listChildren("root")[0];
		expect(child).toMatchObject({
			sessionId: "root__a",
			parentSessionId: "root",
			parentAgentId: "lead",
			agentId: "a",
			conversationId: "conv1",
			isSubagent: true,
			status: "running",
			prompt: "review the diff",
			teamName: "platform",
			messagesPath: "/w/root/a.messages.json",
		});
	});

	it("does not treat an unrelated session as a child of itself", () => {
		store.create(record({ sessionId: "root" }));
		expect(store.listChildren("")).toEqual([]);
	});

	it("stops listing a child once it is deleted", () => {
		store.create(record({ sessionId: "root" }));
		store.create(
			record({
				sessionId: "root__a",
				parentSessionId: "root",
				agentId: "a",
				isSubagent: true,
			}),
		);
		expect(store.listChildren("root")).toHaveLength(1);

		store.delete("root", true);
		expect(store.listChildren("root")).toEqual([]);
	});
});
