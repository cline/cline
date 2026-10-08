import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AtifTrajectory } from "@cline/session";
import { SESSION_REPLAY_MANIFEST_FILE } from "@cline/shared";
import { version as cliVersion } from "../../package.json";
import type { LoadedSessionReplay } from "../session/replay";
import type { CliOutputMode } from "../utils/types";

type SessionCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export const SESSION_REPLAY_MODES = ["playback", "rerun"] as const;
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

export const SESSION_EXPORT_FORMATS = ["bundle", "atif"] as const;
export type SessionExportFormat = (typeof SESSION_EXPORT_FORMATS)[number];

export interface SessionExportCommandInput {
	/** A session id, or with `--format atif` also a bundle directory. */
	sessionId: string;
	bundleDir?: string;
	format?: SessionExportFormat;
	/** ATIF output file; stdout when absent. */
	out?: string;
	redact: boolean;
	overwrite: boolean;
	outputMode: CliOutputMode;
	io: SessionCommandIo;
}

export async function runSessionExport(
	input: SessionExportCommandInput,
): Promise<number> {
	const { io } = input;
	const sessionId = input.sessionId.trim();
	if (!sessionId) {
		io.writeErr(
			input.format === "atif"
				? "session export requires <session-id> or <bundle>"
				: "session export requires <session-id>",
		);
		return 1;
	}
	if (input.format === "atif") {
		return await runSessionExportAtif({ ...input, sessionId });
	}
	if (input.out !== undefined) {
		io.writeErr(
			"--out is only used with --format atif; bundles are written to --bundle <dir>",
		);
		return 1;
	}
	if (!input.bundleDir?.trim()) {
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

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * `session export --format atif`: converts a bundle directory, or a session
 * exported on the fly (redacted unless `--no-redact`, with its subagent and
 * teammate sessions), into one ATIF trajectory.
 */
async function runSessionExportAtif(
	input: SessionExportCommandInput,
): Promise<number> {
	const { io } = input;
	const target = input.sessionId;
	const asPath = resolve(target);
	const fromBundle = isDirectory(asPath);
	if (fromBundle && !existsSync(join(asPath, SESSION_REPLAY_MANIFEST_FILE))) {
		io.writeErr(
			`${asPath} is a directory without ${SESSION_REPLAY_MANIFEST_FILE}; pass a session id or a session replay bundle directory`,
		);
		return 1;
	}
	if (fromBundle && input.bundleDir?.trim()) {
		io.writeErr(
			"--bundle writes a new bundle and cannot be used when converting an existing bundle",
		);
		return 1;
	}
	const out = input.out?.trim() ? resolve(input.out) : undefined;
	if (out && existsSync(out) && !input.overwrite) {
		io.writeErr(`${out} already exists; pass --force to replace it`);
		return 1;
	}
	const warnings: string[] = [];
	if (fromBundle && !input.redact) {
		warnings.push(
			"--no-redact has no effect when converting an existing bundle; the bundle's own redaction applies.",
		);
	}
	let tempDir: string | undefined;
	try {
		const {
			exportSessionReplayBundleToAtif,
			readSessionReplayBundle,
			validateAtifTrajectory,
		} = await import("@cline/session");
		let bundleDir = asPath;
		if (!fromBundle) {
			if (input.bundleDir?.trim()) {
				bundleDir = resolve(input.bundleDir);
			} else {
				tempDir = await mkdtemp(join(tmpdir(), "cline-session-atif-"));
				bundleDir = tempDir;
			}
			const { exportSessionReplay } = await import("../session/session");
			const exported = await exportSessionReplay({
				sessionId: target,
				bundleDir,
				redact: input.redact,
				overwrite: input.overwrite,
				hostVersion: cliVersion,
				includeChildSessions: true,
			});
			warnings.push(...exported.warnings);
		}
		const bundle = await readSessionReplayBundle(bundleDir);
		const { trajectory, warnings: atifWarnings } =
			exportSessionReplayBundleToAtif(bundle);
		warnings.push(...atifWarnings);
		const validation = validateAtifTrajectory(trajectory);
		if (!validation.ok) {
			io.writeErr("The exported trajectory does not validate against ATIF:");
			for (const error of validation.errors) {
				io.writeErr(`  - ${error}`);
			}
			return 1;
		}
		const json = `${JSON.stringify(trajectory, null, 2)}\n`;
		if (out) {
			await mkdir(dirname(out), { recursive: true });
			await writeFile(out, json, "utf8");
		} else {
			process.stdout.write(json);
		}
		const subagents = countSubagentTrajectories(trajectory);
		if (input.outputMode === "json" && out) {
			writeJson({
				sessionId: bundle.manifest.rootSessionId,
				format: "atif",
				schemaVersion: trajectory.schema_version,
				out,
				...(fromBundle || !tempDir ? { bundleDir } : {}),
				steps: trajectory.steps.length,
				subagentTrajectories: subagents,
				finalMetrics: trajectory.final_metrics ?? null,
				warnings,
			});
			return 0;
		}
		for (const warning of warnings) {
			io.writeErr(`warning: ${warning}`);
		}
		if (out) {
			const metrics = trajectory.final_metrics;
			io.writeln(
				`Exported session ${bundle.manifest.rootSessionId} as ${trajectory.schema_version} to ${out}`,
			);
			io.writeln(
				`  ${trajectory.steps.length} steps · ${subagents} subagent trajector${subagents === 1 ? "y" : "ies"}${
					metrics?.total_prompt_tokens !== undefined
						? ` · ${metrics.total_prompt_tokens} prompt / ${metrics.total_completion_tokens ?? 0} completion tokens`
						: ""
				}${
					typeof metrics?.total_cost_usd === "number"
						? ` · $${metrics.total_cost_usd.toFixed(4)}`
						: ""
				}`,
			);
			if (!fromBundle && !tempDir) {
				io.writeln(`  bundle: ${bundleDir}`);
			}
		}
		return 0;
	} catch (error) {
		io.writeErr(errorMessage(error));
		return 1;
	} finally {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	}
}

function countSubagentTrajectories(trajectory: AtifTrajectory): number {
	return (trajectory.subagent_trajectories ?? []).reduce(
		(total, sub) => total + 1 + countSubagentTrajectories(sub),
		0,
	);
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
	let ignored: string[];
	try {
		ignored = replay.parseSessionReplayDivergenceKinds(
			input.ignore,
			"--ignore",
		);
	} catch (error) {
		io.writeErr(errorMessage(error));
		return SESSION_DIFF_EXIT.error;
	}
	const kinds = replay.SESSION_REPLAY_DIVERGENCE_KINDS.filter(
		(kind) => !ignored.includes(kind),
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
	rerun?: SessionRerunFlags;
	io: SessionCommandIo;
	isInteractiveTTY: boolean;
	sleep?: (ms: number) => Promise<void>;
	waitForStep?: () => Promise<boolean>;
}

/** Flags of `session replay --mode rerun`. */
export interface SessionRerunFlags {
	workspace?: string;
	inPlace?: boolean;
	untilDivergence?: boolean;
	continue?: boolean;
	ignore?: string;
	count?: string;
	lenient?: boolean;
	interactive?: boolean;
	model?: string;
	provider?: string;
	out?: string;
	inContainer?: boolean;
	image?: string;
	containerRuntime?: string;
	containerCli?: string;
	containerArgs?: string[];
}

const PLAYBACK_ONLY_FLAGS = [
	["from", "--from"],
	["to", "--to"],
	["speed", "--speed"],
	["step", "--step"],
] as const;

const RERUN_FLAG_NAMES: Record<keyof SessionRerunFlags, string> = {
	workspace: "--workspace",
	inPlace: "--in-place",
	untilDivergence: "--until-divergence",
	continue: "--continue",
	ignore: "--ignore",
	count: "--count",
	lenient: "--lenient",
	interactive: "--interactive",
	model: "--model",
	provider: "--provider",
	out: "--out",
	inContainer: "--in-container",
	image: "--image",
	containerRuntime: "--container-runtime",
	containerCli: "--container-cli",
	containerArgs: "--container-arg",
};

function isSet(value: unknown): boolean {
	return Array.isArray(value)
		? value.length > 0
		: value !== undefined && value !== false && value !== "";
}

/** Flags that do not apply to the chosen mode, or that conflict; undefined when fine. */
export function sessionReplayFlagError(
	input: Pick<
		SessionReplayCommandInput,
		"mode" | "from" | "to" | "speed" | "step" | "rerun"
	>,
): string | undefined {
	const mode = input.mode ?? "playback";
	const rerun = input.rerun ?? {};
	if (mode !== "rerun") {
		const given = (
			Object.keys(RERUN_FLAG_NAMES) as Array<keyof SessionRerunFlags>
		)
			.filter((key) => isSet(rerun[key]))
			.map((key) => RERUN_FLAG_NAMES[key]);
		return given.length > 0
			? `${given.join(", ")} ${given.length === 1 ? "needs" : "need"} --mode rerun.`
			: undefined;
	}
	const playback = PLAYBACK_ONLY_FLAGS.filter(([key]) => isSet(input[key])).map(
		([, flag]) => flag,
	);
	if (playback.length > 0) {
		return `${playback.join(", ")} ${playback.length === 1 ? "applies" : "apply"} to playback only; a rerun always starts from the first iteration.`;
	}
	if (rerun.untilDivergence && rerun.continue) {
		return "--until-divergence and --continue cannot be combined.";
	}
	if (!rerun.inContainer) {
		const container = (
			["image", "containerRuntime", "containerCli", "containerArgs"] as const
		)
			.filter((key) => isSet(rerun[key]))
			.map((key) => RERUN_FLAG_NAMES[key]);
		if (container.length > 0) {
			return `${container.join(", ")} ${container.length === 1 ? "needs" : "need"} --in-container.`;
		}
	}
	return undefined;
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
	const flagError = sessionReplayFlagError(input);
	if (flagError) {
		io.writeErr(flagError);
		return mode === "rerun" ? SESSION_DIFF_EXIT.error : 1;
	}
	const format = (input.format ??
		(input.isInteractiveTTY && !input.rerun?.interactive
			? "tui"
			: "text")) as SessionReplayFormat;
	if (!SESSION_REPLAY_FORMATS.includes(format)) {
		io.writeErr(
			`Unsupported replay format "${input.format}". Supported formats: ${SESSION_REPLAY_FORMATS.join(", ")}.`,
		);
		return mode === "rerun" ? SESSION_DIFF_EXIT.error : 1;
	}
	if (mode === "rerun") {
		return await runSessionRerunCommand(input, format);
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

/**
 * `session replay --mode rerun`: runs the bundle's root session again in a
 * rebuilt workspace and reports where it diverged. Exits like `session diff`:
 * 0 when nothing that counts diverged, 1 when it did, 2 on errors.
 */
async function runSessionRerunCommand(
	input: SessionReplayCommandInput,
	format: SessionReplayFormat,
): Promise<number> {
	const { io } = input;
	const flags = input.rerun ?? {};
	if (format === "tui" && !input.isInteractiveTTY) {
		io.writeErr(
			"--format tui requires an interactive terminal; use --format text or --format json.",
		);
		return SESSION_DIFF_EXIT.error;
	}
	if (flags.interactive && format === "tui") {
		io.writeErr(
			"--interactive asks on the terminal and cannot be combined with --format tui; use --format text.",
		);
		return SESSION_DIFF_EXIT.error;
	}
	if (flags.interactive && !process.stdin.isTTY) {
		io.writeErr("--interactive needs an interactive stdin.");
		return SESSION_DIFF_EXIT.error;
	}
	const rerunModule = await import("../session/rerun");
	const options = {
		bundleDir: input.bundleDir,
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
		...(flags.workspace ? { workspace: flags.workspace } : {}),
		inPlace: flags.inPlace === true,
		untilDivergence: flags.untilDivergence === true,
		...(flags.ignore ? { ignore: flags.ignore } : {}),
		...(flags.count ? { count: flags.count } : {}),
		lenient: flags.lenient === true,
		interactive: flags.interactive === true,
		...(flags.model ? { model: flags.model } : {}),
		...(flags.provider ? { provider: flags.provider } : {}),
		...(flags.out ? { outDir: flags.out } : {}),
	};
	const run = async (handlers: {
		onLine: (line: string) => void;
		signal: AbortSignal;
	}): Promise<{
		outcome: Awaited<ReturnType<typeof rerunModule.runSessionRerun>>;
		exitCode: number;
	}> => {
		if (flags.inContainer) {
			const { runSessionRerunInContainer } = await import(
				"../session/rerun-container"
			);
			const { exitCode, ...outcome } = await runSessionRerunInContainer({
				...options,
				...(flags.image ? { image: flags.image } : {}),
				...(flags.containerRuntime ? { runtime: flags.containerRuntime } : {}),
				...(flags.containerCli ? { cli: flags.containerCli } : {}),
				...(flags.containerArgs ? { runtimeArgs: flags.containerArgs } : {}),
				onNote: handlers.onLine,
				signal: handlers.signal,
			});
			return {
				outcome,
				exitCode:
					exitCode === SESSION_DIFF_EXIT.error
						? exitCode
						: outcome.report.comparison.failed
							? SESSION_DIFF_EXIT.diverged
							: SESSION_DIFF_EXIT.same,
			};
		}
		const outcome = await rerunModule.runSessionRerun({
			...options,
			onNote: handlers.onLine,
			onProgress: (progress) => {
				const line = rerunModule.formatRerunProgress(progress);
				if (line) handlers.onLine(line);
			},
			signal: handlers.signal,
		});
		return {
			outcome,
			exitCode: outcome.report.comparison.failed
				? SESSION_DIFF_EXIT.diverged
				: SESSION_DIFF_EXIT.same,
		};
	};

	try {
		if (format === "tui") {
			const { renderRerunTui } = await import("../tui/replay");
			const { exitCode } = await renderRerunTui({
				title: `Session rerun · ${resolve(input.bundleDir)}`,
				run,
				reportLines: ({ outcome }) =>
					rerunModule.formatSessionRerunText(outcome),
			});
			return exitCode;
		}
		const note = (text: string) => process.stderr.write(`${text}\n`);
		const controller = new AbortController();
		const onSignal = () => controller.abort();
		process.once("SIGINT", onSignal);
		let result: Awaited<ReturnType<typeof run>>;
		try {
			result = await run({
				onLine: (line) => {
					if (format === "text") note(`[rerun] ${line}`);
				},
				signal: controller.signal,
			});
		} finally {
			process.off("SIGINT", onSignal);
		}
		if (format === "json") {
			writeJson({
				...result.outcome.report,
				reportPath: result.outcome.reportPath,
			});
		} else {
			for (const warning of result.outcome.report.warnings) {
				note(`warning: ${warning}`);
			}
			for (const line of rerunModule.formatSessionRerunText(result.outcome)) {
				io.writeln(line);
			}
		}
		return result.exitCode;
	} catch (error) {
		io.writeErr(errorMessage(error));
		return SESSION_DIFF_EXIT.error;
	}
}
