import {
	type ClineCore,
	COMPUTER_USER_SYSTEM_PROMPT,
	ComputerUserCoordinator,
	createComputerUserCollaborationTools,
	createComputerUserDriverTools,
	createComputerUseToolFromEnv,
	type ProviderSettingsManager,
} from "@cline/core";
import type { AgentTool } from "@cline/shared";
import { createCliCore } from "../../session/session";
import type { Config } from "../../utils/types";

/**
 * CLI host integration for the asynchronous computer user.
 *
 * The driver session gets four `computer_user_*` tools; the helper runs as a
 * dedicated interactive ClineCore session on the Anthropic provider (the
 * computer-use beta header requires the direct provider — see qwanban's
 * README). Enabled by the same `CLINE_COMPUTER_USE_PORT` opt-in as the raw
 * `computer` tool; when the coordinator is active the driver deliberately
 * does NOT get the raw tool, so all GUI work flows through the helper.
 *
 * Helper consistency boundary: provider, credentials, tool inventory, and
 * prompt are resolved here, once, when the runtime starts. Changing them
 * requires a new CLI session.
 */

const HELPER_PROVIDER_ID = "anthropic";
const HELPER_DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export interface InteractiveComputerUser {
	driverTools: AgentTool[];
	dispose(): Promise<void>;
}

export async function createInteractiveComputerUser(input: {
	config: Config;
	providerSettingsManager: Pick<ProviderSettingsManager, "getProviderSettings">;
	/**
	 * Injects a prompt into the driver's conversation. Must resolve the
	 * driver session id at call time (session rebuilds change it), which
	 * `sessionRuntime.sendCurrentTurn` does.
	 */
	notifyDriver: (prompt: string, delivery: "queue" | "steer") => void;
	env?: NodeJS.ProcessEnv;
}): Promise<InteractiveComputerUser | undefined> {
	const computerTool = await createComputerUseToolFromEnv(
		input.env ?? process.env,
	);
	if (!computerTool) {
		return undefined;
	}

	const helperSettings =
		input.providerSettingsManager.getProviderSettings(HELPER_PROVIDER_ID);
	const helperApiKey =
		typeof helperSettings?.apiKey === "string" ? helperSettings.apiKey : "";
	if (!helperApiKey) {
		// No silent fallback to the driver's credentials: the helper requires
		// the Anthropic provider's own configuration.
		return undefined;
	}
	const helperModelId =
		typeof helperSettings?.model === "string" && helperSettings.model
			? helperSettings.model
			: HELPER_DEFAULT_MODEL_ID;

	// The helper config and the coordinator reference each other (the
	// collaboration tools call back into the coordinator). Break the cycle
	// with one shared extraTools array: the coordinator captures the config
	// object now; the tools are pushed into the same array below, before any
	// session can start.
	const helperExtraTools: AgentTool[] = [computerTool];
	const helperConfig = {
		providerId: HELPER_PROVIDER_ID,
		modelId: helperModelId,
		apiKey: helperApiKey,
		cwd: input.config.cwd,
		workspaceRoot: input.config.workspaceRoot?.trim() || input.config.cwd,
		mode: "act" as const,
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		pluginPaths: [],
		systemPrompt: COMPUTER_USER_SYSTEM_PROMPT,
		extraTools: helperExtraTools,
		toolPolicies: {
			// Questions and completion go to the driver through the
			// collaboration tools, never to a human or generic completion.
			ask_question: { enabled: false },
			submit_and_exit: { enabled: false },
		},
		// The helper's terminal tools are ask_driver/finish_computer_task
		// (extraTools with completesRun). Require them explicitly: the
		// builder's inference only recognizes submit_and_exit, which is
		// disabled above, and a run that ends in free-form text would leave
		// the driver waiting with no report.
		completionPolicy: { requireCompletionTool: true },
	};

	// Lazy: the helper ClineCore spawns only when the driver first delegates.
	// forceLocalBackend keeps the helper in this process, where the
	// computer-use backend's loopback socket is reachable — a hub daemon may
	// run on a different machine from the controlled display.
	let helperCorePromise: Promise<ClineCore> | undefined;
	const getHelperCore = () => {
		helperCorePromise ??= createCliCore({
			forceLocalBackend: true,
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot,
			logger: input.config.logger,
		}).catch((error) => {
			helperCorePromise = undefined;
			throw error;
		});
		return helperCorePromise;
	};

	const coordinator = new ComputerUserCoordinator({
		host: {
			start: async (startInput) =>
				(await getHelperCore()).start({
					config: startInput.config as never,
					interactive: startInput.interactive,
				}),
			send: async (sendInput) => (await getHelperCore()).send(sendInput),
			abort: async (sessionId, reason) =>
				(await getHelperCore()).abort(sessionId, reason),
			stop: async (sessionId) => (await getHelperCore()).stop(sessionId),
		},
		helperConfig,
		notifyDriver: ({ prompt, delivery }) =>
			input.notifyDriver(prompt, delivery),
	});
	helperExtraTools.push(...createComputerUserCollaborationTools(coordinator));

	return {
		driverTools: createComputerUserDriverTools(coordinator),
		dispose: async () => {
			await coordinator.dispose().catch(() => {});
			if (helperCorePromise) {
				const core = await helperCorePromise.catch(() => undefined);
				await core?.dispose().catch(() => {});
			}
		},
	};
}
