import { join } from "node:path";
import { resolveClineDataDir } from "@cline/core";
import { getCliBuildInfo } from "../utils/common";

/**
 * The CLI log file: `CLINE_LOG_PATH` when set, otherwise
 * `<data dir>/logs/<cli name>.log`. The CLI logger writes here by default and
 * `cline doctor` reads here, so both resolve the path through this function.
 */
export function resolveCliLogPath(): string {
	return (
		process.env.CLINE_LOG_PATH?.trim() ||
		join(resolveClineDataDir(), "logs", `${getCliBuildInfo().name}.log`)
	);
}
