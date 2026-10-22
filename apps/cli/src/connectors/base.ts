import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readSync,
	statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { resolveClineDataDir } from "@cline/core";
import { isSupervisedConnectorProcess } from "@cline/shared";
import { Command, CommanderError } from "commander";
import {
	CONNECT_ALREADY_RUNNING_EXIT_CODE,
	isProcessRunning,
	readJsonFile,
	removeFile,
	resolveConnectorDebugLogPath,
	spawnDetachedConnector,
	terminateProcess,
	tryClaimConnectorStateFile,
	writeJsonFile,
} from "./common";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectRunContext,
	ConnectStopResult,
} from "./types";

const SHOW_HELP_ERROR = "__SHOW_HELP__";
const CONNECTOR_STARTUP_TIMEOUT_MS = 15_000;
const CONNECTOR_STARTUP_POLL_MS = 100;
const CHILD_LOG_TAIL_BYTES = 8_192;
const CHILD_LOG_TAIL_LINES = 3;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_SEQUENCE_PATTERN = new RegExp(
	`${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`,
	"g",
);

function stripAnsiCodes(text: string): string {
	return text.replace(ANSI_SEQUENCE_PATTERN, "");
}

/**
 * Surface why a detached connector child died. The child's own error is the
 * useful part; the parent only knows that it exited, so quote the tail of the
 * child's log and point at the file for the rest.
 */
