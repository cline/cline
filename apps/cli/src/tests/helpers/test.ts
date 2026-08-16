import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TuiTest } from "@microsoft/tui-test";
import {
	type CreateTerminalOptions,
	withTerminal,
} from "@microsoft/tui-test/test";
import { expect, describe as vitestDescribe, test as vitestTest } from "vitest";
import { trackProgramExitFile } from "./program-exit.js";

export { expect };

interface TerminalTestOptions {
	program?: {
		file: string;
		args?: string[];
	};
	columns?: number;
	rows?: number;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

interface TerminalFixture {
	terminal: TuiTest;
}

type TerminalTestBody = (fixture: TerminalFixture) => Promise<void> | void;

interface TerminalTest {
	(name: string, body: TerminalTestBody, timeout?: number): void;
	describe(name: string, body: () => void): void;
	skip(name: string, body: TerminalTestBody, timeout?: number): void;
	use(options: TerminalTestOptions): void;
}

const optionStack: TerminalTestOptions[] = [];
const testSuiteRoot = fileURLToPath(new URL("../", import.meta.url));
const programRunner = fileURLToPath(
	new URL("./run-program.mjs", import.meta.url),
);

function compactEnv(
	env: NodeJS.ProcessEnv | undefined,
): Record<string, string> | undefined {
	if (!env) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

function currentOptions(): TerminalTestOptions {
	const options = optionStack.at(-1);
	if (!options) {
		throw new Error("test.use() must be called inside test.describe()");
	}
	return options;
}

function toCreateTerminalOptions(
	options: TerminalTestOptions,
	exitCodeFile: string,
): CreateTerminalOptions {
	if (!options.program) {
		throw new Error("A terminal test must configure a program with test.use()");
	}

	return {
		program: [
			process.execPath,
			programRunner,
			exitCodeFile,
			options.program.file,
			...(options.program.args ?? []),
		],
		cols: options.columns,
		rows: options.rows,
		cwd: options.cwd ?? testSuiteRoot,
		env: compactEnv(options.env),
		retries: 0,
	};
}

function registerTest(
	skip: boolean,
	name: string,
	body: TerminalTestBody,
	timeout?: number,
): void {
	const configuredOptions = { ...currentOptions() };
	const run = async () => {
		const resultDir = mkdtempSync(join(tmpdir(), "cline-tui-process-"));
		const exitCodeFile = join(resultDir, "exit-code");
		try {
			const options = toCreateTerminalOptions(configuredOptions, exitCodeFile);
			await withTerminal(options, async (terminal) => {
				trackProgramExitFile(terminal, exitCodeFile);
				await body({ terminal });
			});
		} finally {
			rmSync(resultDir, { recursive: true, force: true });
		}
	};

	if (skip) {
		vitestTest.skip(name, run, timeout);
		return;
	}
	vitestTest(name, run, timeout);
}

export const test: TerminalTest = Object.assign(
	(name: string, body: TerminalTestBody, timeout?: number) => {
		registerTest(false, name, body, timeout);
	},
	{
		describe(name: string, body: () => void): void {
			vitestDescribe(name, () => {
				optionStack.push({ ...optionStack.at(-1) });
				try {
					body();
				} finally {
					optionStack.pop();
				}
			});
		},
		skip(name: string, body: TerminalTestBody, timeout?: number): void {
			registerTest(true, name, body, timeout);
		},
		use(options: TerminalTestOptions): void {
			const current = currentOptions();
			Object.assign(current, options);
		},
	},
);
