import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { version as cliVersion } from "../../package.json";
import type { LoadedSessionReplay } from "../session/replay";
import type { CliOutputMode } from "../utils/types";

type SessionCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export const SESSION_REPLAY_MODES = ["playback"] as const;
export const SESSION_REPLAY_FORMATS = ["tui", "text", "json"] as const;
export type SessionReplayFormat = (typeof SESSION_REPLAY_FORMATS)[number];
export const SESSION_DIFF_FORMATS = ["text", "json"] as const;

/** `session diff` exit codes, following diff(1). */
export const SESSION_DIFF_EXIT = { same: 0, diverged: 1, error: 2 } as const;

/** Tool result lines shown per call in text playback. */
const TEXT_MAX_RESULT_LINES = 40;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function runSessionExport(input: {
	sessionId: string;
	bundleDir: string;
	redact: boolean;
	overwrite: boolean;
	outputMode: CliOutputMode;
	io: SessionCommandIo;
}): Promise<number> {
	const { io } = input;
	const sessionId = input.sessionId.trim();
	if (!sessionId) {
		io.writeErr("session export requires <session-id>");
		return 1;
	}
	if (!input.bundleDir.trim()) {
		io.writeErr("session export requires --bundle <dir>");
		return 1;
	}
	const bundleDir = resolve(input.bundleDir);
	try {
		const { exportSessionReplay } = await import("../session/session");
		const result = await exportSessionReplay({
			sessionId,
			bundleDir,
			redact: input.redact,
			overwrite: input.overwrite,
			hostVersion: cliVersion,
		});
		const [entry] = result.manifest.sessions;
		if (input.outputMode === "json") {
			writeJson({
				sessionId,
				bundleDir,
				schemaVersion: result.manifest.schemaVersion,
				counts: entry?.counts,
				eventsSource: entry?.eventsSource,
				recording: entry?.recording
					? {
							counts: entry.recording.counts,
							coverage: entry.recording.coverage,
						}
					: null,
				files: result.manifest.files.map((file) => file.path),
				redaction: result.manifest.redaction,
				warnings: result.warnings,
			});
			return 0;
		}
		for (const warning of result.warnings) {
			io.writeErr(`warning: ${warning}`);
		}
		io.writeln(`Exported session ${sessionId} to ${bundleDir}`);
		if (entry) {
			io.writeln(
				`  ${entry.counts.iterations} iterations · ${entry.counts.messages} messages · ${entry.counts.events} events (${entry.eventsSource})`,
			);
			if (entry.recording) {
				const { counts, coverage } = entry.recording;
				io.writeln(
					`  recording: ${counts.modelCalls} model calls · ${counts.decisions} decisions · ${coverage.linked}/${coverage.assistantMessages} assistant messages linked`,
				);
			}
		}
		io.writeln(
			result.manifest.redaction.enabled
				? `  redaction: on, ${result.manifest.redaction.removedCount} values removed (see redaction.json)`
				: "  redaction: off",
		);
		return 0;
	} catch (error) {
		io.writeErr(errorMessage(error));
		return 1;
	}
}

export async function runSessionValidate(input: {
	bundleDir: string;
	outputMode: CliOutputMode;
	io: SessionCommandIo;
}): Promise<number> {
	const { io } = input;
	const bundleDir = resolve(input.bundleDir);
	try {
		const { validateSessionReplayBundle } = await import("@cline/session");
		const result = await validateSessionReplayBundle(bundleDir);
		if (input.outputMode === "json") {
			writeJson({
				bundleDir,
				ok: result.ok,
				schemaVersion: result.sourceSchemaVersion,
				errors: result.errors,
				warnings: result.warnings,
			});
			return result.ok ? 0 : 1;
		}
		for (const warning of result.warnings) {
			io.writeErr(`warning: ${warning}`);
		}
		if (!result.ok) {
			io.writeErr(`Invalid session replay bundle at ${bundleDir}:`);
			for (const error of result.errors) {
				io.writeErr(`  - ${error}`);
			}
			return 1;
		}
		const sessions = result.manifest?.sessions.length ?? 0;
		const files = result.manifest?.files.length ?? 0;
		io.writeln(
			`Valid session replay bundle (schemaVersion ${result.sourceSchemaVersion}, ${sessions} session${sessions === 1 ? "" : "s"}, ${files} files)`,
		);
		return 0;
	} catch (error) {
		io.writeErr(errorMessage(error));
		return 1;
	}
}

