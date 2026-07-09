import type { AgentTool } from "@cline/shared";
import { createComputerUseTool } from "./tool";

const PORT_ENV_VAR = "CLINE_COMPUTER_USE_PORT";
const HOST_ENV_VAR = "CLINE_COMPUTER_USE_HOST";
const DISPLAY_WIDTH_ENV_VAR = "CLINE_COMPUTER_USE_DISPLAY_WIDTH";
const DISPLAY_HEIGHT_ENV_VAR = "CLINE_COMPUTER_USE_DISPLAY_HEIGHT";

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Builds the `computer` tool from environment variables, or returns
 * `undefined` if computer-use isn't configured for this process.
 *
 * This is a proof-of-concept convenience for hosts (starting with the CLI)
 * that want to opt in without any config plumbing of their own: set
 * `CLINE_COMPUTER_USE_PORT` to the backend's TCP port and the tool becomes
 * available. Display size is queried from the backend by default; the
 * `CLINE_COMPUTER_USE_DISPLAY_WIDTH`/`_HEIGHT` variables only need to be set
 * to override that. There is intentionally no persisted setting/toggle yet
 * — see ./README.md.
 */
export async function createComputerUseToolFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<AgentTool | undefined> {
	const port = parsePositiveInt(env[PORT_ENV_VAR]);
	if (!port) {
		return undefined;
	}

	return createComputerUseTool({
		host: env[HOST_ENV_VAR] || undefined,
		port,
		displayWidthPx: parsePositiveInt(env[DISPLAY_WIDTH_ENV_VAR]),
		displayHeightPx: parsePositiveInt(env[DISPLAY_HEIGHT_ENV_VAR]),
	});
}
