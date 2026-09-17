import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, describe, expect, it } from "vitest";
import { HeadCache } from "./head";
import { UsagePatternsService, windowStartMs } from "./index";
import {
	buildCombinedPatterns,
	buildLifecycle,
	buildRhythm,
	buildSpan,
	buildWorkflow,
	type PatternWindow,
} from "./patterns";
import {
	readClaudeSessions,
	readClineSessions,
	readCodexSessions,
	SKIP_REASONS,
	type SourceReadOptions,
	type UsageSourceRoots,
} from "./sources";
import type { SessionMeta } from "./types";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

/** Local wall-clock timestamps keep hour/day assertions timezone-independent. */
function at(day: string, hour: number, minute = 0): number {
	return Date.parse(
		`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
	);
}

function session(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		source: "codex",
		sessionKey: "s1",
		kind: "root",
		project: "GitHub/demo",
		startedAtMs: at("2026-03-02", 10),
		outcome: "unknown",
		...overrides,
	};
}

const WEEK: PatternWindow = {
	sinceMs: at("2026-03-02", 0),
	nowMs: at("2026-03-08", 23),
};

function touch(file: string, ms: number): void {
	utimesSync(file, ms / 1000, ms / 1000);
}

function readOptions(sinceMs: number): SourceReadOptions {
	return {
		sinceMs,
		cache: new HeadCache(),
		yieldIfBusy: async () => {},
	};
}

function roots(overrides: Partial<UsageSourceRoots>): UsageSourceRoots {
	const missing = join(tmpdir(), "usage-missing-store");
	return {
		codexHome: missing,
		claudeProjectsDir: missing,
		clineSessionsDb: join(missing, "sessions.db"),
		...overrides,
	};
}

describe("buildRhythm", () => {
	it("counts root sessions by local hour and Monday-first weekday", () => {
		const rhythm = buildRhythm(
			[
				session({ sessionKey: "a", startedAtMs: at("2026-03-02", 9) }), // Monday
				session({ sessionKey: "b", startedAtMs: at("2026-03-02", 9) }),
				session({ sessionKey: "c", startedAtMs: at("2026-03-02", 21) }),
				session({ sessionKey: "d", startedAtMs: at("2026-03-08", 21) }), // Sunday
				// A burst of subagent runs must not move the rhythm.
				...Array.from({ length: 5 }, (_, i) =>
					session({
						sessionKey: `sub-${i}`,
						kind: "subagent",
						startedAtMs: at("2026-03-02", 14),
					}),
				),
			],
			WEEK,
		);
		expect(rhythm.hourHistogram[9]).toBe(2);
		expect(rhythm.hourHistogram[21]).toBe(2);
		expect(rhythm.hourHistogram[14]).toBe(0);
		expect(rhythm.peakHour).toBe(9);
		expect(rhythm.weekdayHourMatrix[0]?.[9]).toBe(2);
		expect(rhythm.weekdayHourMatrix[6]?.[21]).toBe(1);
		expect(rhythm.activeDays).toBe(2);
	});

	it("keeps a session that started before the window out of every count", () => {
		const window = {
			sinceMs: at("2026-03-05", 0),
			nowMs: at("2026-03-08", 23),
		};
		const rhythm = buildRhythm(
			[
				session({
					startedAtMs: at("2026-02-20", 9),
					lastActivityMs: at("2026-03-06", 10),
				}),
			],
			window,
		);
		expect(rhythm.hourHistogram.every((count) => count === 0)).toBe(true);
		// Resumed inside the window: one active day, and never a day before it.
		expect(rhythm.daily).toEqual([{ date: "2026-03-06", started: 0 }]);
		expect(rhythm.activeDays).toBe(1);
		expect(rhythm.firstActiveMs).toBe(at("2026-03-06", 10));
	});

	it("never reports more active days than the window holds", () => {
		const window = {
			sinceMs: at("2026-03-06", 0),
			nowMs: at("2026-03-08", 23),
		};
		const rhythm = buildRhythm(
			Array.from({ length: 20 }, (_, day) =>
				session({
					sessionKey: `s${day}`,
					startedAtMs: at("2026-02-15", 9) + day * 86_400_000,
					lastActivityMs: at("2026-03-07", 9),
				}),
			),
			window,
		);
		expect(rhythm.activeDays).toBeLessThanOrEqual(3);
	});

	it("counts the night share over root sessions", () => {
		const rhythm = buildRhythm(
			[
				session({ sessionKey: "a", startedAtMs: at("2026-03-02", 2) }),
				session({ sessionKey: "b", startedAtMs: at("2026-03-02", 14) }),
				session({
					sessionKey: "sub",
					kind: "subagent",
					startedAtMs: at("2026-03-02", 3),
				}),
			],
			WEEK,
		);
		expect(rhythm.nightShare).toBeCloseTo(0.5);
	});

	it("measures streaks over active days, including days a session was resumed", () => {
		const rhythm = buildRhythm(
			[
				session({
					sessionKey: "a",
					startedAtMs: at("2026-03-02", 10),
					lastActivityMs: at("2026-03-03", 18),
				}),
				session({ sessionKey: "b", startedAtMs: at("2026-03-04", 10) }),
				session({ sessionKey: "c", startedAtMs: at("2026-03-07", 10) }),
				session({ sessionKey: "d", startedAtMs: at("2026-03-08", 10) }),
			],
			WEEK,
		);
		expect(rhythm.longestStreakDays).toBe(3);
		expect(rhythm.currentStreakDays).toBe(2);
	});

	it("reports an empty rhythm for no sessions", () => {
		const rhythm = buildRhythm([], WEEK);
		expect(rhythm.activeDays).toBe(0);
		expect(rhythm.peakHour).toBeNull();
		expect(rhythm.firstActiveMs).toBeNull();
		expect(rhythm.nightShare).toBe(0);
	});
});

describe("buildWorkflow", () => {
	it("splits root and subagent sessions started in the window and records depth", () => {
		const workflow = buildWorkflow(
			[
				session({ sessionKey: "root" }),
				session({ sessionKey: "child", kind: "subagent", depth: 1 }),
				session({ sessionKey: "grandchild", kind: "subagent", depth: 2 }),
				session({ sessionKey: "old", startedAtMs: at("2026-02-01", 10) }),
			],
			WEEK,
		);
		expect(workflow.sessions).toBe(3);
		expect(workflow.rootSessions).toBe(1);
		expect(workflow.subagentSessions).toBe(2);
		expect(workflow.orchestrationShare).toBeCloseTo(2 / 3);
		expect(workflow.maxDepth).toBe(2);
		expect(workflow.depthHistogram).toEqual({ "1": 1, "2": 1 });
	});
});

describe("buildSpan", () => {
	it("buckets root sessions by span and ignores subagents", () => {
		const start = at("2026-03-02", 9);
		const span = buildSpan(
			[
				session({ sessionKey: "quick", lastActivityMs: start + 5 * 60_000 }),
				session({ sessionKey: "hour", lastActivityMs: start + 40 * 60_000 }),
				session({
					sessionKey: "afternoon",
					lastActivityMs: start + 3 * 3_600_000,
				}),
				session({ sessionKey: "day", lastActivityMs: start + 11 * 3_600_000 }),
				session({
					sessionKey: "resumed",
					lastActivityMs: start + 3 * 86_400_000,
				}),
				session({
					sessionKey: "child",
					kind: "subagent",
					lastActivityMs: start + 60_000,
				}),
			].map((entry) => ({ ...entry, startedAtMs: start })),
			WEEK,
		);
		expect(span.buckets).toEqual({
			under10m: 1,
			under1h: 1,
			under4h: 1,
			under24h: 1,
			over24h: 1,
		});
	});
});

describe("buildLifecycle", () => {
	it("counts only terminal states, so open or unknown sessions never read as outcomes", () => {
		const lifecycle = buildLifecycle(
			[
				session({ sessionKey: "done", outcome: "completed" }),
				session({ sessionKey: "failed", outcome: "failed" }),
				session({ sessionKey: "aborted", outcome: "aborted" }),
				session({ sessionKey: "idle", outcome: "running" }),
				session({ sessionKey: "codex", outcome: "unknown" }),
				session({ sessionKey: "child", kind: "subagent", outcome: "failed" }),
			],
			WEEK,
		);
		expect(lifecycle).toEqual({ terminalSessions: 3, failedSessions: 2 });
	});
});

describe("buildCombinedPatterns", () => {
	it("derives peak hour, night share and active days from the union of sources", () => {
		const combined = buildCombinedPatterns(
			[
				...[1, 2, 3].map((i) =>
					session({
						source: "codex",
						sessionKey: `codex-${i}`,
						startedAtMs: at("2026-03-02", 10, i),
					}),
				),
				session({
					source: "cline",
					sessionKey: "cline-night",
					startedAtMs: at("2026-03-04", 1),
				}),
				session({
					source: "cline",
					sessionKey: "cline-late",
					startedAtMs: at("2026-03-04", 23),
				}),
			],
			WEEK,
		);
		expect(combined.rhythm.peakHour).toBe(10);
		expect(combined.rhythm.nightShare).toBeCloseTo(1 / 5);
		expect(combined.rhythm.activeDays).toBe(2);
		expect(combined.workflow.sessions).toBe(5);
	});
});

function writeRollout(
	dir: string,
	name: string,
	firstLine: unknown,
	touchedAtMs: number,
): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, name);
	writeFileSync(file, `${JSON.stringify(firstLine)}\n`);
	touch(file, touchedAtMs);
	return file;
}

function sessionMeta(payload: Record<string, unknown>) {
	return {
		timestamp: "2026-03-02T10:00:00.000Z",
		type: "session_meta",
		payload,
	};
}

describe("readCodexSessions", () => {
	const touched = at("2026-03-07", 12);

	it("treats every subagent origin as orchestration and reads depth from thread_spawn", async () => {
		const home = tempDir("usage-codex-");
		const dir = join(home, "sessions", "2026", "03", "02");
		writeRollout(
			dir,
			"rollout-2026-03-02T10-00-00-a.jsonl",
			sessionMeta({
				id: "root",
				cwd: "/Users/me/GitHub/demo",
				source: "vscode",
			}),
			touched,
		);
		writeRollout(
			dir,
			"rollout-2026-03-02T10-01-00-b.jsonl",
			sessionMeta({
				id: "spawned",
				source: {
					subagent: { thread_spawn: { parent_thread_id: "root", depth: 2 } },
				},
			}),
			touched,
		);
		writeRollout(
			dir,
			"rollout-2026-03-02T10-02-00-c.jsonl",
			sessionMeta({ id: "review", source: { subagent: "review" } }),
			touched,
		);
		writeRollout(
			dir,
			"rollout-2026-03-02T10-03-00-d.jsonl",
			sessionMeta({ id: "other", source: { subagent: { other: "guardian" } } }),
			touched,
		);

		const result = await readCodexSessions(
			roots({ codexHome: home }),
			readOptions(WEEK.sinceMs),
		);
		const kinds = Object.fromEntries(
			result.sessions.map((s) => [s.sessionKey, s.kind]),
		);
		expect(kinds).toEqual({
			root: "root",
			spawned: "subagent",
			review: "subagent",
			other: "subagent",
		});
		expect(result.sessions.find((s) => s.sessionKey === "spawned")?.depth).toBe(
			2,
		);
		expect(result.sessions.find((s) => s.sessionKey === "root")?.project).toBe(
			"GitHub/demo",
		);
	});

	it("takes the start time from session_meta, not the file name", async () => {
		const home = tempDir("usage-codex-time-");
		writeRollout(
			join(home, "sessions", "2026", "03", "02"),
			"rollout-2026-03-02T10-00-00-a.jsonl",
			{
				type: "session_meta",
				payload: { id: "a", timestamp: "2026-03-02T01:23:45.000Z" },
			},
			touched,
		);
		const result = await readCodexSessions(
			roots({ codexHome: home }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions[0]?.startedAtMs).toBe(
			Date.parse("2026-03-02T01:23:45.000Z"),
		);
	});

	it("counts files it cannot read instead of guessing", async () => {
		const home = tempDir("usage-codex-skip-");
		const dir = join(home, "sessions", "2026", "03", "02");
		writeRollout(
			dir,
			"rollout-2026-03-02T10-00-00-a.jsonl",
			sessionMeta({ id: "ok" }),
			touched,
		);
		writeRollout(
			dir,
			"rollout-2026-03-02T10-01-00-b.jsonl",
			{ type: "response_item", payload: {} },
			touched,
		);
		const empty = join(dir, "rollout-2026-03-02T10-02-00-c.jsonl");
		writeFileSync(empty, "");
		touch(empty, touched);

		const result = await readCodexSessions(
			roots({ codexHome: home }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions.map((s) => s.sessionKey)).toEqual(["ok"]);
		expect(result.availability.coverage).toMatchObject({
			scanned: 3,
			recognized: 1,
			skipped: { [SKIP_REASONS.unrecognized]: 1, [SKIP_REASONS.emptyFile]: 1 },
		});
	});

	it("leaves the whole source out when most recent files are in an unknown format", async () => {
		const home = tempDir("usage-codex-format-");
		const dir = join(home, "sessions", "2026", "03", "02");
		for (let i = 0; i < 10; i += 1) {
			writeRollout(
				dir,
				`rollout-2026-03-02T10-00-0${i}-x${i}.jsonl`,
				{ kind: "renamed_meta", data: {} },
				touched,
			);
		}
		writeRollout(
			dir,
			"rollout-2026-03-02T11-00-00-ok.jsonl",
			sessionMeta({ id: "ok" }),
			touched,
		);

		const result = await readCodexSessions(
			roots({ codexHome: home }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions).toEqual([]);
		expect(result.availability.note).toBe("session format not recognized");
	});

	it("never opens files last touched before the window", async () => {
		const home = tempDir("usage-codex-old-");
		const dir = join(home, "sessions", "2026", "01", "02");
		writeRollout(
			dir,
			"rollout-2026-01-02T10-00-00-old.jsonl",
			{ not: "a rollout" },
			at("2026-01-02", 11),
		);

		const result = await readCodexSessions(
			roots({ codexHome: home }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions).toEqual([]);
		expect(result.availability.coverage.scanned).toBe(0);
		expect(result.availability.coverage.oldestSessionMs).toBe(
			at("2026-01-02", 10),
		);
	});

	it("reports a session_meta longer than the read budget as such, not as a format change", async () => {
		const home = tempDir("usage-codex-huge-meta-");
		writeRollout(
			join(home, "sessions", "2026", "03", "02"),
			"rollout-2026-03-02T10-00-00-huge.jsonl",
			sessionMeta({ id: "huge", base_instructions: "i".repeat(400 * 1024) }),
			touched,
		);
		const result = await readCodexSessions(
			roots({ codexHome: home }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions).toEqual([]);
		expect(result.availability.coverage.skipped).toEqual({
			[SKIP_REASONS.headTooLarge]: 1,
		});
	});

	it("reports the source as not installed when the store is absent", async () => {
		const result = await readCodexSessions(
			roots({}),
			readOptions(WEEK.sinceMs),
		);
		expect(result.availability.installed).toBe(false);
		expect(result.sessions).toEqual([]);
	});
});

function writeTranscript(
	file: string,
	lines: unknown[],
	touchedAtMs: number,
): void {
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(
		file,
		`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
	);
	touch(file, touchedAtMs);
}

