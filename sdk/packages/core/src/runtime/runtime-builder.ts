import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Tool } from "@clinebot/shared";
import { resolveSkillsConfigSearchPaths } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import {
	createUserInstructionConfigWatcher,
	type SkillConfig,
	type UserInstructionConfigWatcher,
} from "../agents";
import { createLocalTeamStore } from "../storage/team-store";
import {
	AgentTeamsRuntime,
	bootstrapAgentTeams,
	createDelegatedAgentConfigProvider,
	type TeamEvent,
	type TeamTeammateSpec,
} from "../team";
import {
	createBuiltinTools,
	DEFAULT_MODEL_TOOL_ROUTING_RULES,
	resolveToolRoutingConfig,
	type SkillsExecutor,
	type ToolExecutors,
	ToolPresets,
	type ToolRoutingRule,
} from "../tools";
import type { CoreAgentMode, CoreSessionConfig } from "../types/config";
import type {
	RuntimeBuilder,
	RuntimeBuilderInput,
	BuiltRuntime as RuntimeEnvironment,
} from "./session-runtime";
import { TeamRuntimeRegistry } from "./team-runtime-registry";

type SkillsExecutorMetadataItem = {
	id: string;
	name: string;
	description?: string;
	disabled: boolean;
};

type SkillsExecutorWithMetadata = SkillsExecutor & {
	configuredSkills?: SkillsExecutorMetadataItem[];
};

export function createTeamName(): string {
	return `team-${nanoid(5)}`;
}

function createBuiltinToolsList(
	cwd: string,
	providerId: string,
	mode: CoreAgentMode,
	modelId: string,
	toolPolicies: CoreSessionConfig["toolPolicies"],
	toolRoutingRules: ToolRoutingRule[] | undefined,
	skillsExecutor?: SkillsExecutorWithMetadata,
	executorOverrides?: Partial<ToolExecutors>,
): Tool[] {
	const preset =
		mode === "plan"
			? ToolPresets.readonly
			: toolPolicies?.["*"]?.autoApprove === true
				? ToolPresets.yolo
				: ToolPresets.development;
	const toolRoutingConfig = resolveToolRoutingConfig(
		providerId,
		modelId,
		mode,
		toolRoutingRules ?? DEFAULT_MODEL_TOOL_ROUTING_RULES,
	);

	return createBuiltinTools({
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
	});
}

const SKILL_FILE_NAME = "SKILL.md";

function listAvailableSkillNames(
	watcher: UserInstructionConfigWatcher,
	allowedSkillNames?: ReadonlyArray<string>,
): string[] {
	return listConfiguredSkills(watcher, allowedSkillNames)
		.filter((skill) => !skill.disabled)
		.map((skill) => skill.name.trim())
		.filter((name) => name.length > 0)
		.sort((a, b) => a.localeCompare(b));
}

function normalizeSkillToken(token: string): string {
	return token.trim().replace(/^\/+/, "").toLowerCase();
}

function toAllowedSkillSet(
	allowedSkillNames?: ReadonlyArray<string>,
): Set<string> | undefined {
	if (!allowedSkillNames || allowedSkillNames.length === 0) {
		return undefined;
	}
	const normalized = allowedSkillNames
		.map(normalizeSkillToken)
		.filter((token) => token.length > 0);
	return normalized.length > 0 ? new Set(normalized) : undefined;
}

function isSkillAllowed(
	skillId: string,
	skillName: string,
	allowedSkills?: Set<string>,
): boolean {
	if (!allowedSkills) {
		return true;
	}
	const normalizedId = normalizeSkillToken(skillId);
	const normalizedName = normalizeSkillToken(skillName);
	const bareId = normalizedId.includes(":")
		? (normalizedId.split(":").at(-1) ?? normalizedId)
		: normalizedId;
	const bareName = normalizedName.includes(":")
		? (normalizedName.split(":").at(-1) ?? normalizedName)
		: normalizedName;
	return (
		allowedSkills.has(normalizedId) ||
		allowedSkills.has(normalizedName) ||
		allowedSkills.has(bareId) ||
		allowedSkills.has(bareName)
	);
}

function listConfiguredSkills(
	watcher: UserInstructionConfigWatcher,
	allowedSkillNames?: ReadonlyArray<string>,
): SkillsExecutorMetadataItem[] {
	const allowedSkills = toAllowedSkillSet(allowedSkillNames);
	const snapshot = watcher.getSnapshot("skill");
	return [...snapshot.entries()]
		.map(([id, record]) => {
			const skill = record.item as SkillConfig;
			return {
				id,
				name: skill.name.trim(),
				description: skill.description?.trim(),
				disabled: skill.disabled === true,
			};
		})
		.filter((skill) => isSkillAllowed(skill.id, skill.name, allowedSkills));
}

