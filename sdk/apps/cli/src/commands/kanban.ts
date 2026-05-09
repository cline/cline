import { spawn } from "node:child_process";
import { writeErr } from "../utils/output";

/**
 * Launch the external `kanban` app in a detached child process.
 *
 * Returns a Promise that resolves with the exit code:
 *   0 on successful spawn (the kanban app runs detached after the CLI exits)
 *   1 if the binary can't be spawned (e.g. ENOENT). An install hint is
 *     printed to stderr in the ENOENT case.
 *
 * The returned promise resolves as soon as the spawn outcome is known
 * (`spawn` or `error`), so callers can propagate the exit code synchronously
 * without keeping the parent process attached to the detached child.
 */
export function launchKanban(): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn("kanban", [], {
			detached: true,
			stdio: "ignore",
		});
		let settled = false;
		const settle = (code: number) => {
			if (settled) return;
			settled = true;
			resolve(code);
		};
		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				writeErr('kanban is not installed. Install it with "npm i -g kanban"');
			}
			settle(1);
		});
		child.on("spawn", () => {
			child.unref();
			settle(0);
		});
	});
}
