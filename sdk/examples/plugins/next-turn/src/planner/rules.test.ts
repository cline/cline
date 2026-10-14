import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SET_SIZE } from "../config";
import type { Manifest } from "../context/manifest";
import type { SourceState } from "../context/source";
import {
	type Backlog,
	EMPTY_BACKLOG,
	splitReports,
	type TaskRow,
	tasksFromFold,
} from "./backlog";
import {
	COMMIT_PROMPT,
	cueCode,
	PLAN_PROMPT,
	type TurnFacts,
} from "./candidates";
import { CORE_KINDS, hasCapability, isOutward, offerableKinds } from "./kinds";
import { checkCiRow, pageSet, type RuleInput, rulePool } from "./rules";

type Row = { id: string; kind: string; prompt: string; why: string };

const shape = (rows: readonly Row[]) =>
	rows.map(({ id, kind, prompt, why }) => ({ id, kind, prompt, why }));

/**
 * Golden rows from the hosts' own rule sets, frozen in
 * `test-fixtures/host-rules.json`: each distinct row once under `rows`, and
 * each case naming its rows by key. `b` indexes BACKLOGS, `turn` indexes
 * turnsToTry(), `x` is 1 when the first row of the plugin's pool was excluded
 * before paging.
 */
const hostRules = JSON.parse(
	readFileSync(
		new URL("../../test-fixtures/host-rules.json", import.meta.url),
		"utf8",
	),
) as {
	rows: Record<string, Row>;
	desktop: { b: number; turn: number; x: number; set: string[] }[];
	cli: { turn: number; repo: { files: number } | null; pool: string[] }[];
};
const hostRows = (keys: readonly string[]) =>
	keys.map((key) => {
		const row = hostRules.rows[key];
		if (!row) throw new Error(`host-rules.json names no row ${key}`);
		return row;
	});

function manifest(
	sources: Record<string, SourceState>,
	capabilities: string[] = [],
	mode: Manifest["mode"] = "act",
): RuleInput["manifest"] {
	return { sources, capabilities, mode };
}

const DESKTOP = manifest({
	turn: "present",
	git: "present",
	status: "present",
	tasks: "present",
	plan: "present",
});

function turnsToTry(): TurnFacts[] {
	const out: TurnFacts[] = [];
	for (const status of ["completed", "cancelled", "failed"] as const) {
		for (const toolErrored of [false, true])
			for (const filesEdited of [0, 1, 3])
				out.push({ status, toolErrored, filesEdited });
	}
	return out;
}

const TASKS: TaskRow[] = [
	{
		taskId: "t1",
		title: "Wire the planner",
		status: "approved",
		priority: 2,
		updatedAt: Date.parse("2026-10-01T00:00:00Z"),
	},
	{
		taskId: "t2",
		title: "Ship the tray",
		status: "in_progress",
		priority: 3,
		updatedAt: Date.parse("2026-10-02T00:00:00Z"),
	},
	{
		taskId: "t3",
		title: "Proposal",
		status: "pending_approval",
		priority: 1,
		updatedAt: Date.parse("2026-10-03T00:00:00Z"),
	},
	{
		taskId: "t4",
		title: "Done already",
		status: "completed",
		priority: 1,
		updatedAt: Date.parse("2026-10-03T00:00:00Z"),
	},
];

const BACKLOGS: Backlog[] = [
	EMPTY_BACKLOG,
	{ ...EMPTY_BACKLOG, tasks: TASKS },
	{
		...EMPTY_BACKLOG,
		statusRows: [
			{
				subject: "migration/auth",
				state: "blocked",
				headline: "needs a schema decision",
			},
		],
		tasks: TASKS.slice(0, 1),
	},
	{
		...EMPTY_BACKLOG,
		statusRows: [{ subject: "build", state: "running", headline: "compiling" }],
		bank: { nowTitle: "Move the rules", nextTitle: "Move the labels" },
	},
];

describe("parity with the hosts' rule sets (golden fixtures)", () => {
	test("the desktop host's set is a prefix of the plugin's page, row for row", () => {
		const turns = turnsToTry();
		for (const fixture of hostRules.desktop) {
			const turn = turns[fixture.turn] as TurnFacts;
			const pool = rulePool({
				backlog: BACKLOGS[fixture.b],
				turn,
				manifest: DESKTOP,
			});
			const excluded = fixture.x ? [pool[0]?.prompt ?? ""] : [];
			const actual = pageSet(pool, excluded);
			expect(shape(actual.slice(0, fixture.set.length))).toEqual(
				hostRows(fixture.set),
			);
			if (fixture.set.length === SET_SIZE) expect(actual.length).toBe(SET_SIZE);
		}
	});

	test("with no tracker here, the pool is the CLI host's pool exactly", () => {
		const turns = turnsToTry();
		for (const fixture of hostRules.cli) {
			const turn = turns[fixture.turn] as TurnFacts;
			const repo = fixture.repo;
			const pool = rulePool({
				backlog: EMPTY_BACKLOG,
				turn,
				manifest: manifest({
					turn: "present",
					git: repo ? "present" : "absent",
					tasks: "absent",
					status: "absent",
					plan: "absent",
				}),
				dirtyFiles: repo?.files,
			});
			expect(shape(pool)).toEqual(hostRows(fixture.pool));
		}
	});
});

