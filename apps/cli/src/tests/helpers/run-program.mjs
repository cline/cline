import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { constants } from "node:os";

const [exitCodeFile, program, ...args] = process.argv.slice(2);

if (!exitCodeFile || !program) {
	throw new Error(
		"Usage: run-program.mjs <exit-code-file> <program> [args...]",
	);
}

const child = spawn(program, args, { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
	process.on(signal, () => {
		child.kill(signal);
	});
}

child.once("error", (error) => {
	console.error(error);
	writeFileSync(exitCodeFile, "1", "utf8");
	process.exit(1);
});

child.once("exit", (code, signal) => {
	const signalNumber = signal ? constants.signals[signal] : undefined;
	const exitCode = code ?? (signalNumber ? 128 + signalNumber : 1);
	writeFileSync(exitCodeFile, String(exitCode), "utf8");
	process.exit(exitCode);
});