export interface SessionDiffCommandInput {
	recordedDir: string;
	liveDir: string;
	/** Comma-separated divergence kinds that do not count; `request` names all request kinds. */
	ignore?: string;
	lenient?: boolean;
	format?: string;
	outputMode: CliOutputMode;
	io: SessionCommandIo;
}

/**
 * Compares the root sessions of two bundles (a recording and a later run of
 * the same task) iteration by iteration. Exits 0 when nothing that counts
 * diverged, 1 when it did (never with `--lenient`), and 2 when the bundles
 * could not be compared.
 */
export async function runSessionDiff(
	input: SessionDiffCommandInput,
): Promise<number> {
	const { io } = input;
	const format =
		input.format ?? (input.outputMode === "json" ? "json" : "text");
	if (!(SESSION_DIFF_FORMATS as readonly string[]).includes(format)) {
		io.writeErr(
			`Unsupported diff format "${format}". Supported formats: ${SESSION_DIFF_FORMATS.join(", ")}.`,
		);
		return SESSION_DIFF_EXIT.error;
	}
	const replay = await import("@cline/session");
	const allKinds: readonly string[] = replay.SESSION_REPLAY_DIVERGENCE_KINDS;
	const requestKinds: readonly string[] =
		replay.SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS;
	const ignored = new Set<string>();
	for (const raw of (input.ignore ?? "").split(",")) {
		const name = raw.trim();
		if (!name) continue;
		if (name === "request") {
			for (const kind of requestKinds) ignored.add(kind);
		} else if (allKinds.includes(name)) {
			ignored.add(name);
		} else {
			io.writeErr(
				`Unknown divergence kind "${name}" in --ignore. Kinds: ${allKinds.join(", ")}, or "request" for all request kinds.`,
			);
			return SESSION_DIFF_EXIT.error;
		}
	}
	const kinds = replay.SESSION_REPLAY_DIVERGENCE_KINDS.filter(
		(kind) => !ignored.has(kind),
	);

	const recordedDir = resolve(input.recordedDir);
	const liveDir = resolve(input.liveDir);
	try {
		const [recorded, live] = await Promise.all([
			replay.readSessionReplayBundle(recordedDir),
			replay.readSessionReplayBundle(liveDir),
		]);
		const rootOf = (bundle: typeof recorded) => {
			const session = bundle.sessions.find(
				(candidate) =>
					candidate.entry.sessionId === bundle.manifest.rootSessionId,
			);
			if (!session) {
				throw new Error(
					`Bundle ${bundle.dir} has no root session ${bundle.manifest.rootSessionId}.`,
				);
			}
			return session;
		};
		const recordedSession = rootOf(recorded);
		const liveSession = rootOf(live);
		const report = replay.compareSessionReplaySessions(
			recordedSession,
			liveSession,
			{ kinds, strictness: input.lenient ? "lenient" : "strict" },
		);
		const sides = {
			recorded: {
				bundleDir: recordedDir,
				sessionId: recordedSession.entry.sessionId,
			},
			live: { bundleDir: liveDir, sessionId: liveSession.entry.sessionId },
		};
		if (format === "json") {
			writeJson({ ...sides, ...report });
		} else {
			for (const warning of report.warnings) {
				io.writeErr(`warning: ${warning}`);
			}
			const { formatSessionDiffText } = await import("../session/diff");
			for (const line of formatSessionDiffText({ ...sides, report })) {
				io.writeln(line);
			}
		}
		return report.failed ? SESSION_DIFF_EXIT.diverged : SESSION_DIFF_EXIT.same;
	} catch (error) {
		io.writeErr(errorMessage(error));
		return SESSION_DIFF_EXIT.error;
	}
}

