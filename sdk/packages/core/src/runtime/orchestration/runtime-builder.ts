import type {
	BasicLogger,
	RuntimeConfigExtensionKind,
	TeamTeammateSpec,
	Tool,
} from "@clinebot/shared";
import { hasRuntimeConfigExtension } from "@clinebot/shared";
import { nanoid } from "nanoid";
import { createUserInstructionConfigService } from "../../extensions/config";
import {
	createDefaultMcpServerClientFactory,
	createMcpTools,
	hasMcpSettingsFile,
	InMemoryMcpManager,
	registerMcpServersFromSettingsFile,
	resolveDefaultMcpSettingsPath,
} from "../../extensions/mcp";
import {
	createBuiltinTools,
	DEFAULT_MODEL_TOOL_ROUTING_RULES,
	resolveToolPresetName,
	resolveToolRoutingConfig,
	type SkillsExecutorWithMetadata,
	type ToolExecutors,
	ToolPresets,
	type ToolRoutingRule,
} from "../../extensions/tools";
import {
	AgentTeamsRuntime,
	bootstrapAgentTeams,
	createDelegatedAgentConfigProvider,
	type TeamEvent,
} from "../../extensions/tools/team";
import {
	filterDisabledTools,
	resolveDisabledToolNames,
} from "../../services/global-settings";
import { createLocalTeamStore } from "../../services/storage/team-store";
import type { CoreAgentMode, CoreSessionConfig } from "../../types/config";
import type {
	RuntimeBuilder,
	RuntimeBuilderInput,
	BuiltRuntime as RuntimeEnvironment,
} from "./session-runtime";

function hasConfigExtension(
	extensions: ReadonlyArray<RuntimeConfigExtensionKind> | undefined,
	kind: RuntimeConfigExtensionKind,
): boolean {
	return hasRuntimeConfigExtension(extensions, kind);
}

function isToolEnabledByPolicies(
	toolName: string,
	toolPolicies: CoreSessionConfig["toolPolicies"],
): boolean {
	const globalPolicy = toolPolicies?.["*"] ?? {};
	const toolPolicy = toolPolicies?.[toolName] ?? {};
	return (
		{
			...globalPolicy,
			...toolPolicy,
		}.enabled !== false
	);
}

function filterToolsByPolicies(
	tools: Tool[],
	toolPolicies: CoreSessionConfig["toolPolicies"],
): Tool[] {
	return tools.filter((tool) =>
		isToolEnabledByPolicies(tool.name, toolPolicies),
	);
}

function filterAvailableTools(
	tools: Tool[],
	toolPolicies: CoreSessionConfig["toolPolicies"],
): Tool[] {
	return filterDisabledTools(filterToolsByPolicies(tools, toolPolicies));
}

export function createTeamName(): string {
	return `team-${nanoid(5)}`;
}

function createBuiltinToolsList(
	cwd: string,
	providerId: string,
	mode: CoreAgentMode,
	modelId: string,
	toolRoutingRules: ToolRoutingRule[] | undefined,
	toolPolicies: CoreSessionConfig["toolPolicies"],
	skillsExecutor?: SkillsExecutorWithMetadata,
	executorOverrides?: Partial<ToolExecutors>,
): Tool[] {
	const preset = ToolPresets[resolveToolPresetName({ mode })];
	const toolRoutingConfig = resolveToolRoutingConfig(
		providerId,
		modelId,
		mode,
		toolRoutingRules ?? DEFAULT_MODEL_TOOL_ROUTING_RULES,
	);

	return filterAvailableTools(
		createBuiltinTools({
			cwd,
			...preset,
			enableSkills: !!skillsExecutor,
			...toolRoutingConfig,
			executors: {
				...(skillsExecutor
					? {
							skills: skillsExecutor,
						}
					: {}),
				...(executorOverrides ?? {}),
			},
		}),
		toolPolicies,
	);
}

