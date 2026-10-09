import { type AgentTool, createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import type { ComputerBackendRestartCapability } from "./backend-restart";

const BackendRestartInput = z.object({}).strict();

/** Builds the force-restart tool for the agent controlling the computer. */
export function createComputerBackendRestartTool(
	backendRestart: ComputerBackendRestartCapability,
): AgentTool {
	return createTool({
		name: "computer_restart_backend",
		description:
			"Force-restart the local computer-use backend when it is stuck or cannot take screenshots. Asks a compatible qbt at the configured loopback port to shut down cleanly, or kills the process tree when Cline launched it, then starts the configured replacement and waits for it to answer. Does not search for or kill arbitrary processes.",
		inputSchema: zodToJsonSchema(BackendRestartInput),
		timeoutMs: backendRestart.budgetMs + 60_000,
		retryable: false,
		execute: async (input: unknown, context) => {
			BackendRestartInput.parse(input);
			const result = await backendRestart.forceRestart(context.signal);
			return result.status === "failed_to_start"
				? {
						status: result.status,
						error: result.error,
						note: "Backend recovery did not complete. Read the error before retrying.",
					}
				: {
						status: result.status,
						note: "The replacement backend is ready. Take a fresh screenshot before continuing.",
					};
		},
	});
}