function formatChildLogHint(logPath: string): string {
	const suffix = ` See ${logPath} for details.`;
	let handle: number | undefined;
	try {
		const { size } = statSync(logPath);
		if (size === 0) {
			return suffix;
		}
		const length = Math.min(size, CHILD_LOG_TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		handle = openSync(logPath, "r");
		const read = readSync(handle, buffer, 0, length, size - length);
		const lines = buffer
			.subarray(0, read)
			.toString("utf8")
			// A partial first line is likely when starting mid-file.
			.split("\n")
			.slice(size > length ? 1 : 0)
			.map((line) => stripAnsiCodes(line).trim())
			.filter((line) => line.length > 0)
			.slice(-CHILD_LOG_TAIL_LINES);
		if (lines.length === 0) {
			return suffix;
		}
		return ` Last output from the child:\n${lines
			.map((line) => `  ${line}`)
			.join("\n")}\n${suffix.trimStart()}`;
	} catch {
		// The log is best-effort: a missing or unreadable file must never turn a
		// startup failure into a crash.
		return suffix;
	} finally {
		if (handle !== undefined) {
			try {
				closeSync(handle);
			} catch {
				// Nothing actionable if the descriptor is already gone.
			}
		}
	}
}

export abstract class ConnectorBase<Options, State>
	implements ConnectCommandDefinition
{
	stopAll?(io: ConnectIo): Promise<ConnectStopResult>;
	stopInstance?(instanceId: string, io: ConnectIo): Promise<ConnectStopResult>;

	constructor(
		public readonly name: string,
		public readonly description: string,
	) {}

	protected createCommand(): Command {
		return new Command(this.name)
			.description(this.description)
			.exitOverride()
			.configureOutput({ writeOut: () => {}, writeErr: () => {} });
	}

	protected abstract readOptions(command: Command): Options;

	protected abstract runWithOptions(
		options: Options,
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number>;

	protected async validateOptions(
		_options: Options,
		_io: ConnectIo,
	): Promise<number> {
		return 0;
	}

	showHelp(io: ConnectIo): void {
		const output = this.createCommand().helpInformation().trimEnd();
		for (const line of output.split("\n")) {
			io.writeln(line);
		}
	}

	async run(
		rawArgs: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number> {
		let options: Options;
		try {
			options = this.parseArgs(rawArgs);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === SHOW_HELP_ERROR) {
				this.showHelp(io);
				return 0;
			}
			io.writeErr(message);
			return 1;
		}
		const validationExitCode = await this.validateOptions(options, io);
		if (validationExitCode !== 0) {
			return validationExitCode;
		}
		return this.runWithOptions(options, rawArgs, io, context);
	}

	/**
	 * The instance id `rawArgs` would run as, when that is knowable from the
	 * arguments alone.
	 *
	 * The hub keys supervision by (channel, instanceId), so it needs the id
	 * before anything is spawned. Adapters that can only determine it with a side
	 * effect — Telegram resolves its bot username from the API when the flag is
	 * omitted — return undefined, and the caller falls back to starting the
	 * connector locally.
	 */
	resolveInstanceId(rawArgs: string[]): string | undefined {
		let options: Options;
		try {
			options = this.parseArgs(rawArgs);
		} catch {
			return undefined;
		}
		const instanceId = this.instanceIdFromOptions(options);
		return instanceId?.trim() ? instanceId.trim() : undefined;
	}

	protected instanceIdFromOptions(_options: Options): string | undefined {
		return undefined;
	}

	async validate(rawArgs: string[], io: ConnectIo): Promise<number> {
		let options: Options;
		try {
			options = this.parseArgs(rawArgs);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === SHOW_HELP_ERROR) {
				this.showHelp(io);
				return 0;
			}
			io.writeErr(message);
			return 1;
		}
		return await this.validateOptions(options, io);
	}

	protected parseArgs(rawArgs: string[]): Options {
		const command = this.createCommand();
		try {
			command.parse(rawArgs, { from: "user" });
		} catch (error) {
			if (
				error instanceof CommanderError &&
				error.code === "commander.helpDisplayed"
			) {
				throw new Error(SHOW_HELP_ERROR);
			}
			throw error;
		}
		return this.readOptions(command);
	}

	protected sanitizeKey(value: string): string {
		return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
	}

	protected resolveConnectorPath(...segments: string[]): string {
		return join(resolveClineDataDir(), "connectors", this.name, ...segments);
	}

	protected listJsonStatePaths(excludedSuffixes: string[] = []): string[] {
		const dir = this.resolveConnectorPath();
		if (!existsSync(dir)) {
			return [];
		}
		return readdirSync(dir)
			.filter(
				(name) =>
					name.endsWith(".json") &&
					!excludedSuffixes.some((suffix) => name.endsWith(suffix)),
			)
			.map((name) => join(dir, name));
	}

	protected readStateFile<T>(
		statePath: string,
		isValid: (value: unknown) => value is T,
	): T | undefined {
		const parsed = readJsonFile<unknown>(statePath, undefined);
		return isValid(parsed) ? parsed : undefined;
	}

	protected writeStateFile(statePath: string, state: unknown): void {
		writeJsonFile(statePath, state);
	}

	protected removeStateFile(statePath: string): void {
		removeFile(statePath);
	}

	protected removeStaleState(
		statePath: string,
		readState: (path: string) => State | undefined,
		getPid: (state: State) => number,
	): State | undefined {
		const state = readState(statePath);
		if (state && !isProcessRunning(getPid(state))) {
			this.removeStateFile(statePath);
			return state;
		}
		return undefined;
	}

	/**
	 * Exclusively claim the connector state path for this process before
	 * connecting to Slack/Discord/etc. Prevents two foreground (`-i`) or
	 * racing detached launches from both opening socket-mode with the same
	 * bot token.
	 */
	protected claimConnectorInstance(input: {
		statePath: string;
		createState: (claimId: string) => State & { claimId: string; pid: number };
		readState: (path: string) => State | undefined;
		getPid: (state: State) => number;
	}): { claimed: true; claimId: string } | { claimed: false; running?: State } {
		const existing = input.readState(input.statePath);
		if (existing && isProcessRunning(input.getPid(existing))) {
			return { claimed: false, running: existing };
		}
		const claim = tryClaimConnectorStateFile(
			input.statePath,
			input.createState,
		);
		if (!claim) {
			const raced = input.readState(input.statePath);
			return {
				claimed: false,
				...(raced ? { running: raced } : {}),
			};
		}
		return { claimed: true, claimId: claim.claimId };
	}

	/**
	 * Where a detached child's stdout/stderr is captured. Without this the
	 * child is spawned with stdio "ignore", so a child that dies during startup
	 * takes its only diagnostic with it and the parent can report nothing but
	 * "child exited before becoming ready".
	 */
	protected resolveDetachedLogPath(statePath: string): string {
		return resolveConnectorDebugLogPath(
			this.name,
			basename(statePath, ".json") || this.name,
		);
	}

	protected async maybeRunInBackground(input: {
		rawArgs: string[];
		io: ConnectIo;
		interactive: boolean;
		childEnvVar: string;
		statePath: string;
		readState: (path: string) => State | undefined;
		isRunning: (state: State) => boolean;
		formatAlreadyRunningMessage: (state: State) => string;
		formatBackgroundStartMessage: (pid: number) => string;
		foregroundHint: string;
		launchFailureMessage: string;
		startupTimeoutMs?: number;
	}): Promise<number | undefined> {
		if (
			input.interactive ||
			process.env[input.childEnvVar] === "1" ||
			// A supervised connector is the process the hub is tracking, so it must
			// run the adapter here instead of handing off to a detached child.
			isSupervisedConnectorProcess()
		) {
			return undefined;
		}
		const runningState = input.readState(input.statePath);
		if (runningState && input.isRunning(runningState)) {
			input.io.writeln(input.formatAlreadyRunningMessage(runningState));
			return CONNECT_ALREADY_RUNNING_EXIT_CODE;
		}
		const logPath = this.resolveDetachedLogPath(input.statePath);
		const pid = spawnDetachedConnector(
			["connect", this.name],
			input.rawArgs,
			input.childEnvVar,
			{
				logPath,
				component: `${this.name}-connect`,
				metadata: { statePath: input.statePath },
			},
		);
		if (!pid) {
			input.io.writeErr(input.launchFailureMessage);
			return 1;
		}
		input.io.writeln(input.formatBackgroundStartMessage(pid));
		input.io.writeln(input.foregroundHint);
		const startedAt = Date.now();
		const timeoutMs = input.startupTimeoutMs ?? CONNECTOR_STARTUP_TIMEOUT_MS;
		while (Date.now() - startedAt < timeoutMs) {
			const state = input.readState(input.statePath);
			if (state && input.isRunning(state)) {
				return 0;
			}
			if (!isProcessRunning(pid)) {
				input.io.writeErr(
					`${input.launchFailureMessage}: child exited before becoming ready.${formatChildLogHint(logPath)}`,
				);
				return 1;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, CONNECTOR_STARTUP_POLL_MS),
			);
		}
		await terminateProcess(pid);
		input.io.writeErr(
			`${input.launchFailureMessage}: timed out after ${timeoutMs}ms.${formatChildLogHint(logPath)}`,
		);
		return 1;
	}

	protected async stopAllFromStatePaths(
		io: ConnectIo,
		statePaths: string[],
		stopInstance: (
			statePath: string,
			io: ConnectIo,
		) => Promise<ConnectStopResult>,
	): Promise<ConnectStopResult> {
		let stoppedProcesses = 0;
		let failedProcesses = 0;
		let stoppedSessions = 0;
		for (const statePath of statePaths) {
			const result = await stopInstance(statePath, io);
			stoppedProcesses += result.stoppedProcesses;
			failedProcesses += result.failedProcesses;
			stoppedSessions += result.stoppedSessions;
		}
		return { stoppedProcesses, failedProcesses, stoppedSessions };
	}

	protected async stopManagedProcess(input: {
		io: ConnectIo;
		statePath: string;
		readState: (path: string) => State | undefined;
		describeStoppedProcess: (state: State) => string;
		getPid: (state: State) => number;
		stopSessions: (state: State) => Promise<number>;
		clearBindings?: (state: State) => void;
	}): Promise<ConnectStopResult> {
		const state = input.readState(input.statePath);
		if (!state) {
			this.removeStateFile(input.statePath);
			return {
				stoppedProcesses: 0,
				failedProcesses: 0,
				stoppedSessions: 0,
			};
		}
		const pid = input.getPid(state);
		let stoppedProcesses = 0;
		if (await terminateProcess(pid)) {
			stoppedProcesses = 1;
			input.io.writeln(input.describeStoppedProcess(state));
		} else if (isProcessRunning(pid)) {
			input.io.writeErr(
				`[connect] failed to stop connector process pid=${pid}`,
			);
			return {
				stoppedProcesses: 0,
				failedProcesses: 1,
				stoppedSessions: 0,
			};
		}
		const stoppedSessions = await input.stopSessions(state);
		input.clearBindings?.(state);
		this.removeStateFile(input.statePath);
		return { stoppedProcesses, failedProcesses: 0, stoppedSessions };
	}

	protected parseOptionalInteger(
		value: string | undefined,
		label: string,
	): number | undefined {
		if (value === undefined) {
			return undefined;
		}
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) {
			throw new Error(`invalid ${label} "${value}"`);
		}
		return parsed;
	}

	protected parseMode(value: string | undefined): "act" | "plan" {
		const mode = value?.trim().toLowerCase() || "act";
		if (mode !== "act" && mode !== "plan") {
			throw new Error(`invalid mode "${mode}" (expected "act" or "plan")`);
		}
		return mode;
	}
}