function isSkillsToolEnabledForSession(input: {
	cwd: string;
	providerId: string;
	mode: CoreAgentMode;
	modelId: string;
	toolRoutingRules?: ToolRoutingRule[];
	toolPolicies?: CoreSessionConfig["toolPolicies"];
	toolExecutors?: Partial<ToolExecutors>;
}): boolean {
	return createBuiltinToolsList(
		input.cwd,
		input.providerId,
		input.mode,
		input.modelId,
		input.toolRoutingRules,
		input.toolPolicies,
		SKILLS_PROBE_EXECUTOR,
		input.toolExecutors,
	).some((tool) => tool.name === "skills");
}

const SKILLS_PROBE_EXECUTOR = (async () => "") as SkillsExecutorWithMetadata;

async function loadConfiguredMcpTools(logger?: BasicLogger): Promise<{
	tools: Tool[];
	shutdown?: () => Promise<void>;
}> {
	const settingsPath = resolveDefaultMcpSettingsPath();
	if (!hasMcpSettingsFile({ filePath: settingsPath })) {
		return { tools: [] };
	}

	const manager = new InMemoryMcpManager({
		clientFactory: createDefaultMcpServerClientFactory(),
	});

	let registrations: Awaited<
		ReturnType<typeof registerMcpServersFromSettingsFile>
	>;
	try {
		registrations = await registerMcpServersFromSettingsFile(manager, {
			filePath: settingsPath,
		});
	} catch (error) {
		await manager.dispose().catch(() => {});
		const message = error instanceof Error ? error.message : String(error);
		logger?.log(
			`[mcp] Failed to load MCP settings, skipping MCP tools: ${message}`,
		);
		return { tools: [] };
	}

	const enabled = registrations.filter((r) => r.disabled !== true);
	const results = await Promise.allSettled(
		enabled.map((r) =>
			createMcpTools({ serverName: r.name, provider: manager }),
		),
	);
	const tools: Tool[] = [];
	for (const [i, result] of results.entries()) {
		if (result.status === "fulfilled") {
			tools.push(...result.value);
		} else {
			const message =
				result.reason instanceof Error
					? result.reason.message
					: String(result.reason);
			logger?.log(
				`[mcp] Failed to load tools from MCP server "${enabled[i].name}", skipping: ${message}`,
			);
		}
	}

	return {
		tools,
		shutdown: async () => {
			await manager.dispose();
		},
	};
}

function shutdownTeamRuntime(
	teamRuntime: AgentTeamsRuntime | undefined,
	reason: string,
): void {
	if (!teamRuntime) {
		return;
	}
	for (const teammateId of teamRuntime.getTeammateIds()) {
		try {
			teamRuntime.shutdownTeammate(teammateId, reason);
		} catch {
			// Best-effort shutdown for all teammates.
		}
	}
}

function isRuntimeLifecycleShutdownReason(reason: string | undefined): boolean {
	if (reason === undefined) {
		return true;
	}
	switch (reason) {
		case "session_stop":
		case "session_complete":
		case "session_error":
		case "session_manager_dispose":
		case "cli_run_shutdown":
		case "cli_interactive_shutdown":
		case "cli_interactive_startup_cancelled":
		case "provider_change":
		case "acp_shutdown":
		case "hub_server_stop":
		case "vscode_webview_dispose":
			return true;
		default:
			return false;
	}
}

function normalizeConfig(
	config: CoreSessionConfig,
): Required<
	Pick<
		CoreSessionConfig,
		| "mode"
		| "enableTools"
		| "enableSpawnAgent"
		| "enableAgentTeams"
		| "disableMcpSettingsTools"
		| "yolo"
		| "missionLogIntervalSteps"
		| "missionLogIntervalMs"
		| "sessionId"
	>
