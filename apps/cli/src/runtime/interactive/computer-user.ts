import {
	type AgentHooks,
	type ClineCore,
	COMPUTER_USER_SYSTEM_PROMPT,
	ComputerBackendRestart,
	ComputerTaskArtifactRecorder,
	ComputerUseClient,
	ComputerUserCoordinator,
	ComputerUserTranscriptLog,
	createComputerBackendRestartTool,
	createComputerUserCollaborationTools,
	createComputerUserDriverTools,
	createComputerUseTool,
	createJournalEventSink,
	createTranscriptRecordingHooks,
	isComputerUseLoopbackHost,
	type ProviderSettingsManager,
	resolveComputerUseBackendCommandFromEnv,
	resolveComputerUseTargetFromEnv,
	toProviderConfig,
} from "@cline/core";
import type { AgentTool, ModelInfo, ModelReasoningOption } from "@cline/shared";
import { nanoid } from "nanoid";
import { createCliCore } from "../../session/session";
import type { Config } from "../../utils/types";
import { acquireAbortRejectionShield } from "../active-runtime";

/**
 * CLI host integration for computer use and its optional asynchronous helper.
 *
 * `CLINE_COMPUTER_USE_PORT` enables the raw tool and driver observability.
 * `CLINE_COMPUTER_USER_MODEL` separately opts into a dedicated interactive
 * ClineCore helper on the direct Anthropic provider. When the helper is active
 * the driver deliberately does not get the raw tool, so all GUI work flows
 * through the helper.
 *
 * Helper consistency boundary: provider, credentials, reasoning, tool
 * inventory, and prompt are resolved here, once, when the runtime starts.
 * Changing them requires a new CLI session.
 */

const HELPER_PROVIDER_ID = "anthropic";
const HELPER_MODEL_ENV_VAR = "CLINE_COMPUTER_USER_MODEL";
const HELPER_REASONING = {
	thinking: true,
	reasoningEffort: "medium" as const,
};

/**
 * Reasoning controls declared for the helper's model, in the models.dev
 * shape the Anthropic provider routing reads. The bundled model catalog
 * ships without `reasoningOptions`, which the routing treats as an
 * unlisted model with manual-only thinking and encodes as
 * `thinking.type.enabled`; current Claude models reject that shape and
 * require `thinking.type.adaptive` with an effort level. Declaring the
 * controls here keeps the helper on the adaptive wire shape regardless of
 * catalog state.
 */
const HELPER_MODEL_REASONING_OPTIONS: ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

function toDirectAnthropicModelId(modelId: string): string {
	const directProviderPrefix = `${HELPER_PROVIDER_ID}/`;
	return modelId.startsWith(directProviderPrefix)
		? modelId.slice(directProviderPrefix.length)
		: modelId;
}

/**
 * Returns the provider config's model catalog with the helper's reasoning
 * controls declared for the helper model, preserving every other entry.
 */
export function withHelperReasoningControls(
	knownModels: Record<string, ModelInfo> | undefined,
	modelId: string,
): Record<string, ModelInfo> {
	return {
		...knownModels,
		[modelId]: {
			...knownModels?.[modelId],
			id: modelId,
			reasoningOptions: HELPER_MODEL_REASONING_OPTIONS,
		},
	};
}

/**
 * Resolves the explicit helper opt-in and its direct Anthropic model id.
 * Anthropic models reached through other providers (cline, openrouter,
 * bedrock) would lack the extended computer-use action set.
 */
export function resolveHelperModelId(
	env: NodeJS.ProcessEnv,
): string | undefined {
	const fromEnv = env[HELPER_MODEL_ENV_VAR]?.trim();
	if (!fromEnv) return undefined;
	return toDirectAnthropicModelId(fromEnv) || undefined;
}

export interface InteractiveComputerUse {
	driverTools: AgentTool[];
	/**
	 * Hooks layer to merge into the driver session's config: records the
	 * driver's transcript and run status to the backend journal alongside
	 * the helper's when present. Direct mode therefore still exposes a driver
	 * lane in the observatory.
	 */
	driverRecordingHooks: AgentHooks;
	dispose(): Promise<void>;
}

