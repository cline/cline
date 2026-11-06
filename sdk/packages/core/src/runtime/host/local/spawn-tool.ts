import {
	type AgentEvent,
	type AgentTool,
	createTool,
	type DelegationTarget,
	zodToJsonSchema,
} from "@cline/shared";
import { z } from "zod";
import {
	createBuiltinTools,
	resolveToolPresetName,
	type ToolExecutors,
	ToolPresets,
} from "../../../extensions/tools";
import type {
	SubAgentEndContext,
	SubAgentStartContext,
} from "../../../extensions/tools/team";
import {
	createDelegatedAgentConfigProvider,
	createSpawnAgentTool,
	type DelegatedAgentConfigProvider,
} from "../../../extensions/tools/team";
import { resolveDelegatedAgentConfig } from "../../../extensions/tools/team/delegated-agent";
import { buildTelemetryAgentIdentity } from "../../../services/agent-events";
import { filterDisabledTools } from "../../../services/global-settings";
import type { listDelegationTargets } from "../../../services/providers/local-provider-service";
import {
	captureAgentCreated,
	captureSubagentExecution,
} from "../../../services/telemetry/core-events";
import type { CoreSessionConfig } from "../../../types/config";
import type { ActiveSession } from "../../../types/session";

export type SubAgentStartTracker = Map<
	string,
	{ startedAt: number; rootSessionId: string }
>;

export interface SpawnToolDeps {
	listDelegationTargets?: (
		options: Parameters<typeof listDelegationTargets>[1],
	) => ReturnType<typeof listDelegationTargets>;
	getSession(sessionId: string): ActiveSession | undefined;
	subAgentStarts: SubAgentStartTracker;
	onAgentEvent(
		rootSessionId: string,
		config: CoreSessionConfig,
		event: AgentEvent,
	): void;
	invokeBackendOptional(method: string, ...args: unknown[]): Promise<void>;
}

export function createDelegationTargetsTool(
	list: NonNullable<SpawnToolDeps["listDelegationTargets"]>,
	current: () => DelegationTarget,
): AgentTool {
	const schema = z.object({
		query: z.string().max(200).optional(),
		offset: z.number().int().min(0).optional(),
	});
	return createTool({
		name: "list_delegation_targets",
		description:
			"Search configured provider/model targets for spawn_agent or team_spawn_teammate. Results contain no credentials. Prefer subscription billing for model-only requests; ask before usage-billed or unknown-billing API fallback, unless the provider was explicitly requested. Configured does not prove a live login. Use nextOffset to retrieve more matches.",
		inputSchema: zodToJsonSchema(schema),
		execute: async (input: unknown) =>
			list({ ...schema.parse(input), current: current() }),
	});
}

export interface SessionSubAgentLifecycleCallbacks {
	onSubAgentEvent: (event: AgentEvent, target?: DelegationTarget) => void;
	onSubAgentStart: (context: SubAgentStartContext) => void;
	onSubAgentEnd: (context: SubAgentEndContext) => void;
}