function parsePositiveInteger(
	label: string,
	value: string | undefined,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${label} must be an integer >= 1, got "${value}"`);
	}
	return parsed;
}

function parseSpeed(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`--speed must be a number >= 0, got "${value}"`);
	}
	return parsed;
}

export interface SessionReplayCommandInput {
	bundleDir: string;
	mode?: string;
	format?: string;
	from?: string;
	to?: string;
	speed?: string;
	step?: boolean;
	sessionId?: string;
	io: SessionCommandIo;
	isInteractiveTTY: boolean;
	sleep?: (ms: number) => Promise<void>;
	waitForStep?: () => Promise<boolean>;
}

const defaultSleep = (ms: number) =>
	new Promise<void>((done) => setTimeout(done, ms));

/** Waits for Enter on stdin; resolves false when the user types `q`. */
async function waitForEnter(): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	try {
		const answer = await rl.question("[enter] next · q quit ");
		return answer.trim().toLowerCase() !== "q";
	} finally {
		rl.close();
	}
}

async function playText(
	replay: LoadedSessionReplay,
	input: SessionReplayCommandInput,
	speed: number,
): Promise<void> {
	const {
		formatReplayHeaderText,
		formatReplayIterationText,
		formatReplaySummaryText,
		replayDelayMs,
	} = await import("../session/replay");
	const color = process.stdout.isTTY === true && !process.env.NO_COLOR?.trim();
	const options = { color, maxResultLines: TEXT_MAX_RESULT_LINES };
	const sleep = input.sleep ?? defaultSleep;
	const waitForStep = input.waitForStep ?? waitForEnter;
	input.io.writeln(formatReplayHeaderText(replay, options));
	for (const [position, iteration] of replay.iterations.entries()) {
		if (position > 0) {
			if (input.step) {
				if (!(await waitForStep())) {
					return;
				}
			} else {
				const delay = replayDelayMs(iteration, speed);
				if (delay > 0) {
					await sleep(delay);
				}
			}
		}
		input.io.writeln();
		input.io.writeln(
			formatReplayIterationText(iteration, replay.total, options),
		);
	}
	input.io.writeln();
	input.io.writeln(formatReplaySummaryText(replay.iterations, options));
}

export async function runSessionReplay(
	input: SessionReplayCommandInput,
): Promise<number> {
	const { io } = input;
	const mode = input.mode ?? "playback";
	if (!(SESSION_REPLAY_MODES as readonly string[]).includes(mode)) {
		io.writeErr(
			`Unsupported replay mode "${mode}". Supported modes: ${SESSION_REPLAY_MODES.join(", ")}.`,
		);
		return 1;
	}
	const format = (input.format ??
		(input.isInteractiveTTY ? "tui" : "text")) as SessionReplayFormat;
	if (!SESSION_REPLAY_FORMATS.includes(format)) {
		io.writeErr(
			`Unsupported replay format "${input.format}". Supported formats: ${SESSION_REPLAY_FORMATS.join(", ")}.`,
		);
		return 1;
	}
	if (format === "tui" && !input.isInteractiveTTY) {
		io.writeErr(
			"--format tui requires an interactive terminal; use --format text or --format json.",
		);
		return 1;
	}
	if (input.step && format === "json") {
		io.writeErr("--step cannot be combined with --format json.");
		return 1;
	}
	if (
		input.step &&
		format === "text" &&
		!input.waitForStep &&
		!process.stdin.isTTY
	) {
		io.writeErr("--step needs an interactive stdin.");
		return 1;
	}

	let replay: LoadedSessionReplay;
	let speed: number | undefined;
	try {
		speed = parseSpeed(input.speed);
		const { loadSessionReplay } = await import("../session/replay");
		replay = await loadSessionReplay({
			bundleDir: resolve(input.bundleDir),
			sessionId: input.sessionId,
			from: parsePositiveInteger("--from", input.from),
			to: parsePositiveInteger("--to", input.to),
		});
	} catch (error) {
		io.writeErr(errorMessage(error));
		return 1;
	}

	try {
		if (format === "json") {
			for (const iteration of replay.iterations) {
				writeJson(iteration);
			}
			return 0;
		}
		if (format === "text") {
			await playText(replay, input, speed ?? 0);
			return 0;
		}
		const { renderReplayTui } = await import("../tui/replay");
		await renderReplayTui({
			replay,
			speed: speed ?? 1,
			step: input.step === true,
		});
		return 0;
	} catch (error) {
		io.writeErr(errorMessage(error));
		return 1;
	}
}
