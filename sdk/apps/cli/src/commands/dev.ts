import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@clinebot/core";
import { Command } from "commander";
import open from "open";
import { getCliBuildInfo } from "../utils/common";

type DevCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export type RunDevCommandDeps = {
	openPath?: (target: string) => Promise<void> | void;
};

function resolveCliLogPath(): string {
	const { name } = getCliBuildInfo();
	return join(resolveClineDataDir(), "logs", `${name}.log`);
}

function ensureFileExists(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, "");
}

async function defaultOpenPath(target: string): Promise<void> {
	await open(target, { wait: false });
}

export function createDevCommand(
	io: DevCommandIo,
	setExitCode: (code: number) => void,
	deps: RunDevCommandDeps = {},
): Command {
	const dev = new Command("dev")
		.description("Developer tools and utilities")
		.exitOverride();

	dev
		.command("log")
		.description("Open the CLI log file")
		.action(async () => {
			const logPath = resolveCliLogPath();
			const openPath = deps.openPath ?? defaultOpenPath;
			try {
				ensureFileExists(logPath);
				await openPath(logPath);
				io.writeln(logPath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				io.writeErr(`failed to open log file "${logPath}": ${message}`);
				setExitCode(1);
			}
		});

	return dev;
}