function hasSkillsFiles(workspacePath: string): boolean {
	for (const directoryPath of resolveSkillsConfigSearchPaths(workspacePath)) {
		if (!existsSync(directoryPath)) {
			continue;
		}

		const directSkillPath = join(directoryPath, SKILL_FILE_NAME);
		if (existsSync(directSkillPath)) {
			return true;
		}

		try {
			const entries = readdirSync(directoryPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}
				if (existsSync(join(directoryPath, entry.name, SKILL_FILE_NAME))) {
					return true;
				}
			}
		} catch {
			// Ignore inaccessible directories while probing for local skills.
		}
	}

	return false;
}

function resolveSkillRecord(
	watcher: UserInstructionConfigWatcher,
	requestedSkill: string,
	allowedSkillNames?: ReadonlyArray<string>,
): { id: string; skill: SkillConfig } | { error: string } {
	const allowedSkills = toAllowedSkillSet(allowedSkillNames);
	const normalized = requestedSkill.trim().replace(/^\/+/, "").toLowerCase();
	if (!normalized) {
		return { error: "Missing skill name." };
	}

	const snapshot = watcher.getSnapshot("skill");
	const scopedEntries = [...snapshot.entries()].filter(([id, record]) => {
		const skill = record.item as SkillConfig;
		return isSkillAllowed(id, skill.name, allowedSkills);
	});
	const scopedSnapshot = new Map(scopedEntries);
	const exact = scopedSnapshot.get(normalized);
	if (exact) {
		const skill = exact.item as SkillConfig;
		if (skill.disabled === true) {
			return {
				error: `Skill "${skill.name}" is configured but disabled.`,
			};
		}
		return {
			id: normalized,
			skill,
		};
	}

	const bareName = normalized.includes(":")
		? (normalized.split(":").at(-1) ?? normalized)
		: normalized;

	const suffixMatches = [...scopedSnapshot.entries()].filter(([id]) => {
		if (id === bareName) {
			return true;
		}
		return id.endsWith(`:${bareName}`);
	});

	if (suffixMatches.length === 1) {
		const [id, record] = suffixMatches[0];
		const skill = record.item as SkillConfig;
		if (skill.disabled === true) {
			return {
				error: `Skill "${skill.name}" is configured but disabled.`,
			};
		}
		return {
			id,
			skill,
		};
	}

	if (suffixMatches.length > 1) {
		return {
			error: `Skill "${requestedSkill}" is ambiguous. Use one of: ${suffixMatches.map(([id]) => id).join(", ")}`,
		};
	}

	const available = listAvailableSkillNames(watcher, allowedSkillNames);
	return {
		error:
			available.length > 0
				? `Skill "${requestedSkill}" not found. Available skills: ${available.join(", ")}`
				: "No skills are currently available.",
	};
}

