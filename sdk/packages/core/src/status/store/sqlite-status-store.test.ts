import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatusQuery } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStatusStore } from "./sqlite-status-store";

let dir: string;
let store: SqliteStatusStore;

function publish(overrides: Record<string, unknown> = {}) {
	return store.publish({
		subject: "migration/auth",
		state: "running",
		headline: "Rewriting the token exchange",
		source: "test",
		...overrides,
	} as Parameters<SqliteStatusStore["publish"]>[0]);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cline-status-"));
	store = new SqliteStatusStore(join(dir, "status.db"));
});

afterEach(() => {
	store.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("SqliteStatusStore", () => {
	it("assigns strictly increasing seq", () => {
		const a = publish();
		const b = publish({ subject: "migration/db" });
		const c = publish({ subject: "migration/auth", state: "blocked" });
		expect(a.seq).toBe(1);
		expect(b.seq).toBe(2);
		expect(c.seq).toBe(3);
	});

	it("keeps exactly one current row per subject and supersedes the rest", () => {
		publish({ headline: "first" });
		publish({ headline: "second" });
		const third = publish({ headline: "third", state: "blocked" });

		const current = store.current("migration/auth");
		expect(current?.headline).toBe("third");
		expect(current?.state).toBe("blocked");
		expect(current?.supersededAt).toBeNull();

		const history = store.query(
			parseStatusQuery({ subject: "migration/auth", limit: 10 }),
		);
		expect(history.updates).toHaveLength(3);
		expect(history.updates[0]?.seq).toBe(third.seq);
		const superseded = history.updates.filter((u) => u.supersededAt !== null);
		expect(superseded).toHaveLength(2);
	});

	it("returns undefined for an unknown subject", () => {
		expect(store.current("nope")).toBeUndefined();
	});

	it("paginates by keyset without overlapping or dropping rows", () => {
		for (let i = 0; i < 25; i += 1) {
			publish({ subject: `task/${i}`, headline: `step ${i}` });
		}

		const seen: number[] = [];
		let cursor: number | null | undefined;
		let pages = 0;
		do {
			const page = store.query(
				parseStatusQuery({ limit: 10, ...(cursor != null ? { cursor } : {}) }),
			);
			seen.push(...page.updates.map((u) => u.seq));
			cursor = page.nextCursor;
			pages += 1;
		} while (cursor != null && pages < 10);

		expect(pages).toBe(3);
		expect(seen).toHaveLength(25);
		expect(new Set(seen).size).toBe(25);
		// Newest first, strictly descending.
		expect(seen).toEqual([...seen].sort((a, b) => b - a));
	});

	it("reports hasMore and nextCursor only while rows remain", () => {
		for (let i = 0; i < 3; i += 1) {
			publish({ subject: `task/${i}` });
		}
		const full = store.query(parseStatusQuery({ limit: 10 }));
		expect(full.hasMore).toBe(false);
		expect(full.nextCursor).toBeNull();

		const partial = store.query(parseStatusQuery({ limit: 2 }));
		expect(partial.hasMore).toBe(true);
		expect(partial.nextCursor).toBe(partial.updates.at(-1)?.seq);
	});

	it("filters the board to live rows only", () => {
		publish({ subject: "a", headline: "old" });
		publish({ subject: "a", headline: "new" });
		publish({ subject: "b", headline: "only" });

		const board = store.query(
			parseStatusQuery({ currentOnly: true, limit: 10 }),
		);
		expect(board.updates).toHaveLength(2);
		expect(board.updates.map((u) => u.headline).sort()).toEqual([
			"new",
			"only",
		]);
	});

	it("filters by state, agent, session and subject prefix", () => {
		publish({ subject: "drive-room/a", state: "blocked", agentId: "adam" });
		publish({ subject: "drive-room/b", state: "running", agentId: "riley" });
		publish({ subject: "other/c", state: "blocked", sessionId: "s1" });

		const blocked = store.query(
			parseStatusQuery({ state: ["blocked"], currentOnly: true, limit: 10 }),
		);
		expect(blocked.updates).toHaveLength(2);

		const rooms = store.query(
			parseStatusQuery({ subjectPrefix: "drive-room/", limit: 10 }),
		);
		expect(rooms.updates).toHaveLength(2);

		const byAgent = store.query(
			parseStatusQuery({ agentId: "adam", limit: 10 }),
		);
		expect(byAgent.updates).toHaveLength(1);

		const bySession = store.query(
			parseStatusQuery({ sessionId: "s1", limit: 10 }),
		);
		expect(bySession.updates).toHaveLength(1);
	});

	it("searches text on whichever backend the runtime provides", () => {
		publish({ subject: "x", headline: "Blocked on missing credentials" });
		publish({
			subject: "y",
			headline: "Tests green",
			detail: "all 40 passing",
		});

		const hit = store.query(
			parseStatusQuery({ text: "credentials", limit: 10 }),
		);
		expect(hit.updates).toHaveLength(1);
		expect(hit.updates[0]?.subject).toBe("x");

		const inDetail = store.query(
			parseStatusQuery({ text: "passing", limit: 10 }),
		);
		expect(inDetail.updates).toHaveLength(1);
		expect(inDetail.updates[0]?.subject).toBe("y");
	});

	it("round-trips tags, metadata and progress", () => {
		const saved = publish({
			tags: ["auth", "p0"],
			metadata: { attempt: 2, note: "retrying" },
			progress: 0.5,
		});
		const read = store.current(saved.subject);
		expect(read?.tags).toEqual(["auth", "p0"]);
		expect(read?.metadata).toEqual({ attempt: 2, note: "retrying" });
		expect(read?.progress).toBe(0.5);
	});

	it("prunes superseded history but never the current row", () => {
		publish({ headline: "one" });
		publish({ headline: "two" });
		publish({ headline: "three" });

		const deleted = store.prune({ keepPerSubject: 1 });
		expect(deleted).toBe(1);

		const remaining = store.query(
			parseStatusQuery({ subject: "migration/auth", limit: 10 }),
		);
		expect(remaining.updates).toHaveLength(2);
		expect(store.current("migration/auth")?.headline).toBe("three");
	});

	it("tracks latestSeq and live subjects", () => {
		publish({ subject: "a" });
		publish({ subject: "b" });
		publish({ subject: "a" });
		expect(store.latestSeq()).toBe(3);
		expect(store.subjects().sort()).toEqual(["a", "b"]);
	});

	it("rejects an invalid state at the schema boundary", () => {
		expect(() => publish({ state: "exploded" as never })).toThrow();
	});

	it("orders by attention, not recency, when asked", () => {
		publish({ subject: "a", state: "done" });
		publish({ subject: "b", state: "blocked" });
		publish({ subject: "c", state: "running" });
		publish({ subject: "d", state: "failed" });
		// `a` (done) is oldest, `d` (failed) newest. Recency would lead with d.
		const board = store.query(
			parseStatusQuery({ currentOnly: true, orderBy: "attention", limit: 10 }),
		);
		expect(board.updates.map((u) => u.state)).toEqual([
			"blocked",
			"failed",
			"running",
			"done",
		]);
	});

	it("still leads with recency by default", () => {
		publish({ subject: "a", state: "blocked" });
		publish({ subject: "b", state: "done" });
		const page = store.query(parseStatusQuery({ limit: 10 }));
		expect(page.updates[0]?.subject).toBe("b");
	});

	it("reports history count per subject only when asked", () => {
		publish({ subject: "x" });
		publish({ subject: "x" });
		publish({ subject: "x" });
		publish({ subject: "y" });

		const without = store.query(
			parseStatusQuery({ currentOnly: true, limit: 10 }),
		);
		expect(without.updates.every((u) => u.historyCount === undefined)).toBe(
			true,
		);

		const withCount = store.query(
			parseStatusQuery({
				currentOnly: true,
				includeHistoryCount: true,
				limit: 10,
			}),
		);
		const x = withCount.updates.find((u) => u.subject === "x");
		const y = withCount.updates.find((u) => u.subject === "y");
		expect(x?.historyCount).toBe(3);
		expect(y?.historyCount).toBe(1);
	});

	it("carries the previous state so a changelog reads as a transition", () => {
		publish({ subject: "x", state: "queued" });
		publish({ subject: "x", state: "running" });
		publish({ subject: "x", state: "blocked" });

		const history = store.query(parseStatusQuery({ subject: "x", limit: 10 }));
		// Newest first: blocked <- running <- queued.
		expect(history.updates[0]?.previousState).toBe("running");
		expect(history.updates[1]?.previousState).toBe("queued");
		// The first update for a subject has nothing before it.
		expect(history.updates[2]?.previousState).toBeUndefined();
	});

	it("summarizes live rows across the whole table, not a page", () => {
		for (let i = 0; i < 60; i += 1) {
			publish({
				subject: `t/${i}`,
				state: i % 3 === 0 ? "blocked" : "running",
				agentId: i % 2 === 0 ? "adam" : "riley",
				agentName: i % 2 === 0 ? "Adam" : "Riley",
			});
		}
		// Supersede one subject so the live count differs from the row count.
		publish({
			subject: "t/0",
			state: "done",
			agentId: "adam",
			agentName: "Adam",
		});

		const summary = store.summary();
		expect(summary.total).toBe(60);
		expect(summary.byState.blocked).toBe(19);
		expect(summary.byState.done).toBe(1);
		expect(summary.byState.blocked + summary.byState.running + 1).toBe(60);

		const adam = summary.byAgent.find((a) => a.agentId === "adam");
		expect(adam?.agentName).toBe("Adam");
		expect(adam?.total).toBe(30);
		expect(summary.lastUpdatedAt).not.toBeNull();

		// A single page cannot see all 60, which is exactly why the summary
		// is computed server-side rather than counted from rows on screen.
		const page = store.query(
			parseStatusQuery({ currentOnly: true, limit: 10 }),
		);
		expect(page.updates).toHaveLength(10);
	});

	it("summarizes an empty store without throwing", () => {
		const summary = store.summary();
		expect(summary.total).toBe(0);
		expect(summary.byAgent).toEqual([]);
		expect(summary.lastUpdatedAt).toBeNull();
	});
});

/**
 * The published SDK runs on Node, where `node:sqlite` has no FTS5 (measured:
 * "no such module: fts5" on Node 22.14). These run the LIKE path explicitly so
 * it is covered even when CI happens to run under Bun.
 */
describe("SqliteStatusStore text search on the LIKE fallback", () => {
	let likeDir: string;
	let likeStore: SqliteStatusStore;

	beforeEach(() => {
		likeDir = mkdtempSync(join(tmpdir(), "cline-status-like-"));
		likeStore = new SqliteStatusStore(join(likeDir, "status.db"), {
			disableFts: true,
		});
	});

	afterEach(() => {
		likeStore.close();
		rmSync(likeDir, { recursive: true, force: true });
	});

	function publishLike(overrides: Record<string, unknown> = {}) {
		return likeStore.publish({
			subject: "s",
			state: "running",
			headline: "headline",
			source: "test",
			...overrides,
		} as Parameters<SqliteStatusStore["publish"]>[0]);
	}

	it("reports that it is not FTS-backed", () => {
		expect(likeStore.ftsAvailable).toBe(false);
	});

	it("matches headline and detail", () => {
		publishLike({ subject: "x", headline: "Blocked on missing credentials" });
		publishLike({ subject: "y", headline: "green", detail: "all 40 passing" });

		expect(
			likeStore.query(parseStatusQuery({ text: "credentials", limit: 10 }))
				.updates,
		).toHaveLength(1);
		expect(
			likeStore.query(parseStatusQuery({ text: "passing", limit: 10 })).updates,
		).toHaveLength(1);
	});

	it("treats LIKE wildcards as literals, not as match-everything", () => {
		publishLike({ subject: "x", headline: "plain headline" });
		publishLike({ subject: "y", headline: "100% coverage" });

		// `%` alone must not match every row.
		expect(
			likeStore.query(parseStatusQuery({ text: "%", limit: 10 })).updates,
		).toHaveLength(1);
		// `_` must not act as a single-character wildcard.
		expect(
			likeStore.query(parseStatusQuery({ text: "_", limit: 10 })).updates,
		).toHaveLength(0);
	});
});
