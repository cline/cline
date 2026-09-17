import type { Dirent } from "node:fs";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { loadSqliteDb } from "@cline/shared/db";
import { createHeadReadStats, type HeadCache, readHead } from "./head";
import type {
	SessionMeta,
	SessionOutcome,
	SourceAvailability,
	SourceCoverage,
	UsageSourceId,
} from "./types";

/** A Codex rollout opens with session_meta, which embeds the base instructions (~160 KB). */
const CODEX_HEAD = { maxBytes: 256 * 1024, maxLineBytes: 256 * 1024 };
/** Claude Code repeats its metadata on every message line; long lines are message bodies. */
const CLAUDE_HEAD = { maxBytes: 256 * 1024, maxLineBytes: 64 * 1024 };

/**
 * A store whose recent files mostly fail to parse has changed format. The
 * whole source is then left out rather than reported from whichever files
 * happened to parse.
 */
const FORMAT_CHECK_MIN_FILES = 10;
const FORMAT_CHECK_MAX_UNRECOGNIZED_SHARE = 0.5;

export const SKIP_REASONS = {
	unrecognized: "unrecognized format",
	/** The metadata line is longer than the read budget; not a format change. */
	headTooLarge: "metadata beyond read budget",
	noStartTime: "no start time",
	emptyFile: "empty file",
	unreadableRow: "unreadable row",
} as const;

const ROLLOUT_NAME = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/;

export interface UsageSourceRoots {
	codexHome: string;
	claudeProjectsDir: string;
	clineSessionsDb: string;
}

export function defaultUsageRoots(): UsageSourceRoots {
	const home = homedir();
	return {
		codexHome: process.env.CODEX_HOME?.trim() || join(home, ".codex"),
		claudeProjectsDir: process.env.CLAUDE_CONFIG_DIR?.trim()
			? join(process.env.CLAUDE_CONFIG_DIR.trim(), "projects")
			: join(home, ".claude", "projects"),
		clineSessionsDb: join(home, ".cline", "data", "db", "sessions.db"),
	};
}

export interface SourceReadOptions {
	/** Files last touched before this are outside the window and never opened. */
	sinceMs: number;
	cache: HeadCache;
	yieldIfBusy: () => Promise<void>;
}

export interface SourceReadResult {
	availability: SourceAvailability;
	sessions: SessionMeta[];
}

/** Last two path segments are enough to recognize a project in a chart. */
export function projectFromCwd(cwd: string): string {
	const parts = cwd.split(/[\\/]+/).filter(Boolean);
	if (parts.length === 0) return "";
	return parts.slice(-2).join("/");
}

/**
 * Claude Code names a project directory after the cwd it was launched in,
 * with every character other than a letter or digit replaced by "-".
 */
export function claudeProjectDirName(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Last resort for a directory whose sessions never recorded a cwd. Lossy: a
 * "-" in a real directory name reads the same as a path separator.
 */
export function projectFromClaudeDir(dirName: string): string {
	const parts = dirName.replace(/^-+/, "").split("-").filter(Boolean);
	if (parts.length === 0) return "";
	return parts.slice(-2).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function asNumber(value: unknown): number | undefined {
	if (value == null || value === "") return undefined;
	const num = Number(value);
	return Number.isFinite(num) ? num : undefined;
}

interface FileEntry {
	file: string;
	size: number;
	mtimeMs: number;
	birthtimeMs: number;
}

function statFile(file: string): FileEntry | undefined {
	try {
		const stat = statSync(file);
		if (!stat.isFile()) return undefined;
		return {
			file,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			birthtimeMs: stat.birthtimeMs,
		};
	} catch {
		return undefined;
	}
}

/** File creation time, where the filesystem records a usable one. */
function creationTimeMs(entry: FileEntry): number | undefined {
	return entry.birthtimeMs > 0 && entry.birthtimeMs <= entry.mtimeMs
		? entry.birthtimeMs
		: undefined;
}

function listEntries(dir: string): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

async function collectFiles(
	dir: string,
	match: (name: string) => boolean,
	options: SourceReadOptions,
	out: string[] = [],
): Promise<string[]> {
	for (const entry of listEntries(dir)) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(full, match, options, out);
		} else if (entry.isFile() && match(entry.name)) {
			out.push(full);
		}
	}
	await options.yieldIfBusy();
	return out;
}

class CoverageCounter {
	scanned = 0;
	recognized = 0;
	private readonly skipped: Record<string, number> = {};
	private oldest = Number.POSITIVE_INFINITY;

	skip(reason: string): void {
		this.skipped[reason] = (this.skipped[reason] ?? 0) + 1;
	}

