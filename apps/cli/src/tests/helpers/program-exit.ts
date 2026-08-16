import { readFileSync } from "node:fs";
import type { TuiTest } from "@microsoft/tui-test";

const exitCodeFiles = new WeakMap<TuiTest, string>();

export function trackProgramExitFile(
	terminal: TuiTest,
	exitCodeFile: string,
): void {
	exitCodeFiles.set(terminal, exitCodeFile);
}

export function getProgramExitCode(terminal: TuiTest): number | undefined {
	const exitCodeFile = exitCodeFiles.get(terminal);
	if (!exitCodeFile) {
		return undefined;
	}

	try {
		const exitCode = Number.parseInt(readFileSync(exitCodeFile, "utf8"), 10);
		return Number.isInteger(exitCode) ? exitCode : undefined;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}
