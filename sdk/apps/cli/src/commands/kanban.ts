import { spawn } from "node:child_process";
import { writeErr } from "../utils/output";

export function launchKanban() {
	const child = spawn("kanban", [], {
		detached: true,
		stdio: "ignore",
	});
	let hasError = false;
	child.on("error", (error: NodeJS.ErrnoException) => {
		hasError = true;
		if (error.code === "ENOENT") {
			writeErr('kanban is not installed. Install it with "npm i -g kanban"');
		}
		process.exitCode = 1;
	});
	child.unref();
	process.nextTick(() => {
		if (!hasError) {
			process.exitCode = 0;
		}
	});
}
