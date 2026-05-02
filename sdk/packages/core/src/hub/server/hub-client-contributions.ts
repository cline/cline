import type {
	AgentExtension,
	AgentHookControl,
	AgentHooks,
	AgentTool,
	AgentToolContext,
	ConsecutiveMistakeLimitDecision,
	HubClientCheckpointContribution,
	HubClientCompactionContribution,
	HubClientContribution,
	HubClientHookContribution,
	HubClientToolContribution,
	HubClientToolExecutorContribution,
	JsonValue,
} from "@clinebot/shared";
import {
	HUB_CHECKPOINT_CAPABILITY,
	HUB_COMPACTION_CAPABILITY,
	HUB_CUSTOM_TOOL_CAPABILITY_PREFIX,
	HUB_HOOK_CAPABILITY_PREFIX,
	HUB_MISTAKE_LIMIT_CAPABILITY,
	HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX,
	HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
	isHubToolExecutorName,
} from "@clinebot/shared";

export {
	HUB_CHECKPOINT_CAPABILITY,
	HUB_COMPACTION_CAPABILITY,
	HUB_CUSTOM_TOOL_CAPABILITY_PREFIX,
	HUB_HOOK_CAPABILITY_PREFIX,
	HUB_MISTAKE_LIMIT_CAPABILITY,
	HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX,
	HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
} from "@clinebot/shared";

import type {
	AvailableRuntimeCommand,
	UserInstructionConfig,
	UserInstructionConfigRecord,
	UserInstructionConfigService,
	UserInstructionConfigType,
} from "../../extensions/config";
import type { ToolExecutors } from "../../extensions/tools";
import {
	createSkillsTool,
	type SkillsExecutor,
	type SkillsExecutorWithMetadata,
} from "../../extensions/tools";
import type {
	LocalRuntimeStartOptions,
	RuntimeSessionConfig,
} from "../../runtime/host/runtime-host";
import { formatRulesForSystemPrompt } from "../../runtime/safety/rules";
import type { CoreSessionConfig } from "../../types/config";

type RequestCapability = (
	sessionId: string,
	capabilityName: string,
	payload: Record<string, unknown>,
	targetClientId: string,
	onProgress?: (payload: Record<string, unknown>) => void,
) => Promise<Record<string, unknown> | undefined>;

type CompactFunction = NonNullable<
	NonNullable<CoreSessionConfig["compaction"]>["compact"]
>;
type CreateCheckpointFunction = NonNullable<
	NonNullable<CoreSessionConfig["checkpoint"]>["createCheckpoint"]
>;

type UserInstructionSnapshot = {
	records: Record<UserInstructionConfigType, UserInstructionConfigRecord[]>;
	runtimeCommands: AvailableRuntimeCommand[];
};

const HOOK_NAMES = [
	"onSessionStart",
	"onRunStart",
	"onRunEnd",
	"onIterationStart",
	"onIterationEnd",
	"onTurnStart",
	"onBeforeAgentStart",
	"onTurnEnd",
	"onStopError",
	"onToolCallStart",
	"onToolCallEnd",
	"onSessionShutdown",
	"onError",
] as const satisfies readonly (keyof AgentHooks)[];

type HubAgentHookName = (typeof HOOK_NAMES)[number];

export function listHubAgentHookNames(hooks: AgentHooks | undefined): string[] {
	if (!hooks) return [];
	return HOOK_NAMES.filter((name) => typeof hooks[name] === "function");
}

function cloneRecord(
	value: unknown,
): Record<string, JsonValue | undefined> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (JSON.parse(JSON.stringify(value)) as Record<
				string,
				JsonValue | undefined
			>)
		: undefined;
}