export async function createInteractiveComputerUse(input: {
	config: Config;
	providerSettingsManager: Pick<ProviderSettingsManager, "getProviderSettings">;
	/**
	 * Injects a prompt into the driver's conversation. Must resolve the
	 * driver session id at call time (session rebuilds change it), which
	 * `sessionRuntime.sendCurrentTurn` does.
	 */
	notifyDriver: (prompt: string, delivery: "queue" | "steer") => void;
	env?: NodeJS.ProcessEnv;
}): Promise<InteractiveComputerUse | undefined> {
	const env = input.env ?? process.env;
	const target = resolveComputerUseTargetFromEnv(env);
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
	const backendRestart = (() => {
		const command = resolveComputerUseBackendCommandFromEnv(env);
		return command && isComputerUseLoopbackHost(target.host)
			? new ComputerBackendRestart({
					...target,
					command,
					cwd: input.config.cwd,
					client: computerClient,
				})
			: undefined;
	})();
	const disposeComputerUse = async () => {
		await recorder.flush().catch(() => {});
		// Release a backend this process spawned; a backend someone else owns is
		// left running. The restart capability borrows computerClient.
		try {
			await backendRestart?.dispose();
		} finally {
			computerClient.close();
		}
	};

	try {
		if (backendRestart) {
			const startup = await backendRestart.ensureRunning();
			if (startup.status === "failed_to_start") {
				throw new Error(
					`Computer-use backend failed to start: ${startup.error}`,
				);
			}
		}
		const computerTool = await createComputerUseTool({
			...target,
			client: computerClient,
			backendAvailability: backendRestart,
		});
		const driverRecordingHooks = createTranscriptRecordingHooks(recorder, {
			kind: "driver",
		});
		const helperModelId = resolveHelperModelId(env);
		if (!helperModelId) {
			return {
				driverTools: [
					computerTool,
					...(backendRestart
						? [createComputerBackendRestartTool(backendRestart)]
						: []),
				],
				driverRecordingHooks,
				dispose: disposeComputerUse,
			};
		}

		const helperSettings =
			input.providerSettingsManager.getProviderSettings(HELPER_PROVIDER_ID);
		const helperApiKey =
			typeof helperSettings?.apiKey === "string" ? helperSettings.apiKey : "";
		if (!helperSettings || !helperApiKey) {
			// An explicit helper model selects helper mode only when the direct
			// Anthropic provider can run it. The raw tool remains usable otherwise.
			return {
				driverTools: [
					computerTool,
					...(backendRestart
						? [createComputerBackendRestartTool(backendRestart)]
						: []),
				],
				driverRecordingHooks,
				dispose: disposeComputerUse,
			};
		}

		return createInteractiveComputerUser({
			...input,
			helperSettings,
			helperModelId,
			computerTool,
			recorder,
			backendRestart,
			driverRecordingHooks,
			disposeComputerUse,
			env,
		});
	} catch (error) {
		try {
			await disposeComputerUse();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Computer-use startup failed and cleanup also failed",
			);
		}
		throw error;
	}
}

function createInteractiveComputerUser(input: {
	config: Config;
	notifyDriver: (prompt: string, delivery: "queue" | "steer") => void;
	helperSettings: NonNullable<
		ReturnType<ProviderSettingsManager["getProviderSettings"]>
	>;
	helperModelId: string;
	computerTool: AgentTool;
	recorder: ComputerTaskArtifactRecorder;
	backendRestart?: ComputerBackendRestart;
	driverRecordingHooks: AgentHooks;
	disposeComputerUse(): Promise<void>;
	env: NodeJS.ProcessEnv;
}): InteractiveComputerUse {
	const {
		computerTool,
		recorder,
		backendRestart,
		driverRecordingHooks,
		disposeComputerUse,
		helperSettings,
		helperModelId,
	} = input;
	// In-process tail of the helper's transcript. The driver's
	// computer_user_transcript tool reads it, so peeking works even while
	// the backend is down; the tee shares the recording hooks' reduction, so
	// what the tool shows is identical to what the observatory journals.
	const transcriptLog = new ComputerUserTranscriptLog();

	// Helper model and reasoning settings become effective together when this
	// session is created. Keep the provider config and session config derived
	// from this snapshot so saved manual thinking budgets cannot conflict with
	// adaptive thinking on current Claude models. The model's reasoning
	// controls are declared explicitly: the bundled catalog ships without
	// them, and without them the Anthropic routing falls back to the manual
	// thinking shape those models reject.
	const baseProviderConfig = toProviderConfig({
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
	});
	const helperProviderConfig = {
		...baseProviderConfig,
		clientType: undefined,
		routingProviderId: undefined,
		thinkingBudgetTokens: undefined,
		knownModels: withHelperReasoningControls(
			baseProviderConfig.knownModels,
			helperModelId,
		),
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
			start: async (startInput) => {
				// Each session owns its recording source, so late events from a
				// stopped helper cannot be relabelled as its replacement's work.
				const source = {
					kind: "computer_user" as const,
					sessionId: undefined as string | undefined,
				};
				const started = await (await getHelperCore()).start({
					config: {
						...startInput.config,
						hooks: createTranscriptRecordingHooks(recorder, source, (event) =>
							transcriptLog.append(event),
						),
					} as never,
					interactive: startInput.interactive,
				});
				source.sessionId = started.sessionId;
				return started;
			},
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
		transcriptLog,
	});
	helperExtraTools.push(
		...createComputerUserCollaborationTools(coordinator, { backendRestart }),
	);

	return {
		driverTools: createComputerUserDriverTools(coordinator, {
			backendRestart,
		}),
		driverRecordingHooks,
		dispose: async () => {
			await coordinator.dispose().catch(() => {});
			if (helperCorePromise) {
				const core = await helperCorePromise.catch(() => undefined);
				await core?.dispose().catch(() => {});
			}
			await disposeComputerUse();
		},
	};
}