> {
	const preset = ToolPresets[resolveToolPresetName({ mode: config.mode })];
	return {
		sessionId: config.sessionId || "",
		mode:
			config.mode === "plan" ? "plan" : config.mode === "yolo" ? "yolo" : "act",
		enableTools: config.enableTools !== false,
		enableSpawnAgent:
			config.enableSpawnAgent ?? preset.enableSpawnAgent ?? true,
		enableAgentTeams:
			config.enableAgentTeams ?? preset.enableAgentTeams ?? true,
		disableMcpSettingsTools: config.disableMcpSettingsTools === true,
		yolo: config.yolo === true,
		missionLogIntervalSteps:
			typeof config.missionLogIntervalSteps === "number" &&
			Number.isFinite(config.missionLogIntervalSteps)
				? config.missionLogIntervalSteps
				: 3,
		missionLogIntervalMs:
			typeof config.missionLogIntervalMs === "number" &&
			Number.isFinite(config.missionLogIntervalMs)
				? config.missionLogIntervalMs
				: 120000,
	};
}

export class DefaultRuntimeBuilder implements RuntimeBuilder {
	private readonly teamRuntimeEntries = new Map<
		string,
		{
			runtime?: AgentTeamsRuntime;
			delegatedAgentConfigProvider: ReturnType<
				typeof createDelegatedAgentConfigProvider
			>;
		}
	>();

