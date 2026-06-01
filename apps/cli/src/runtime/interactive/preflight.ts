import { writeErr } from "../../utils/output";
import type { Config } from "../../utils/types";

export function assertInteractivePreflight(config: Config): void {
	if (config.outputMode === "json") {
		writeErr("interactive mode is not supported with --json");
		process.exit(1);
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		writeErr(
			"interactive mode requires a TTY (stdin/stdout must both be terminals)",
		);
		process.exit(1);
	}
}