	sawSession(startedAtMs: number | undefined): void {
		if (startedAtMs != null && startedAtMs < this.oldest) {
			this.oldest = startedAtMs;
		}
	}

	formatChanged(): boolean {
		const unrecognized = this.skipped[SKIP_REASONS.unrecognized] ?? 0;
		return (
			this.scanned >= FORMAT_CHECK_MIN_FILES &&
			unrecognized / this.scanned > FORMAT_CHECK_MAX_UNRECOGNIZED_SHARE
		);
	}

	snapshot(): SourceCoverage {
		return {
			scanned: this.scanned,
			recognized: this.recognized,
			skipped: { ...this.skipped },
			oldestSessionMs: Number.isFinite(this.oldest) ? this.oldest : null,
		};
	}
}

export function emptyCoverage(): SourceCoverage {
	return { scanned: 0, recognized: 0, skipped: {}, oldestSessionMs: null };
}

function notInstalled(source: UsageSourceId, root: string): SourceReadResult {
	return {
		availability: { source, root, installed: false, coverage: emptyCoverage() },
		sessions: [],
	};
}

function finish(
	source: UsageSourceId,
	root: string,
	coverage: CoverageCounter,
	sessions: SessionMeta[],
): SourceReadResult {
	if (coverage.formatChanged()) {
		return {
			availability: {
				source,
				root,
				installed: true,
				note: "session format not recognized",
				coverage: coverage.snapshot(),
			},
			sessions: [],
		};
	}
	return {
		availability: {
			source,
			root,
			installed: true,
			coverage: coverage.snapshot(),
		},
		sessions,
	};
}

// ── Codex ──────────────────────────────────────────────────────────────────

type CodexHead =
	| { recognized: false; reason: string }
	| {
			recognized: true;
			id?: string;
			cwd: string;
			startedAtMs?: number;
			subagent: boolean;
			depth?: number;
	  };

/** Rollout names carry local wall-clock time; only a fallback for session_meta. */
function rolloutNameTimeMs(name: string): number | undefined {
	const match = ROLLOUT_NAME.exec(name);
	if (!match) return undefined;
	const ms = Date.parse(
		`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`,
	);
	return Number.isFinite(ms) ? ms : undefined;
}

function readCodexHead(file: string): CodexHead {
	const stats = createHeadReadStats();
	const [first] = readHead(file, { ...CODEX_HEAD, stats, until: () => true });
	if (!first) {
		return {
			recognized: false,
			reason:
				stats.bytesRead === 0
					? SKIP_REASONS.emptyFile
					: stats.linesSkipped > 0
						? SKIP_REASONS.headTooLarge
						: SKIP_REASONS.unrecognized,
		};
	}
	const payload = first.payload;
	if (first.type !== "session_meta" || !isRecord(payload)) {
		return { recognized: false, reason: SKIP_REASONS.unrecognized };
	}
	// Any subagent origin — a spawned thread, a review, a compaction — is
	// orchestration, not a session the user started.
	const origin = isRecord(payload.source) ? payload.source : undefined;
	const subagent = origin?.subagent;
	const spawn =
		isRecord(subagent) && isRecord(subagent.thread_spawn)
			? subagent.thread_spawn
			: undefined;
	return {
		recognized: true,
		id: typeof payload.id === "string" && payload.id ? payload.id : undefined,
		cwd: typeof payload.cwd === "string" ? payload.cwd : "",
		startedAtMs:
			parseTimestamp(payload.timestamp) ?? parseTimestamp(first.timestamp),
		subagent: subagent != null,
		depth: spawn ? asNumber(spawn.depth) : undefined,
	};
}

/**
 * Codex writes one rollout per thread under sessions/YYYY/MM/DD, and records
 * orchestration inline: a subagent rollout's session_meta carries
 * `payload.source.subagent`. Only that first line is read.
 */