describe("readClaudeSessions", () => {
	const touched = at("2026-03-07", 12);

	it("labels every session in a project directory with that directory's project", async () => {
		const projects = tempDir("usage-claude-");
		const projectDir = join(projects, "-Users-me-GitHub-demo");
		writeTranscript(
			join(projectDir, "root-session.jsonl"),
			[
				{
					type: "user",
					isSidechain: false,
					cwd: "/Users/me/GitHub/demo",
					timestamp: "2026-03-02T09:00:00.000Z",
				},
			],
			touched,
		);
		// The subagent ran in a subdirectory; it still belongs to the project.
		writeTranscript(
			join(
				projectDir,
				"root-session",
				"subagents",
				"workflows",
				"wf_1",
				"agent-abc.jsonl",
			),
			[
				{
					type: "assistant",
					isSidechain: true,
					cwd: "/Users/me/GitHub/demo/packages/core",
					timestamp: "2026-03-02T09:30:00.000Z",
				},
			],
			touched,
		);

		const result = await readClaudeSessions(
			roots({ claudeProjectsDir: projects }),
			readOptions(WEEK.sinceMs),
		);
		const sessions = [...result.sessions].sort((a, b) =>
			a.sessionKey.localeCompare(b.sessionKey),
		);
		expect(sessions).toEqual([
			expect.objectContaining({
				sessionKey: "root-session",
				kind: "root",
				project: "GitHub/demo",
			}),
			expect.objectContaining({
				sessionKey: "root-session/agent-abc",
				kind: "subagent",
				project: "GitHub/demo",
			}),
		]);
	});

	it("treats a sidechain transcript at the project root as a subagent", async () => {
		const projects = tempDir("usage-claude-sidechain-");
		writeTranscript(
			join(projects, "-Users-me-GitHub-demo", "agent-legacy.jsonl"),
			[
				{
					type: "assistant",
					isSidechain: true,
					cwd: "/Users/me/GitHub/demo",
					timestamp: "2026-03-02T09:30:00.000Z",
				},
			],
			touched,
		);
		const result = await readClaudeSessions(
			roots({ claudeProjectsDir: projects }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions[0]?.kind).toBe("subagent");
	});

	it("skips transcripts it does not recognize", async () => {
		const projects = tempDir("usage-claude-unknown-");
		writeTranscript(
			join(projects, "-Users-me-demo", "odd.jsonl"),
			[{ event: "started" }],
			touched,
		);
		const result = await readClaudeSessions(
			roots({ claudeProjectsDir: projects }),
			readOptions(WEEK.sinceMs),
		);
		expect(result.sessions).toEqual([]);
		expect(result.availability.coverage.skipped).toEqual({
			[SKIP_REASONS.unrecognized]: 1,
		});
	});

	it("does not mistake a subagent whose first message outgrows the budget for an unknown format", async () => {
		const projects = tempDir("usage-claude-huge-");
		writeTranscript(
			join(projects, "-Users-me-demo", "root", "subagents", "agent-big.jsonl"),
			[
				{
					type: "user",
					isSidechain: true,
					cwd: "/Users/me/demo",
					message: "m".repeat(400 * 1024),
					timestamp: "2026-03-02T09:30:00.000Z",
				},
			],
			touched,
		);
		const result = await readClaudeSessions(
			roots({ claudeProjectsDir: projects }),
			readOptions(WEEK.sinceMs),
		);
		// Its start comes from the file's creation time where the filesystem
		// records one; either way it is never counted as a format change.
		expect(
			result.availability.coverage.skipped[SKIP_REASONS.unrecognized],
		).toBeUndefined();
		for (const session of result.sessions) {
			expect(session.kind).toBe("subagent");
		}
	});
});

describe("readClineSessions", () => {
	it("reads lifecycle state from the session index", async () => {
		const dir = tempDir("usage-cline-");
		const dbPath = join(dir, "sessions.db");
		const db = loadSqliteDb(dbPath);
		db.exec(`CREATE TABLE sessions (
			session_id TEXT PRIMARY KEY, started_at TEXT, ended_at TEXT, updated_at TEXT,
			status TEXT, exit_code INTEGER, cwd TEXT, is_subagent INTEGER)`);
		const insert = db.prepare(
			"INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		);
		const iso = (ms: number) => new Date(ms).toISOString();
		const start = at("2026-03-04", 10);
		insert.run(
			"done",
			iso(start),
			iso(start + 60_000),
			iso(start + 60_000),
			"completed",
			0,
			"/Users/me/GitHub/demo",
			0,
		);
		insert.run(
			"idle",
			iso(start),
			null,
			iso(start + 120_000),
			"idle",
			null,
			"/Users/me/GitHub/demo",
			0,
		);
		insert.run(
			"broke",
			iso(start),
			iso(start + 60_000),
			iso(start + 60_000),
			"failed",
			1,
			"/Users/me/GitHub/demo",
			0,
		);
		insert.run(
			"child",
			iso(start),
			iso(start + 30_000),
			iso(start + 30_000),
			"completed",
			0,
			"/Users/me/GitHub/demo",
			1,
		);
		insert.run(
			"garbled",
			"not a date",
			null,
			"not a date",
			"completed",
			0,
			"",
			0,
		);
		db.close?.();

		const result = await readClineSessions(
			roots({ clineSessionsDb: dbPath }),
			readOptions(WEEK.sinceMs),
		);
		expect(
			Object.fromEntries(result.sessions.map((s) => [s.sessionKey, s.outcome])),
		).toEqual({
			done: "completed",
			idle: "running",
			broke: "failed",
			child: "completed",
		});
		expect(
			result.sessions.find((s) => s.sessionKey === "idle")?.lastActivityMs,
		).toBe(start + 120_000);
		expect(result.availability.coverage.skipped).toEqual({
			[SKIP_REASONS.unreadableRow]: 1,
		});
		expect(buildLifecycle(result.sessions, WEEK)).toEqual({
			terminalSessions: 2,
			failedSessions: 1,
		});
	});
});

describe("UsagePatternsService", () => {
	const NOW = at("2026-04-15", 12);

	function codexStore(files: number, touchedAtMs: number): string {
		const home = tempDir("usage-service-");
		const dir = join(home, "sessions", "2026", "04", "14");
		for (let i = 0; i < files; i += 1) {
			writeRollout(
				dir,
				`rollout-2026-04-14T10-00-${String(i).padStart(2, "0")}-s${i}.jsonl`,
				{
					type: "session_meta",
					payload: {
						id: `s${i}`,
						timestamp: new Date(at("2026-04-14", 10, i % 60)).toISOString(),
						cwd: "/Users/me/GitHub/demo",
					},
				},
				touchedAtMs,
			);
		}
		return home;
	}

	it("drops sessions outside the window and caches the report", async () => {
		const home = tempDir("usage-service-window-");
		writeRollout(
			join(home, "sessions", "2026", "03", "02"),
			"rollout-2026-03-02T10-00-00-old.jsonl",
			{
				type: "session_meta",
				payload: {
					id: "old",
					timestamp: new Date(at("2026-03-02", 10)).toISOString(),
				},
			},
			at("2026-03-02", 10),
		);
		const service = new UsagePatternsService({
			roots: roots({ codexHome: home }),
			now: () => NOW,
		});
		const codexSessions = (report: Awaited<ReturnType<typeof service.read>>) =>
			report.sources.find((s) => s.availability.source === "codex")?.workflow
				.sessions;

		const wide = await service.read(90);
		expect(codexSessions(wide)).toBe(1);
		expect(await service.read(90)).toBe(wide);
		expect(codexSessions(await service.read(7))).toBe(0);
	});

	it("shares one scan between concurrent callers", async () => {
		const service = new UsagePatternsService({
			roots: roots({ codexHome: codexStore(3, at("2026-04-14", 11)) }),
			now: () => NOW,
		});
		const [first, second] = await Promise.all([
			service.read(30),
			service.read(30),
		]);
		expect(first).toBe(second);
	});

	it("yields to the event loop while it scans", async () => {
		const home = codexStore(20, at("2026-04-14", 11));
		const tickedBeforeReport = async (sliceMs: number) => {
			const service = new UsagePatternsService({
				roots: roots({ codexHome: home }),
				now: () => NOW,
				sliceMs,
			});
			let ticked = false;
			const report = service.read(30).then(() => ticked);
			setImmediate(() => {
				ticked = true;
			});
			return await report;
		};
		expect(await tickedBeforeReport(0)).toBe(true);
		expect(await tickedBeforeReport(60_000)).toBe(false);
	});

	it("merges every installed source into the combined view", async () => {
		const codexHome = codexStore(2, at("2026-04-14", 11));
		const projects = tempDir("usage-service-claude-");
		writeTranscript(
			join(projects, "-Users-me-GitHub-demo", "root-session.jsonl"),
			[
				{
					type: "user",
					cwd: "/Users/me/GitHub/demo",
					timestamp: new Date(at("2026-04-12", 9)).toISOString(),
				},
			],
			at("2026-04-12", 9, 30),
		);
		const service = new UsagePatternsService({
			roots: roots({ codexHome, claudeProjectsDir: projects }),
			now: () => NOW,
		});
		const report = await service.read(30);
		expect(report.combined.workflow.sessions).toBe(3);
		expect(report.combined.rhythm.activeDays).toBe(2);
		expect(report.combined.projects[0]).toMatchObject({
			project: "GitHub/demo",
			sessions: 3,
		});
	});

	it("spans exactly rangeDays calendar days, so active days never exceed the range", async () => {
		expect(windowStartMs(at("2026-04-15", 12), 7)).toBe(at("2026-04-09", 0));
		expect(windowStartMs(at("2026-04-15", 12), 1)).toBe(at("2026-04-15", 0));

		const home = tempDir("usage-service-calendar-");
		const dir = join(home, "sessions", "2026", "04");
		// One session a day from Apr 8 23:30 to Apr 15: eight calendar days.
		const starts = [
			at("2026-04-08", 23, 30),
			...[9, 10, 11, 12, 13, 14, 15].map((day) =>
				at(`2026-04-${String(day).padStart(2, "0")}`, 10),
			),
		];
		starts.forEach((startedAt, index) => {
			writeRollout(
				dir,
				`rollout-2026-04-${String(index).padStart(2, "0")}T10-00-00-s${index}.jsonl`,
				{
					type: "session_meta",
					payload: {
						id: `s${index}`,
						timestamp: new Date(startedAt).toISOString(),
					},
				},
				startedAt + 60_000,
			);
		});
		const service = new UsagePatternsService({
			roots: roots({ codexHome: home }),
			now: () => at("2026-04-15", 12),
		});
		const report = await service.read(7);
		expect(report.combined.rhythm.activeDays).toBe(7);
		expect(report.combined.workflow.sessions).toBe(7);
	});
});