export function createSessionSubAgentLifecycleCallbacks(
	deps: SpawnToolDeps,
	config: CoreSessionConfig,
	rootSessionId: string,
): SessionSubAgentLifecycleCallbacks {
	return {
		onSubAgentEvent: (event, target) =>
			deps.onAgentEvent(rootSessionId, { ...config, ...target }, event),
		onSubAgentStart: (context) => {
			const teamRuntime = deps.getSession(rootSessionId)?.runtime.teamRuntime;
			deps.subAgentStarts.set(context.subAgentId, {
				startedAt: Date.now(),
				rootSessionId,
			});
			const agentIdentity = buildTelemetryAgentIdentity({
				agentId: context.subAgentId,
				conversationId: context.conversationId,
				parentAgentId: context.parentAgentId,
				teamId: teamRuntime?.getTeamId(),
				teamName: teamRuntime?.getTeamName(),
				createdByAgentId: context.parentAgentId,
			});
			if (agentIdentity) {
				captureAgentCreated(config.telemetry, {
					ulid: rootSessionId,
					modelId: context.target?.modelId ?? config.modelId,
					provider: context.target?.providerId ?? config.providerId,
					...agentIdentity,
				});
			}
			captureSubagentExecution(config.telemetry, {
				event: "started",
				ulid: rootSessionId,
				durationMs: 0,
				parentId: context.parentAgentId,
				agentId: context.subAgentId,
				...agentIdentity,
			});
			void deps.invokeBackendOptional(
				"handleSubAgentStart",
				rootSessionId,
				context,
			);
		},
		onSubAgentEnd: (context) => {
			const teamRuntime = deps.getSession(rootSessionId)?.runtime.teamRuntime;
			const started = deps.subAgentStarts.get(context.subAgentId);
			const durationMs = started ? Date.now() - started.startedAt : 0;
			const outputLines = context.result?.text
				? context.result.text.split("\n").length
				: 0;
			captureSubagentExecution(config.telemetry, {
				event: "ended",
				ulid: rootSessionId,
				durationMs,
				outputLines,
				errorMessage: context.error ? String(context.error) : undefined,
				agentId: context.subAgentId,
				parentId: context.parentAgentId,
				...buildTelemetryAgentIdentity({
					agentId: context.subAgentId,
					conversationId: context.conversationId,
					parentAgentId: context.parentAgentId,
					teamId: teamRuntime?.getTeamId(),
					teamName: teamRuntime?.getTeamName(),
					createdByAgentId: context.parentAgentId,
				}),
			});
			deps.subAgentStarts.delete(context.subAgentId);
			void deps.invokeBackendOptional(
				"handleSubAgentEnd",
				rootSessionId,
				context,
			);
		},
	};
}

export function createSessionSpawnTool(
	deps: SpawnToolDeps,
	config: CoreSessionConfig,
	rootSessionId: string,
	toolExecutors?: Partial<ToolExecutors>,
	parent?: DelegatedAgentConfigProvider,
): AgentTool {
	const lifecycle = createSessionSubAgentLifecycleCallbacks(
		deps,
		config,
		rootSessionId,
	);
	const fallback = createDelegatedAgentConfigProvider(config);
	const getParent = () =>
		parent ??
		deps.getSession(rootSessionId)?.runtime.delegatedAgentConfigProvider ??
		fallback;
	const createSubAgentTools = (
		_input: unknown,
		_context: unknown,
		child: DelegatedAgentConfigProvider,
	) => {
		const tools: AgentTool[] = config.enableTools
			? createBuiltinTools({
					cwd: config.cwd,
					telemetry: config.telemetry,
					...ToolPresets[resolveToolPresetName({ mode: config.mode })],
					executors: toolExecutors,
				})
			: [];
		if (config.enableSpawnAgent) {
			tools.push(
				createSessionSpawnTool(
					deps,
					config,
					rootSessionId,
					toolExecutors,
					child,
				),
			);
		}
		if (deps.listDelegationTargets)
			tools.push(
				createDelegationTargetsTool(deps.listDelegationTargets, () =>
					child.getRuntimeConfig(),
				),
			);
		return filterDisabledTools(tools);
	};

	return createSpawnAgentTool({
		configProvider: {
			getRuntimeConfig: () => getParent().getRuntimeConfig(),
			getConnectionConfig: () => getParent().getConnectionConfig(),
			updateConnectionDefaults: (updates) =>
				getParent().updateConnectionDefaults(updates),
			resolveTarget: (target, current, signal) => {
				const resolve = getParent().resolveTarget;
				return resolve
					? resolve(target, current, signal)
					: resolveDelegatedAgentConfig(getParent(), target, signal);
			},
		},
		createSubAgentTools,
		...lifecycle,
	}) as AgentTool;
}