function createSkillsExecutor(
	watcher: UserInstructionConfigWatcher,
	watcherReady: Promise<void>,
	allowedSkillNames?: ReadonlyArray<string>,
): SkillsExecutorWithMetadata {
	const runningSkills = new Set<string>();
	const executor: SkillsExecutorWithMetadata = async (skillName, args) => {
		await watcherReady;
		const resolved = resolveSkillRecord(watcher, skillName, allowedSkillNames);
		if ("error" in resolved) {
			return resolved.error;
		}

		const { id, skill } = resolved;
		if (runningSkills.has(id)) {
			return `Skill "${skill.name}" is already running.`;
		}

		runningSkills.add(id);
		try {
			const trimmedArgs = args?.trim();
			const argsTag = trimmedArgs
				? `\n<command-args>${trimmedArgs}</command-args>`
				: "";
			const description = skill.description?.trim()
				? `Description: ${skill.description.trim()}\n\n`
				: "";

			return `<command-name>${skill.name}</command-name>${argsTag}\n<command-instructions>\n${description}${skill.instructions}\n</command-instructions>`;
		} finally {
			runningSkills.delete(id);
		}
	};
	Object.defineProperty(executor, "configuredSkills", {
		get: () => listConfiguredSkills(watcher, allowedSkillNames),
		enumerable: true,
		configurable: false,
	});
	return executor;
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

function normalizeConfig(
	config: CoreSessionConfig,
): Required<
	Pick<
		CoreSessionConfig,
		| "mode"
		| "enableTools"
		| "enableSpawnAgent"
		| "enableAgentTeams"
		| "missionLogIntervalSteps"
		| "missionLogIntervalMs"
		| "sessionId"
	>
> {
	return {
		sessionId: config.sessionId || "",
		mode: config.mode === "plan" ? "plan" : "act",
		enableTools: config.enableTools !== false,
		enableSpawnAgent: config.enableSpawnAgent !== false,
		enableAgentTeams: config.enableAgentTeams !== false,
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
	private readonly teamRuntimeRegistry = new TeamRuntimeRegistry();

	build(input: RuntimeBuilderInput): RuntimeEnvironment {
		const {
			config,
			hooks,
			extensions,
			logger,
			telemetry,
			createSpawnTool,
			onTeamRestored,
			userInstructionWatcher: sharedUserInstructionWatcher,
			defaultToolExecutors,
		} = input;
		const onTeamEvent = input.onTeamEvent ?? (() => {});
		const normalized = normalizeConfig(config);
		const tools: Tool[] = [];
		const effectiveTeamName = config.teamName?.trim() || createTeamName();
		let teamToolsRegistered = false;
		const watcherProvided = Boolean(sharedUserInstructionWatcher);
		let userInstructionWatcher = sharedUserInstructionWatcher;
		let watcherReady = Promise.resolve();
		let skillsExecutor: SkillsExecutorWithMetadata | undefined;

		if (
			!userInstructionWatcher &&
			normalized.enableTools &&
			hasSkillsFiles(config.cwd)
		) {
			userInstructionWatcher = createUserInstructionConfigWatcher({
				skills: { workspacePath: config.cwd },
				rules: { workspacePath: config.cwd },
				workflows: { workspacePath: config.cwd },
			});
			watcherReady = userInstructionWatcher.start().catch(() => {});
		}

		if (
			normalized.enableTools &&
			userInstructionWatcher &&
			(watcherProvided ||
				hasSkillsFiles(config.cwd) ||
				listConfiguredSkills(userInstructionWatcher, config.skills).length > 0)
		) {
			skillsExecutor = createSkillsExecutor(
				userInstructionWatcher,
				watcherReady,
				config.skills,
			);
		}

		if (normalized.enableTools) {
			tools.push(
				...createBuiltinToolsList(
					config.cwd,
					config.providerId,
					normalized.mode,
					config.modelId,
					config.toolPolicies,
					config.toolRoutingRules,
					skillsExecutor,
					defaultToolExecutors,
				),
			);
		}

		let teamRuntime: AgentTeamsRuntime | undefined;
		const teamStore = normalized.enableAgentTeams
			? createLocalTeamStore()
			: undefined;
		const restoredTeam = teamStore?.loadRuntime(effectiveTeamName);
		const restoredTeamState = restoredTeam?.state;
		const restoredTeammateSpecs = restoredTeam?.teammates ?? [];
		const teammateSpecs = new Map(
			restoredTeammateSpecs.map((spec) => [spec.agentId, spec] as const),
		);
		const registryKey = config.sessionId || effectiveTeamName;
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
			extensions: extensions ?? config.extensions,
			logger: logger ?? config.logger,
			telemetry: input.telemetry ?? config.telemetry,
			workspaceMetadata: config.workspaceMetadata,
		});
		this.teamRuntimeRegistry.getOrCreate(registryKey, () => ({
			delegatedAgentConfigProvider,
		}));

		const ensureTeamRuntime = (): AgentTeamsRuntime | undefined => {
			if (!normalized.enableAgentTeams) {
				return undefined;
			}

			const registryEntry = this.teamRuntimeRegistry.getOrCreate(
				registryKey,
				() => ({
					delegatedAgentConfigProvider,
				}),
			);
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
							if (event.type === "teammate_shutdown") {
								teammateSpecs.delete(event.agentId);
							}
							teamStore.handleTeamEvent(effectiveTeamName, event);
							teamStore.persistRuntime(
								effectiveTeamName,
								teamRuntime.exportState(),
								Array.from(teammateSpecs.values()),
							);
						}
					},
				});
				if (restoredTeamState) {
					teamRuntime.hydrateState(restoredTeamState);
					teamRuntime.markStaleRunsInterrupted("runtime_recovered");
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
					leadAgentId: "lead",
					restoredFromPersistence: Boolean(restoredTeamState),
					restoredTeammates: restoredTeammateSpecs,
					createBaseTools: normalized.enableTools
						? () =>
								createBuiltinToolsList(
									config.cwd,
									config.providerId,
									normalized.mode,
									config.modelId,
									config.toolPolicies,
									config.toolRoutingRules,
									skillsExecutor,
									defaultToolExecutors,
								)
						: undefined,
					teammateConfigProvider: delegatedAgentConfigProvider,
				});

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

		const completionGuard = normalized.enableAgentTeams
			? () => {
					const rt = this.teamRuntimeRegistry.get(registryKey)?.runtime;
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
						return `[SYSTEM] You still have team obligations. ${parts.join(". ")}. Use team_run_task to delegate work, or team_task with action=complete to mark tasks done, or team_await_run / team_await_all_runs to wait for active runs. Do NOT stop until all tasks are completed.`;
					}
					return undefined;
				}
			: undefined;

		return {
			tools,
			logger: logger ?? config.logger,
			telemetry: telemetry ?? config.telemetry,
			teamRuntime,
			teamRestoredFromPersistence: Boolean(restoredTeamState),
			delegatedAgentConfigProvider:
				this.teamRuntimeRegistry.get(registryKey)
					?.delegatedAgentConfigProvider ?? delegatedAgentConfigProvider,
			completionGuard,
			shutdown: (reason: string) => {
				shutdownTeamRuntime(teamRuntime, reason);
				this.teamRuntimeRegistry.delete(registryKey);
				if (!watcherProvided) {
					userInstructionWatcher?.stop();
				}
			},
		};
	}
}