	async build(input: RuntimeBuilderInput): Promise<RuntimeEnvironment> {
		const {
			config,
			hooks,
			extensions,
			logger,
			telemetry,
			createSpawnTool,
			onTeamRestored,
			userInstructionService: sharedUserInstructionService,
			configExtensions,
			toolExecutors,
		} = input;
		const onTeamEvent = input.onTeamEvent ?? (() => {});
		const normalized = normalizeConfig(config);
		const globallyDisabledToolNames = resolveDisabledToolNames();
		const tools: Tool[] = [];
		const effectiveTeamName = config.teamName?.trim() || createTeamName();
		const teamStoreKey = config.sessionId?.trim() || effectiveTeamName;
		const rulesEnabled = hasConfigExtension(configExtensions, "rules");
		const skillsEnabled = hasConfigExtension(configExtensions, "skills");
		const workflowsEnabled = hasConfigExtension(configExtensions, "workflows");
		const userInstructionsEnabled =
			rulesEnabled || skillsEnabled || workflowsEnabled;
		let teamToolsRegistered = false;
		const userInstructionServiceProvided = Boolean(
			sharedUserInstructionService,
		);
		let userInstructionService = sharedUserInstructionService;
		let mcpShutdown: (() => Promise<void>) | undefined;

		if (!userInstructionService && userInstructionsEnabled) {
			userInstructionService = createUserInstructionConfigService({
				skills: { workspacePath: config.cwd },
				rules: { workspacePath: config.cwd },
				workflows: { workspacePath: config.cwd },
			});
		}

		if (userInstructionService) {
			await userInstructionService.start().catch(() => {});
		}

		const registerSkillsTool =
			normalized.enableTools &&
			skillsEnabled &&
			Boolean(userInstructionService) &&
			(userInstructionServiceProvided ||
				userInstructionService?.hasConfiguredSkills(config.skills) === true) &&
			isSkillsToolEnabledForSession({
				cwd: config.cwd,
				providerId: config.providerId,
				mode: normalized.mode,
				modelId: config.modelId,
				toolRoutingRules: config.toolRoutingRules,
				toolPolicies: config.toolPolicies,
				toolExecutors,
			});

		const userInstructionPlugin =
			userInstructionService && userInstructionsEnabled
				? userInstructionService.createExtension({
						includeRules: rulesEnabled,
						includeSkills: skillsEnabled,
						includeWorkflows: workflowsEnabled,
						registerSkillsTool,
						allowedSkillNames: config.skills,
					})
				: undefined;
		const runtimeExtensions = userInstructionPlugin
			? [...(extensions ?? config.extensions ?? []), userInstructionPlugin]
			: (extensions ?? config.extensions);

		if (normalized.enableTools) {
			tools.push(
				...createBuiltinToolsList(
					config.cwd,
					config.providerId,
					normalized.mode,
					config.modelId,
					config.toolRoutingRules,
					config.toolPolicies,
					undefined,
					toolExecutors,
				),
			);
			if (!normalized.disableMcpSettingsTools) {
				const mcpRuntime = await loadConfiguredMcpTools(config.logger);
				tools.push(...mcpRuntime.tools);
				mcpShutdown = mcpRuntime.shutdown;
			}
		}

		let teamRuntime: AgentTeamsRuntime | undefined;
		const teamStore = normalized.enableAgentTeams
			? createLocalTeamStore()
			: undefined;
		const restoredTeam = teamStore?.loadRuntime(teamStoreKey);
		const restoredTeamState = restoredTeam?.state;
		const restoredTeammateSpecs = restoredTeam?.teammates ?? [];
		const teammateSpecs = new Map(
			restoredTeammateSpecs.map((spec) => [spec.agentId, spec] as const),
		);
		const registryKey = config.sessionId || effectiveTeamName;
		let leadAgentInstance:
			| {
					addTools: (tools: Tool[]) => void;
			  }
			| undefined;
		let pendingLeadTeamTools: Tool[] = [];
		let restoredStateHydratedIntoRuntime = false;
		const delegatedAgentConfigProvider = createDelegatedAgentConfigProvider({
			providerId: config.providerId,
			modelId: config.modelId,
			cwd: config.cwd,
			apiKey: config.apiKey ?? "",
			baseUrl: config.baseUrl,
			headers: config.headers,
			providerConfig: config.providerConfig,
			knownModels: config.knownModels,
			thinking: config.thinking,
			maxIterations: config.maxIterations,
			hooks,
			extensions: runtimeExtensions,
			logger: logger ?? config.logger,
			telemetry: input.telemetry ?? config.telemetry,
			workspaceMetadata: config.workspaceMetadata,
		});
		if (!this.teamRuntimeEntries.has(registryKey)) {
			this.teamRuntimeEntries.set(registryKey, {
				delegatedAgentConfigProvider,
			});
		}

		const ensureTeamRuntime = (): AgentTeamsRuntime | undefined => {
			if (!normalized.enableAgentTeams) {
				return undefined;
			}

			const registryEntry = this.teamRuntimeEntries.get(registryKey) ?? {
				delegatedAgentConfigProvider,
			};
			this.teamRuntimeEntries.set(registryKey, registryEntry);
			teamRuntime = registryEntry.runtime;

			if (!teamRuntime) {
				teamRuntime = new AgentTeamsRuntime({
					teamName: effectiveTeamName,
					leadAgentId: config.sessionId || "lead",
					missionLogIntervalSteps: normalized.missionLogIntervalSteps,
					missionLogIntervalMs: normalized.missionLogIntervalMs,
					onTeamEvent: (event: TeamEvent) => {
						onTeamEvent(event);
						if (teamRuntime && teamStore) {
							if (
								event.type === "teammate_spawned" &&
								event.teammate?.rolePrompt
							) {
								const spec: TeamTeammateSpec = {
									agentId: event.agentId,
									rolePrompt: event.teammate.rolePrompt,
									modelId: event.teammate.modelId,
									maxIterations: event.teammate.maxIterations,
								};
								teammateSpecs.set(spec.agentId, spec);
							}
							if (
								event.type === "teammate_shutdown" &&
								!isRuntimeLifecycleShutdownReason(event.reason)
							) {
								teammateSpecs.delete(event.agentId);
							}
							teamStore.handleTeamEvent(teamStoreKey, event);
							teamStore.persistRuntime(
								teamStoreKey,
								teamRuntime.exportState(),
								Array.from(teammateSpecs.values()),
							);
						}
					},
				});
				if (restoredTeamState) {
					teamRuntime.hydrateState(restoredTeamState);
					restoredStateHydratedIntoRuntime = true;
				}
				registryEntry.runtime = teamRuntime;
			}

			if (!teamToolsRegistered) {
				if (!teamRuntime) {
					return undefined;
				}
				teamToolsRegistered = true;

				const teamBootstrap = bootstrapAgentTeams({
					runtime: teamRuntime,
					leadAgentId: config.sessionId || "lead",
					restoredFromPersistence: Boolean(restoredTeamState),
					restoredTeammates: restoredTeammateSpecs,
					includeLeadSpawnTool: true,
					includeLeadManagementTools: true,
					onLeadToolsUnlocked: (teamTools) => {
						pendingLeadTeamTools = teamTools;
						leadAgentInstance?.addTools(teamTools);
					},
					createBaseTools: normalized.enableTools
						? () =>
								createBuiltinToolsList(
									config.cwd,
									config.providerId,
									normalized.mode,
									config.modelId,
									config.toolRoutingRules,
									config.toolPolicies,
									undefined,
									toolExecutors,
								)
						: undefined,
					teammateConfigProvider: delegatedAgentConfigProvider,
				});

				if (restoredStateHydratedIntoRuntime) {
					teamRuntime.recoverActiveRuns("runtime_recovered");
				}

				if (teamBootstrap.restoredFromPersistence) {
					onTeamRestored?.();
				}
				tools.push(...teamBootstrap.tools);
			}

			return teamRuntime;
		};

		if (normalized.enableSpawnAgent && createSpawnTool) {
			const spawnTool = createSpawnTool();
			tools.push({
				...spawnTool,
				execute: async (spawnInput, context) => {
					ensureTeamRuntime();
					return spawnTool.execute(spawnInput, context);
				},
			});
		}

		if (normalized.enableAgentTeams) {
			ensureTeamRuntime();
		}

		const finalTools = filterAvailableTools(tools, config.toolPolicies);
		const teamCompletionGuard = normalized.enableAgentTeams
			? (): string | undefined => {
					const rt = this.teamRuntimeEntries.get(registryKey)?.runtime;
					if (!rt) return undefined;
					const tasks = rt.listTasks();
					const hasInProgress = tasks.some(
						(t) => t.status === "in_progress" || t.status === "pending",
					);
					const runs = rt.listRuns({});
					const hasActiveRuns = runs.some(
						(r) => r.status === "running" || r.status === "queued",
					);
					if (hasInProgress || hasActiveRuns) {
						const pending = tasks
							.filter(
								(t) => t.status === "in_progress" || t.status === "pending",
							)
							.map((t) => `${t.id} (${t.status}): ${t.title}`)
							.join(", ");
						const activeRunSummary = runs
							.filter((r) => r.status === "running" || r.status === "queued")
							.map((r) => `${r.id} (${r.status})`)
							.join(", ");
						const parts = [];
						if (pending) parts.push(`Unfinished tasks: ${pending}`);
						if (activeRunSummary)
							parts.push(`Active runs: ${activeRunSummary}`);
						return `[SYSTEM] You still have team obligations. ${parts.join(". ")}. Use team_run_task to delegate work, or team_task with action=complete to mark tasks done, or team_await_runs to wait for active runs. Do NOT stop until all tasks are completed.`;
					}
					return undefined;
				}
			: undefined;
		const completionPolicy =
			normalized.mode === "yolo" && normalized.enableTools
				? {
						requireCompletionTool: true,
						...(teamCompletionGuard
							? { completionGuard: teamCompletionGuard }
							: {}),
					}
				: teamCompletionGuard
					? { completionGuard: teamCompletionGuard }
					: undefined;

		return {
			tools: finalTools,
			logger: logger ?? config.logger,
			telemetry: telemetry ?? config.telemetry,
			teamRuntime,
			teamRestoredFromPersistence: Boolean(restoredTeamState),
			delegatedAgentConfigProvider:
				this.teamRuntimeEntries.get(registryKey)
					?.delegatedAgentConfigProvider ?? delegatedAgentConfigProvider,
			extensions: runtimeExtensions,
			completionPolicy,
			registerLeadAgent: (agent) => {
				leadAgentInstance = agent;
				if (pendingLeadTeamTools.length > 0) {
					agent.addTools(
						filterDisabledTools(pendingLeadTeamTools, [
							...globallyDisabledToolNames,
						]),
					);
				}
			},
			shutdown: async (reason: string) => {
				shutdownTeamRuntime(teamRuntime, reason);
				this.teamRuntimeEntries.delete(registryKey);
				await mcpShutdown?.();
				if (!userInstructionServiceProvided) {
					userInstructionService?.stop();
				}
			},
		};
	}
}