export async function readCodexSessions(
	roots: UsageSourceRoots,
	options: SourceReadOptions,
): Promise<SourceReadResult> {
	const root = join(roots.codexHome, "sessions");
	if (!existsSync(root)) return notInstalled("codex", root);

	const coverage = new CoverageCounter();
	const sessions: SessionMeta[] = [];
	const files = await collectFiles(
		root,
		(name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
		options,
	);
	for (const file of files) {
		const entry = statFile(file);
		if (!entry) continue;
		const name = basename(file);
		const nameTimeMs = rolloutNameTimeMs(name);
		coverage.sawSession(nameTimeMs ?? creationTimeMs(entry) ?? entry.mtimeMs);
		if (entry.mtimeMs < options.sinceMs) continue;

		coverage.scanned += 1;
		const head = options.cache.get(file, entry, () => readCodexHead(file));
		await options.yieldIfBusy();
		if (!head.recognized) {
			coverage.skip(head.reason);
			continue;
		}
		// session_meta's timestamp is zoned; the name is only local wall time.
		const startedAtMs = head.startedAtMs ?? nameTimeMs;
		if (startedAtMs == null) {
			coverage.skip(SKIP_REASONS.noStartTime);
			continue;
		}
		coverage.recognized += 1;
		sessions.push({
			source: "codex",
			sessionKey:
				head.id ?? name.replace(/^rollout-/, "").replace(/\.jsonl$/, ""),
			kind: head.subagent ? "subagent" : "root",
			...(head.depth != null ? { depth: head.depth } : {}),
			project: projectFromCwd(head.cwd),
			startedAtMs,
			lastActivityMs: Math.max(entry.mtimeMs, startedAtMs),
			outcome: "unknown",
		});
	}
	return finish("codex", root, coverage, sessions);
}

// ── Claude Code ────────────────────────────────────────────────────────────

interface ClaudeHead {
	recognized: boolean;
	empty: boolean;
	startedAtMs?: number;
	cwd?: string;
	sidechain: boolean;
}

function readClaudeHead(file: string): ClaudeHead {
	const stats = createHeadReadStats();
	const lines = readHead(file, {
		...CLAUDE_HEAD,
		stats,
		until: (line) =>
			typeof line.timestamp === "string" && typeof line.cwd === "string",
	});
	let recognized = false;
	let sidechain = false;
	let startedAtMs: number | undefined;
	let cwd: string | undefined;
	for (const line of lines) {
		if (typeof line.type === "string") recognized = true;
		if (line.isSidechain === true) sidechain = true;
		startedAtMs ??= parseTimestamp(line.timestamp);
		if (cwd == null && typeof line.cwd === "string") cwd = line.cwd;
	}
	return {
		// Nothing but over-long lines within the budget — including a first line
		// the budget cut off — is a transcript whose opening message is large,
		// not a format this reader does not know.
		recognized: recognized || (lines.length === 0 && stats.linesSkipped > 0),
		empty: stats.bytesRead === 0,
		startedAtMs,
		cwd,
		sidechain,
	};
}

interface ClaudeCandidate {
	entry: FileEntry;
	nested: boolean;
	sessionKey: string;
}

/**
 * One label per project directory. Subagents often run in a subdirectory or a
 * worktree, and labelling each file by its own cwd split one project into
 * several; the directory is the project, so its sessions share a label.
 */
function resolveClaudeProject(
	dirName: string,
	heads: Array<{ candidate: ClaudeCandidate; head: ClaudeHead }>,
): string {
	for (const { head } of heads) {
		if (head.cwd && claudeProjectDirName(head.cwd) === dirName) {
			return projectFromCwd(head.cwd);
		}
	}
	for (const { candidate, head } of heads) {
		if (!candidate.nested && head.cwd) return projectFromCwd(head.cwd);
	}
	return projectFromClaudeDir(dirName);
}

/**
 * Claude Code stores root transcripts as `<project>/<sessionId>.jsonl` and
 * subagent runs under `<project>/<sessionId>/subagents/` (directly or in
 * `workflows/<wf_*>/`). Directory layout decides the kind; a bounded head read
 * supplies the start time and the project's cwd.
 */
export async function readClaudeSessions(
	roots: UsageSourceRoots,
	options: SourceReadOptions,
): Promise<SourceReadResult> {
	const root = roots.claudeProjectsDir;
	if (!existsSync(root)) return notInstalled("claude-code", root);

	const coverage = new CoverageCounter();
	const sessions: SessionMeta[] = [];
	for (const projectEntry of listEntries(root)) {
		if (!projectEntry.isDirectory()) continue;
		const projectDir = join(root, projectEntry.name);

		const candidates: ClaudeCandidate[] = [];
		for (const entry of listEntries(projectDir)) {
			const full = join(projectDir, entry.name);
			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				const stat = statFile(full);
				if (stat) {
					candidates.push({
						entry: stat,
						nested: false,
						sessionKey: basename(entry.name, ".jsonl"),
					});
				}
			} else if (entry.isDirectory()) {
				const agentFiles = await collectFiles(
					join(full, "subagents"),
					(name) => name.startsWith("agent-") && name.endsWith(".jsonl"),
					options,
				);
				for (const file of agentFiles) {
					const stat = statFile(file);
					if (stat) {
						candidates.push({
							entry: stat,
							nested: true,
							sessionKey: `${entry.name}/${basename(file, ".jsonl")}`,
						});
					}
				}
			}
		}

		const heads: Array<{ candidate: ClaudeCandidate; head: ClaudeHead }> = [];
		for (const candidate of candidates) {
			coverage.sawSession(
				creationTimeMs(candidate.entry) ?? candidate.entry.mtimeMs,
			);
			if (candidate.entry.mtimeMs < options.sinceMs) continue;
			heads.push({
				candidate,
				head: options.cache.get(candidate.entry.file, candidate.entry, () =>
					readClaudeHead(candidate.entry.file),
				),
			});
			await options.yieldIfBusy();
		}
		if (heads.length === 0) continue;

		const project = resolveClaudeProject(projectEntry.name, heads);
		for (const { candidate, head } of heads) {
			coverage.scanned += 1;
			if (head.empty) {
				coverage.skip(SKIP_REASONS.emptyFile);
				continue;
			}
			if (!head.recognized) {
				coverage.skip(SKIP_REASONS.unrecognized);
				continue;
			}
			// A transcript is created when its session starts, so the file's
			// creation time is that same moment when the head holds no timestamp.
			const startedAtMs = head.startedAtMs ?? creationTimeMs(candidate.entry);
			if (startedAtMs == null) {
				coverage.skip(SKIP_REASONS.noStartTime);
				continue;
			}
			coverage.recognized += 1;
			sessions.push({
				source: "claude-code",
				sessionKey: candidate.sessionKey,
				kind: candidate.nested || head.sidechain ? "subagent" : "root",
				project,
				startedAtMs,
				lastActivityMs: Math.max(candidate.entry.mtimeMs, startedAtMs),
				outcome: "unknown",
			});
		}
	}
	return finish("claude-code", root, coverage, sessions);
}

