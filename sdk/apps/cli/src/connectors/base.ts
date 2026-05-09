import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@clinebot/core";
import { Command, CommanderError } from "commander";
import {
	isProcessRunning,
	readJsonFile,
	removeFile,
	spawnDetachedConnector,
	terminateProcess,
	writeJsonFile,
} from "./common";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectStopResult,
} from "./types";

const SHOW_HELP_ERROR = "__SHOW_HELP__";

export abstract class ConnectorBase<Options, State>
	implements ConnectCommandDefinition
{
	stopAll?(io: ConnectIo): Promise<ConnectStopResult>;

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
	): Promise<number>;

	showHelp(io: ConnectIo): void {
		const output = this.createCommand().helpInformation().trimEnd();
		for (const line of output.split("\n")) {
			io.writeln(line);
		}
	}

	async run(rawArgs: string[], io: ConnectIo): Promise<number> {
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
		return this.runWithOptions(options, rawArgs, io);
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
	): void {
		const state = readState(statePath);
		if (state && !isProcessRunning(getPid(state))) {
			this.removeStateFile(statePath);
		}
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
	}): Promise<boolean> {
		if (input.interactive || process.env[input.childEnvVar] === "1") {
			return false;
		}
		const runningState = input.readState(input.statePath);
		if (runningState && input.isRunning(runningState)) {
			input.io.writeln(input.formatAlreadyRunningMessage(runningState));
			return true;
		}
		const pid = spawnDetachedConnector(
			["connect", this.name],
			input.rawArgs,
			input.childEnvVar,
		);
		if (!pid) {
			input.io.writeErr(input.launchFailureMessage);
			return true;
		}
		input.io.writeln(input.formatBackgroundStartMessage(pid));
		input.io.writeln(input.foregroundHint);
		return true;
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
		let stoppedSessions = 0;
		for (const statePath of statePaths) {
			const result = await stopInstance(statePath, io);
			stoppedProcesses += result.stoppedProcesses;
			stoppedSessions += result.stoppedSessions;
		}
		return { stoppedProcesses, stoppedSessions };
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
			return { stoppedProcesses: 0, stoppedSessions: 0 };
		}
		let stoppedProcesses = 0;
		if (await terminateProcess(input.getPid(state))) {
			stoppedProcesses = 1;
			input.io.writeln(input.describeStoppedProcess(state));
		}
		const stoppedSessions = await input.stopSessions(state);
		input.clearBindings?.(state);
		this.removeStateFile(input.statePath);
		return { stoppedProcesses, stoppedSessions };
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