describe("the merged rule set", () => {
	const clean: TurnFacts = {
		status: "completed",
		filesEdited: 2,
		toolErrored: false,
	};

	test("absent sources contribute nothing, even when the backlog has rows", () => {
		const stock = rulePool({
			backlog: BACKLOGS[2],
			turn: clean,
			manifest: manifest({
				status: "absent",
				tasks: "unknown",
				git: "present",
			}),
		});
		expect(
			stock.some((row) => row.source === "status" || row.source === "tasks"),
		).toBe(false);
		expect(stock.at(-1)?.prompt).toBe(PLAN_PROMPT);
	});

	test("the Commit row needs git, a dirty tree, a clean turn and act mode", () => {
		const input = { backlog: EMPTY_BACKLOG, turn: clean, dirtyFiles: 3 };
		const git = manifest({ git: "present", tasks: "present" });
		expect(
			rulePool({ ...input, manifest: git }).some(
				(row) => row.prompt === COMMIT_PROMPT,
			),
		).toBe(true);
		expect(
			rulePool({
				...input,
				manifest: manifest({ git: "absent", tasks: "present" }),
			}).some((row) => row.kind === "commit"),
		).toBe(false);
		expect(
			rulePool({
				...input,
				manifest: manifest({ git: "present" }, [], "plan"),
			}).some((row) => row.kind === "commit"),
		).toBe(false);
		expect(
			rulePool({ ...input, dirtyFiles: undefined, manifest: git }).some(
				(row) => row.kind === "commit",
			),
		).toBe(false);
		expect(
			rulePool({
				...input,
				turn: { ...clean, toolErrored: true },
				manifest: git,
			}).some((row) => row.kind === "commit"),
		).toBe(false);
	});

	test("Check CI needs GitHub, a GitHub remote, and evidence; Read names the failing checks", () => {
		const github = manifest({ git: "present" }, [
			"github",
			"github:gh",
			"remote:github",
		]);
		const base: RuleInput = {
			backlog: EMPTY_BACKLOG,
			turn: clean,
			manifest: github,
			github: { pushed: false },
		};
		expect(checkCiRow(base)).toBeNull();
		expect(checkCiRow({ ...base, github: { pushed: true } })?.prompt).toBe(
			"Check CI on this branch's pull request and fix what fails.",
		);
		const read = checkCiRow({
			...base,
			github: {
				pushed: false,
				failingChecks: ["lint", "test"],
				url: "https://github.com/o/r/pull/7",
			},
		});
		expect(read).toMatchObject({
			kind: "check_ci",
			source: "connector",
			why: "GitHub · CI failing: lint, test",
			url: "https://github.com/o/r/pull/7",
		});
		expect(
			checkCiRow({
				...base,
				manifest: manifest({}, ["github"]),
				github: { pushed: true },
			}),
		).toBeNull();
		expect(
			checkCiRow({
				...base,
				manifest: manifest({}, ["remote:github"]),
				github: { pushed: true },
			}),
		).toBeNull();
		const pool = rulePool({ ...base, github: { pushed: true } });
		expect(pool.findIndex((row) => row.kind === "check_ci")).toBeLessThan(
			pool.findIndex((row) => row.kind === "verify"),
		);
	});

	test("kinds follow capabilities; outward kinds are marked", () => {
		expect(offerableKinds({ capabilities: [] })).not.toContain("check_ci");
		expect(offerableKinds({ capabilities: ["github"] })).toEqual(
			expect.arrayContaining(["check_ci", "reply_review"]),
		);
		expect(offerableKinds({ capabilities: ["composio:linear"] })).toContain(
			"update_issue",
		);
		expect(offerableKinds({ capabilities: ["mcp:linear-app"] })).toContain(
			"update_issue",
		);
		expect(offerableKinds({ capabilities: ["mcp:sentry"] })).not.toContain(
			"update_issue",
		);
		expect(hasCapability(["composio:slack"], "slack")).toBe(true);
		expect(
			offerableKinds({
				capabilities: [
					"skill:slack",
					"workflow:/github",
					"plugin-command:/linear",
					"script:github",
					"make:jira",
					"remote:github",
				],
			}),
		).toEqual([...CORE_KINDS]);
		expect(isOutward("post_update")).toBe(true);
		expect(isOutward("check_ci")).toBe(false);
	});

	test("cue codes follow the turn alone", () => {
		expect(
			cueCode({ status: "failed", filesEdited: 2, toolErrored: true }),
		).toBe("failed");
		expect(
			cueCode({ status: "completed", filesEdited: 2, toolErrored: true }),
		).toBe("tool_error");
		expect(cueCode(clean)).toBe("completed_edits");
	});
});

describe("the backlog", () => {
	test("tasks come from the fold, scoped to the workspace", () => {
		const fold = {
			sequence: 3,
			sessions: {},
			schedules: {},
			teams: {},
			tasks: {
				a: {
					taskId: "a",
					title: "Here",
					status: "approved",
					workspaceRoot: "/w",
					updatedAt: 5,
				},
				b: {
					taskId: "b",
					title: "Elsewhere",
					status: "approved",
					workspaceRoot: "/other",
				},
			},
		};
		expect(tasksFromFold(fold, { workspaceRoot: "/w" })).toEqual([
			{
				taskId: "a",
				title: "Here",
				status: "approved",
				priority: 3,
				updatedAt: 5,
			},
		]);
	});

	test("reports split into this chat's and other chats' open ones", () => {
		const report = (
			sessionId: string,
			subject: string,
			state: string,
			supersededAt?: string,
		) =>
			({
				updateId: `${sessionId}${subject}`,
				sessionId,
				subject,
				state,
				headline: "h",
				createdAt: "t",
				supersededAt,
			}) as never;
		const split = splitReports(
			[
				report("me", "auth", "blocked"),
				report("me", "old", "failed", "later"),
				report("you", "auth", "running"),
				report("you", "docs", "running"),
				report("you", "done", "completed"),
			],
			"me",
		);
		expect(split.statusRows.map((row) => row.subject)).toEqual(["auth"]);
		expect(split.otherStatusRows.map((row) => row.subject)).toEqual(["docs"]);
	});
});
