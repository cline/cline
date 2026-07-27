import type { AgentTool } from "@cline/shared";
import { createComputerUseTool } from "./tool";

const PORT_ENV_VAR = "CLINE_COMPUTER_USE_PORT";
const HOST_ENV_VAR = "CLINE_COMPUTER_USE_HOST";

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Reads the computer-use backend's address from the environment, or returns
 * `undefined` if computer-use isn't configured for this process. Setting
 * `CLINE_COMPUTER_USE_PORT` is the single opt-in for everything computer-use:
 * the raw tool, the computer user, and observability all dial this target.
 */
export function resolveComputerUseTargetFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): { host?: string; port: number } | undefined {
	const port = parsePositiveInt(env[PORT_ENV_VAR]);
	if (!port) {
		return undefined;
	}
	return { host: env[HOST_ENV_VAR] || undefined, port };
}

/**
 * Builds the `computer` tool from environment variables, or returns
 * `undefined` if computer-use isn't configured for this process.
 *
 * This is a proof-of-concept convenience for hosts (starting with the CLI)
 * that want to opt in without any config plumbing of their own: set
 * `CLINE_COMPUTER_USE_PORT` to the backend's TCP port and the tool becomes
 * available. Display size is always queried from the backend — it is the
 * only component that can know the real framebuffer dimensions, and a
 * configured value that disagrees with them would corrupt every coordinate
 * the model computes. There is intentionally no persisted setting/toggle
 * yet — see ./README.md.
 */
export async function createComputerUseToolFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<AgentTool | undefined> {
	const target = resolveComputerUseTargetFromEnv(env);
	if (!target) {
		return undefined;
	}
	return createComputerUseTool(target);
}