// ── Cline ──────────────────────────────────────────────────────────────────

function clineOutcome(status: unknown, exitCode: unknown): SessionOutcome {
	const normalized = typeof status === "string" ? status.toLowerCase() : "";
	if (normalized === "completed" || normalized === "success") {
		return "completed";
	}
	if (
		normalized === "aborted" ||
		normalized === "cancelled" ||
		normalized === "canceled"
	) {
		return "aborted";
	}
	if (normalized.includes("fail") || normalized.includes("error")) {
		return "failed";
	}
	if (
		normalized === "running" ||
		normalized === "idle" ||
		normalized === "pending"
	) {
		return "running";
	}
	const code = asNumber(exitCode);
	if (code != null && code !== 0) return "failed";
	return "unknown";
}

/**
 * Cline is the one source with real lifecycle state (status + exit code), read
 * straight from its session index. Message files are never opened.
 */
export async function readClineSessions(
	roots: UsageSourceRoots,
	options: SourceReadOptions,
): Promise<SourceReadResult> {
	const dbPath = roots.clineSessionsDb;
	if (!existsSync(dbPath)) return notInstalled("cline", dbPath);

	const coverage = new CoverageCounter();
	const sessions: SessionMeta[] = [];
	try {
		const db = loadSqliteDb(dbPath);
		try {
			const rows = db
				.prepare(
					`SELECT session_id, started_at, ended_at, updated_at, status, exit_code,
					        cwd, is_subagent
					   FROM sessions`,
				)
				.all();
			for (const row of rows) {
				const sessionKey =
					typeof row.session_id === "string" ? row.session_id.trim() : "";
				const startedAtMs = parseTimestamp(row.started_at);
				if (!sessionKey || startedAtMs == null) {
					coverage.scanned += 1;
					coverage.skip(SKIP_REASONS.unreadableRow);
					continue;
				}
				coverage.sawSession(startedAtMs);
				const lastActivityMs =
					parseTimestamp(row.ended_at) ?? parseTimestamp(row.updated_at);
				if (Math.max(startedAtMs, lastActivityMs ?? 0) < options.sinceMs) {
					continue;
				}
				coverage.scanned += 1;
				coverage.recognized += 1;
				sessions.push({
					source: "cline",
					sessionKey,
					kind: Number(row.is_subagent) === 1 ? "subagent" : "root",
					project: projectFromCwd(typeof row.cwd === "string" ? row.cwd : ""),
					startedAtMs,
					...(lastActivityMs != null
						? { lastActivityMs: Math.max(lastActivityMs, startedAtMs) }
						: {}),
					outcome: clineOutcome(row.status, row.exit_code),
				});
			}
		} finally {
			db.close?.();
		}
	} catch {
		return {
			availability: {
				source: "cline",
				root: dbPath,
				installed: true,
				note: "sessions.db unreadable",
				coverage: emptyCoverage(),
			},
			sessions: [],
		};
	}
	await options.yieldIfBusy();
	return finish("cline", dbPath, coverage, sessions);
}