function parseToolContribution(
	record: Record<string, unknown>,
	seenCapabilities: Set<string>,
): HubClientToolContribution | undefined {
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const description =
		typeof record.description === "string" ? record.description : "";
	const capabilityName =
		typeof record.capabilityName === "string"
			? record.capabilityName.trim()
			: "";
	const inputSchema = cloneRecord(record.inputSchema);
	if (
		!name ||
		!description ||
		!inputSchema ||
		!capabilityName ||
		seenCapabilities.has(capabilityName)
	) {
		return undefined;
	}
	seenCapabilities.add(capabilityName);
	return {
		kind: "tool",
		capabilityName,
		name,
		description,
		inputSchema,
		...(cloneRecord(record.lifecycle)
			? { lifecycle: cloneRecord(record.lifecycle) }
			: {}),
	};
}

export function parseHubClientContributions(
	value: unknown,
): HubClientContribution[] {
	if (!Array.isArray(value)) return [];
	const contributions: HubClientContribution[] = [];
	const seenCapabilities = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const kind = record.kind;
		const capabilityName =
			typeof record.capabilityName === "string"
				? record.capabilityName.trim()
				: "";
		if (!capabilityName || seenCapabilities.has(capabilityName)) continue;

		if (kind === "tool") {
			const contribution = parseToolContribution(record, seenCapabilities);
			if (contribution) contributions.push(contribution);
			continue;
		}

		if (kind === "toolExecutor") {
			const executor = record.executor;
			if (!isHubToolExecutorName(executor)) continue;
			seenCapabilities.add(capabilityName);
			contributions.push({
				kind: "toolExecutor",
				capabilityName,
				executor,
			});
			continue;
		}

		if (kind === "hook") {
			const name = typeof record.name === "string" ? record.name.trim() : "";
			if (!name) continue;
			seenCapabilities.add(capabilityName);
			contributions.push({ kind: "hook", capabilityName, name });
			continue;
		}

		if (kind === "compaction") {
			seenCapabilities.add(capabilityName);
			contributions.push({
				kind: "compaction",
				capabilityName,
				...(cloneRecord(record.config)
					? { config: cloneRecord(record.config) }
					: {}),
			});
			continue;
		}

		if (kind === "checkpoint") {
			seenCapabilities.add(capabilityName);
			contributions.push({
				kind: "checkpoint",
				capabilityName,
				...(cloneRecord(record.config)
					? { config: cloneRecord(record.config) }
					: {}),
			});
			continue;
		}

		if (kind === "mistakeLimit") {
			seenCapabilities.add(capabilityName);
			contributions.push({ kind: "mistakeLimit", capabilityName });
			continue;
		}

		if (kind === "userInstructionService") {
			seenCapabilities.add(capabilityName);
			contributions.push({ kind: "userInstructionService", capabilityName });
		}
	}
	return contributions;
}

function serializeToolContext(
	context: AgentToolContext,
): Record<string, unknown> {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		iteration: context.iteration,
		metadata: context.metadata,
	};
}

function asToolUpdate(payload: Record<string, unknown>): unknown {
	return Object.hasOwn(payload, "update") ? payload.update : payload;
}

function normalizeSkillToken(token: string): string {
	return token.trim().replace(/^\/+/, "").toLowerCase();
}

function toAllowedSkillSet(
	allowedSkillNames?: ReadonlyArray<string>,
): Set<string> | undefined {
	const normalized = (allowedSkillNames ?? [])
		.map(normalizeSkillToken)
		.filter(Boolean);
	return normalized.length > 0 ? new Set(normalized) : undefined;
}

