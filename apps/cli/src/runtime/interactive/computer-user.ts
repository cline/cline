import {
	type AgentHooks,
	type ClineCore,
	COMPUTER_USER_SYSTEM_PROMPT,
	ComputerTaskArtifactRecorder,
	ComputerUseClient,
	ComputerUserCoordinator,
	createComputerUserCollaborationTools,
	createComputerUserDriverTools,
	createComputerUseTool,
	createJournalEventSink,
	createTranscriptRecordingHooks,
	type ProviderSettingsManager,
	resolveComputerUseTargetFromEnv,
	toProviderConfig,
} from "@cline/core";
import type { AgentTool } from "@cline/shared";
import { nanoid } from "nanoid";
import { createCliCore } from "../../session/session";
import type { Config } from "../../utils/types";
import { acquireAbortRejectionShield } from "../active-runtime";

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
 * Helper consistency boundary: provider, credentials, reasoning, tool
 * inventory, and prompt are resolved here, once, when the runtime starts.
 * Changing them requires a new CLI session.
 */

const HELPER_PROVIDER_ID = "anthropic";
const HELPER_DEFAULT_MODEL_ID = "claude-sonnet-4-6";
const HELPER_MODEL_ENV_VAR = "CLINE_COMPUTER_USER_MODEL";
const HELPER_REASONING = {
	thinking: true,
	reasoningEffort: "high" as const,
};

/**
 * Resolves the helper's Anthropic model id. The helper's model is chosen
 * independently of the driver's: CLINE_COMPUTER_USER_MODEL wins, then the
 * Anthropic provider entry's saved `model`, then the default. The provider
 * is always the direct `anthropic` provider — the computer-use beta header
 * is only sent on that wire target, so Anthropic models reached through
 * other providers (cline, openrouter, bedrock) would lack the extended
 * action set.
 */
export function resolveHelperModelId(
	helperSettings: { model?: unknown } | undefined,
	env: NodeJS.ProcessEnv,
): string {
	const fromEnv = env[HELPER_MODEL_ENV_VAR]?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	if (
		typeof helperSettings?.model === "string" &&
		helperSettings.model.trim()
	) {
		return helperSettings.model.trim();
	}
	return HELPER_DEFAULT_MODEL_ID;
}

export interface InteractiveComputerUser {
	driverTools: AgentTool[];
	/**
	 * Hooks layer to merge into the driver session's config: records the
	 * driver's transcript and run status to the backend journal alongside
	 * the helper's, so the observatory can flip between both timelines.
	 */
	driverRecordingHooks: AgentHooks;
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
	// Check the local precondition (credentials) before dialing the backend:
	// tool construction queries the backend for display info and holds a
	// socket, which would be wasted if the helper cannot be configured.
	const helperSettings =
		input.providerSettingsManager.getProviderSettings(HELPER_PROVIDER_ID);
	const helperApiKey =
		typeof helperSettings?.apiKey === "string" ? helperSettings.apiKey : "";
	if (!helperApiKey) {
		// No silent fallback to the driver's credentials: the helper requires
		// the Anthropic provider's own configuration.
		return undefined;
	}

	const target = resolveComputerUseTargetFromEnv(input.env ?? process.env);
	if (!target) {
		return undefined;
	}

	// One backend client shared by the computer tool and the observability
	// publisher. The backend serves a single agent connection at a time, so
	// splitting these across two sockets would make one of them dead.
	//
	// No client-side action observer: the backend journals every computer
	// action (with its screenshot) as it executes it, so recording actions
	// here too would give the journal two producers for one event type.
	const computerClient = new ComputerUseClient(target);
	const recorder = new ComputerTaskArtifactRecorder(
		`task_${nanoid(10)}`,
		createJournalEventSink(computerClient),
	);

	const computerTool = await createComputerUseTool({
		...target,
		client: computerClient,
	});
	const helperModelId = resolveHelperModelId(
		helperSettings,
		input.env ?? process.env,
	);
	// Helper model and reasoning settings become effective together when this
	// session is created. Keep the provider config and session config derived
	// from this snapshot so saved manual thinking budgets cannot conflict with
	// adaptive thinking on current Claude models.
	const helperProviderConfig = {
		...toProviderConfig({
			...helperSettings,
			provider: HELPER_PROVIDER_ID,
			model: helperModelId,
			client: undefined,
			protocol: undefined,
			routingProviderId: undefined,
			reasoning: {
				enabled: HELPER_REASONING.thinking,
				effort: HELPER_REASONING.reasoningEffort,
			},
		}),
		clientType: undefined,
		routingProviderId: undefined,
		thinkingBudgetTokens: undefined,
	};

	// The helper config and the coordinator reference each other (the
	// collaboration tools call back into the coordinator). Break the cycle
	// with one shared extraTools array: the coordinator captures the config
	// object now; the tools are pushed into the same array below, before any
	// session can start.
	const helperExtraTools: AgentTool[] = [computerTool];
	const helperConfig = {
		providerId: helperProviderConfig.providerId,
		modelId: helperProviderConfig.modelId,
		apiKey: helperProviderConfig.apiKey,
		baseUrl: helperProviderConfig.baseUrl,
		headers: helperProviderConfig.headers,
		knownModels: helperProviderConfig.knownModels,
		providerConfig: helperProviderConfig,
		...HELPER_REASONING,
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
		// Record the helper's transcript and run status to the backend
		// journal for the observatory.
		hooks: createTranscriptRecordingHooks(recorder, {
			kind: "computer_user",
		}),
	};

	// Lazy: the helper ClineCore spawns only when the driver first delegates.
	// forceLocalBackend keeps the helper in this process, where the
	// computer-use backend's loopback socket is reachable — a hub daemon may
	// run on a different machine from the controlled display.
	let helperCorePromise: Promise<ClineCore> | undefined;
	let activeHelperSend: Promise<unknown> | undefined;
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
			send: async (sendInput) => {
				const send = (await getHelperCore()).send(sendInput);
				if (sendInput.delivery === "steer") {
					return await send;
				}
				activeHelperSend = send;
				try {
					return await send;
				} finally {
					if (activeHelperSend === send) {
						activeHelperSend = undefined;
					}
				}
			},
			abort: async (sessionId, reason) => {
				const releaseAbortShield = acquireAbortRejectionShield();
				try {
					await (await getHelperCore()).abort(sessionId, reason);
				} catch (error) {
					releaseAbortShield();
					throw error;
				}
				const abortedSend = activeHelperSend;
				if (!abortedSend) {
					releaseAbortShield();
					return;
				}
				// The coordinator owns waiting for this run to settle. The adapter
				// only keeps expected provider cancellation rejections shielded for
				// the same interval, without making disposal wait on host teardown.
				void abortedSend.finally(releaseAbortShield).catch(() => {});
			},
			stop: async (sessionId) => (await getHelperCore()).stop(sessionId),
		},
		helperConfig,
		notifyDriver: ({ prompt, delivery }) =>
			input.notifyDriver(prompt, delivery),
		recorder,
	});
	helperExtraTools.push(...createComputerUserCollaborationTools(coordinator));

	return {
		driverTools: createComputerUserDriverTools(coordinator),
		driverRecordingHooks: createTranscriptRecordingHooks(recorder, {
			kind: "driver",
		}),
		dispose: async () => {
			await coordinator.dispose().catch(() => {});
			if (helperCorePromise) {
				const core = await helperCorePromise.catch(() => undefined);
				await core?.dispose().catch(() => {});
			}
			// Push any queued journal publishes out before dropping the
			// backend connection.
			await recorder.flush().catch(() => {});
			computerClient.close();
		},
	};
}