function isSkillAllowed(
	skillId: string,
	skillName: string,
	allowedSkills?: Set<string>,
): boolean {
	if (!allowedSkills) return true;
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

function configuredSkills(
	snapshot: UserInstructionSnapshot,
	allowedSkillNames?: ReadonlyArray<string>,
) {
	const allowed = toAllowedSkillSet(allowedSkillNames);
	return snapshot.records.skill
		.map((record) => ({
			id: record.id,
			name: record.item.name,
			description:
				"description" in record.item &&
				typeof record.item.description === "string"
					? record.item.description
					: undefined,
			disabled: record.item.disabled === true,
			skill: record.item,
		}))
		.filter((entry) => isSkillAllowed(entry.id, entry.name, allowed));
}

function createSnapshotSkillsExecutor(
	snapshot: UserInstructionSnapshot,
	allowedSkillNames?: ReadonlyArray<string>,
): SkillsExecutorWithMetadata {
	const executor: SkillsExecutorWithMetadata = (async (skillName, args) => {
		const normalized = normalizeSkillToken(skillName);
		const matches = configuredSkills(snapshot, allowedSkillNames).filter(
			(entry) =>
				entry.id === normalized ||
				normalizeSkillToken(entry.name) === normalized ||
				entry.id.endsWith(`:${normalized}`),
		);
		const enabled = matches.filter((entry) => !entry.disabled);
		if (enabled.length !== 1) {
			return enabled.length > 1
				? `Skill "${skillName}" is ambiguous. Use one of: ${enabled.map((entry) => entry.id).join(", ")}`
				: `Skill "${skillName}" not found.`;
		}
		const skill = enabled[0].skill as {
			name: string;
			description?: string;
			instructions: string;
		};
		const trimmedArgs = args?.trim();
		const argsTag = trimmedArgs
			? `\n<command-args>${trimmedArgs}</command-args>`
			: "";
		const description = skill.description?.trim()
			? `Description: ${skill.description.trim()}\n\n`
			: "";
		return `<command-name>${skill.name}</command-name>${argsTag}\n<command-instructions>\n${description}${skill.instructions}\n</command-instructions>`;
	}) as SkillsExecutor;

	Object.defineProperty(executor, "configuredSkills", {
		get: () =>
			configuredSkills(snapshot, allowedSkillNames).map(
				({ skill: _skill, ...metadata }) => metadata,
			),
		enumerable: true,
	});
	return executor;
}

function createUserInstructionServiceProxy(
	sessionId: string,
	targetClientId: string,
	contribution: HubClientContribution,
	requestCapability: RequestCapability,
): UserInstructionConfigService {
	let snapshot: UserInstructionSnapshot = {
		records: { skill: [], rule: [], workflow: [] },
		runtimeCommands: [],
	};
	const loadSnapshot = async (): Promise<void> => {
		const response = await requestCapability(
			sessionId,
			contribution.capabilityName,
			{},
			targetClientId,
		);
		if (response?.snapshot) {
			snapshot = response.snapshot as UserInstructionSnapshot;
		}
	};
	return {
		start: loadSnapshot,
		stop: () => {},
		refreshType: async () => {
			await loadSnapshot();
		},
		listRecords: <
			TConfig extends UserInstructionConfig = UserInstructionConfig,
		>(
			type: UserInstructionConfigType,
		) => [...snapshot.records[type]] as UserInstructionConfigRecord<TConfig>[],
		listRuntimeCommands: () => [...snapshot.runtimeCommands],
		resolveRuntimeSlashCommand: (input) => {
			if (!input.startsWith("/") || input.length < 2) return input;
			const match = input.match(/^\/(\S+)/);
			const name = match?.[1];
			if (!name) return input;
			const command = snapshot.runtimeCommands.find(
				(item) => item.name === name,
			);
			return command
				? `${command.instructions}${input.slice(name.length + 1)}`
				: input;
		},
		hasConfiguredSkills: (allowedSkillNames) =>
			configuredSkills(snapshot, allowedSkillNames).some(
				(entry) => !entry.disabled,
			),
		createExtension: (options): AgentExtension => ({
			name: "cline-hub-user-instructions",
			manifest: {
				capabilities: [
					options.includeRules ? "rules" : undefined,
					options.registerSkillsTool ? "tools" : undefined,
					options.includeSkills || options.includeWorkflows
						? "commands"
						: undefined,
				].filter((value): value is "rules" | "tools" | "commands" =>
					Boolean(value),
				),
			},
			setup(api) {
				if (options.includeRules) {
					api.registerRule({
						id: "cline-hub-user-instructions:rules",
						source: "hub-user-instructions",
						content: () =>
							formatRulesForSystemPrompt(
								snapshot.records.rule
									.map((record) => record.item)
									.filter((rule) => rule.disabled !== true),
							),
					});
				}
				if (options.registerSkillsTool) {
					api.registerTool(
						createSkillsTool(
							createSnapshotSkillsExecutor(snapshot, options.allowedSkillNames),
						) as AgentTool,
					);
				}
				for (const command of snapshot.runtimeCommands.filter(
					(command) =>
						(command.kind === "skill" && options.includeSkills) ||
						(command.kind === "workflow" && options.includeWorkflows),
				)) {
					api.registerCommand({
						name: command.name,
						description: command.description,
						handler: (input) => {
							const trimmed = input.trim();
							return trimmed
								? `${command.instructions}\n\n${trimmed}`
								: command.instructions;
						},
					});
				}
			},
		}),
	};
}

function createToolExecutorProxy(
	sessionId: string,
	targetClientId: string,
	contributions: HubClientToolExecutorContribution[],
	requestCapability: RequestCapability,
): Partial<ToolExecutors> | undefined {
	const entries = contributions.map((contribution) => [
		contribution.executor,
		async (...argsAndContext: unknown[]) => {
			const context = argsAndContext.at(-1) as AgentToolContext;
			const args = argsAndContext.slice(0, -1);
			const response = await requestCapability(
				sessionId,
				contribution.capabilityName,
				{
					executor: contribution.executor,
					args,
					context: serializeToolContext(context),
				},
				targetClientId,
			);
			return response?.result;
		},
	]);
	return entries.length > 0
		? (Object.fromEntries(entries) as Partial<ToolExecutors>)
		: undefined;
}

function createToolProxies(
	sessionId: string,
	targetClientId: string,
	contributions: HubClientToolContribution[],
	requestCapability: RequestCapability,
): AgentTool[] | undefined {
	if (contributions.length === 0) return undefined;
	return contributions.map((contribution) => ({
		name: contribution.name,
		description: contribution.description,
		inputSchema: contribution.inputSchema,
		lifecycle: contribution.lifecycle as AgentTool["lifecycle"],
		async execute(input, context) {
			const response = await requestCapability(
				sessionId,
				contribution.capabilityName,
				{
					toolName: contribution.name,
					input,
					context: serializeToolContext(context),
				},
				targetClientId,
				context.emitUpdate
					? (payload) => {
							context.emitUpdate?.(asToolUpdate(payload));
						}
					: undefined,
			);
			return response?.result;
		},
	}));
}

function createHookProxies(
	sessionId: string,
	targetClientId: string,
	contributions: HubClientHookContribution[],
	requestCapability: RequestCapability,
): AgentHooks | undefined {
	const available = new Map(contributions.map((item) => [item.name, item]));
	const hooks: Partial<Record<HubAgentHookName, (ctx: unknown) => unknown>> =
		{};
	for (const name of HOOK_NAMES) {
		const contribution = available.get(name);
		if (!contribution) continue;
		hooks[name] = async (ctx: unknown) => {
			const response = await requestCapability(
				sessionId,
				contribution.capabilityName,
				{ context: ctx },
				targetClientId,
			);
			return response?.control as AgentHookControl | undefined;
		};
	}
	return Object.keys(hooks).length > 0 ? (hooks as AgentHooks) : undefined;
}

export function createHubClientContributionRuntime(input: {
	sessionId: string;
	targetClientId: string;
	contributions: readonly HubClientContribution[];
	sessionConfig?: Partial<RuntimeSessionConfig>;
	requestCapability: RequestCapability;
}): {
	localRuntime: LocalRuntimeStartOptions;
	toolExecutors?: Partial<ToolExecutors>;
	hasClientContributions: boolean;
} {
	const toolExecutors = input.contributions.filter(
		(item): item is HubClientToolExecutorContribution =>
			item.kind === "toolExecutor",
	);
	const tools = input.contributions.filter(
		(item): item is HubClientToolContribution => item.kind === "tool",
	);
	const hooks = input.contributions.filter(
		(item): item is HubClientHookContribution => item.kind === "hook",
	);
	const compaction = input.contributions.find(
		(item): item is HubClientCompactionContribution =>
			item.kind === "compaction",
	);
	const checkpoint = input.contributions.find(
		(item): item is HubClientCheckpointContribution =>
			item.kind === "checkpoint",
	);
	const mistakeLimit = input.contributions.find(
		(item): item is HubClientContribution => item.kind === "mistakeLimit",
	);
	const userInstructionService = input.contributions.find(
		(item): item is HubClientContribution =>
			item.kind === "userInstructionService",
	);

	return {
		hasClientContributions: input.contributions.length > 0,
		toolExecutors: createToolExecutorProxy(
			input.sessionId,
			input.targetClientId,
			toolExecutors,
			input.requestCapability,
		),
		localRuntime: {
			...(hooks.length > 0
				? {
						hooks: createHookProxies(
							input.sessionId,
							input.targetClientId,
							hooks,
							input.requestCapability,
						),
					}
				: {}),
			...(tools.length > 0
				? {
						extraTools: createToolProxies(
							input.sessionId,
							input.targetClientId,
							tools,
							input.requestCapability,
						),
					}
				: {}),
			...(compaction
				? {
						compaction: {
							...(input.sessionConfig?.compaction ?? {}),
							...(compaction.config as NonNullable<
								CoreSessionConfig["compaction"]
							>),
							compact: async (context) => {
								const response = await input.requestCapability(
									input.sessionId,
									compaction.capabilityName,
									{ context },
									input.targetClientId,
								);
								return response?.result as Awaited<ReturnType<CompactFunction>>;
							},
						},
					}
				: {}),
			...(checkpoint
				? {
						checkpoint: {
							...(input.sessionConfig?.checkpoint ?? {}),
							...(checkpoint.config as NonNullable<
								CoreSessionConfig["checkpoint"]
							>),
							createCheckpoint: async (context) => {
								const response = await input.requestCapability(
									input.sessionId,
									checkpoint.capabilityName,
									{ context },
									input.targetClientId,
								);
								return response?.result as Awaited<
									ReturnType<CreateCheckpointFunction>
								>;
							},
						},
					}
				: {}),
			...(mistakeLimit
				? {
						onConsecutiveMistakeLimitReached: async (
							context: Parameters<
								NonNullable<
									CoreSessionConfig["onConsecutiveMistakeLimitReached"]
								>
							>[0],
						): Promise<ConsecutiveMistakeLimitDecision> => {
							const response = await input.requestCapability(
								input.sessionId,
								mistakeLimit.capabilityName,
								{ context },
								input.targetClientId,
							);
							return response?.result as ConsecutiveMistakeLimitDecision;
						},
					}
				: {}),
			...(userInstructionService
				? {
						userInstructionService: createUserInstructionServiceProxy(
							input.sessionId,
							input.targetClientId,
							userInstructionService,
							input.requestCapability,
						),
					}
				: {}),
		},
	};
}

export function defaultClientContributionCapabilityName(
	contribution: Pick<HubClientContribution, "kind"> & Record<string, unknown>,
): string | undefined {
	switch (contribution.kind) {
		case "toolExecutor":
			return typeof contribution.executor === "string"
				? `${HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX}${contribution.executor}`
				: undefined;
		case "tool":
			return typeof contribution.name === "string"
				? `${HUB_CUSTOM_TOOL_CAPABILITY_PREFIX}${contribution.name}`
				: undefined;
		case "hook":
			return typeof contribution.name === "string"
				? `${HUB_HOOK_CAPABILITY_PREFIX}${contribution.name}`
				: undefined;
		case "compaction":
			return HUB_COMPACTION_CAPABILITY;
		case "checkpoint":
			return HUB_CHECKPOINT_CAPABILITY;
		case "mistakeLimit":
			return HUB_MISTAKE_LIMIT_CAPABILITY;
		case "userInstructionService":
			return HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY;
		default:
			return undefined;
	}
}
