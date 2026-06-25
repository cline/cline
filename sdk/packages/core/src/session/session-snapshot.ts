import type * as LlmsProviders from "@cline/llms";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";
import type { SessionRecord } from "../types/sessions";

export interface CoreSessionCheckpointSnapshot {
	enabled?: boolean;
	latest?: CheckpointEntry;
	history: CheckpointEntry[];
}

export interface CoreSessionSnapshot {
	version: 1;
	sessionId: string;
	source: SessionRecord["source"];
	status: SessionRecord["status"];
	createdAt: string;
	updatedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	interactive: boolean;
	workspace: {
		cwd: string;
		root: string;
	};
	model: {
		providerId: string;
		modelId: string;
	};
	capabilities: {
		enableTools: boolean;
		enableSpawn: boolean;
		enableTeams: boolean;
	};
	lineage: {
		parentSessionId?: string;
		parentAgentId?: string;
		agentId?: string;
		conversationId?: string;
		isSubagent: boolean;
	};
	team?: {
		name: string;
	};
	prompt?: string;
	metadata?: Record<string, unknown>;
	artifacts?: {
		messagesPath?: string;
	};
	messages?: LlmsProviders.Message[];
	usage?: SessionAccumulatedUsage;
	aggregateUsage?: SessionAccumulatedUsage;
	checkpoint?: CoreSessionCheckpointSnapshot;
}

function cloneJsonObject<T extends Record<string, unknown>>(
	value: T | undefined,
): T | undefined {
	return value ? (JSON.parse(JSON.stringify(value)) as T) : undefined;
}

function cloneMessages(
	messages: LlmsProviders.Message[] | undefined,
): LlmsProviders.Message[] | undefined {
	return messages
		? (JSON.parse(JSON.stringify(messages)) as LlmsProviders.Message[])
		: undefined;
}

function readCheckpointSnapshot(
	metadata: Record<string, unknown> | undefined,
): CoreSessionCheckpointSnapshot | undefined {
	const checkpoint =
		metadata?.checkpoint &&
		typeof metadata.checkpoint === "object" &&
		!Array.isArray(metadata.checkpoint)
			? (metadata.checkpoint as Record<string, unknown>)
			: undefined;
	const rawHistory = Array.isArray(checkpoint?.history)
		? checkpoint.history
		: [];
	const history = rawHistory
		.filter(
			(entry): entry is Record<string, unknown> =>
				!!entry && typeof entry === "object" && !Array.isArray(entry),
		)
		.flatMap((entry): CheckpointEntry[] => {
			const ref = typeof entry.ref === "string" ? entry.ref.trim() : "";
			const createdAt = Number(entry.createdAt);
			const runCount = Number(entry.runCount);
			if (!ref || !Number.isFinite(createdAt) || !Number.isInteger(runCount)) {
				return [];
			}
			return [
				{
					ref,
					createdAt,
					runCount,
					...(entry.kind === "stash" || entry.kind === "commit"
						? { kind: entry.kind }
						: {}),
				},
			];
		});
	const latest = history.at(-1);
	const enabled = metadata?.checkpointEnabled === true ? true : undefined;
	if (!enabled && history.length === 0) {
		return undefined;
	}
	return {
		...(enabled ? { enabled } : {}),
		...(latest ? { latest } : {}),
		history,
	};
}

export function createCoreSessionSnapshot(input: {
	session: SessionRecord;
	messages?: LlmsProviders.Message[];
	usage?: SessionAccumulatedUsage;
	aggregateUsage?: SessionAccumulatedUsage;
}): CoreSessionSnapshot {
	const { session } = input;
	const metadata = cloneJsonObject(session.metadata);
	return {
		version: 1,
		sessionId: session.sessionId,
		source: session.source,
		status: session.status,
		createdAt: session.startedAt,
		updatedAt: session.updatedAt,
		endedAt: session.endedAt ?? null,
		exitCode: session.exitCode ?? null,
		interactive: session.interactive,
		workspace: {
			cwd: session.cwd,
			root: session.workspaceRoot,
		},
		model: {
			providerId: session.provider,
			modelId: session.model,
		},
		capabilities: {
			enableTools: session.enableTools,
			enableSpawn: session.enableSpawn,
			enableTeams: session.enableTeams,
		},
		lineage: {
			...(session.parentSessionId
				? { parentSessionId: session.parentSessionId }
				: {}),
			...(session.parentAgentId
				? { parentAgentId: session.parentAgentId }
				: {}),
			...(session.agentId ? { agentId: session.agentId } : {}),
			...(session.conversationId
				? { conversationId: session.conversationId }
				: {}),
			isSubagent: session.isSubagent,
		},
		...(session.teamName ? { team: { name: session.teamName } } : {}),
		...(session.prompt ? { prompt: session.prompt } : {}),
		...(metadata ? { metadata } : {}),
		...(session.messagesPath
			? { artifacts: { messagesPath: session.messagesPath } }
			: {}),
		...(input.messages ? { messages: cloneMessages(input.messages) } : {}),
		...(input.usage ? { usage: { ...input.usage } } : {}),
		...(input.aggregateUsage
			? { aggregateUsage: { ...input.aggregateUsage } }
			: {}),
		...(() => {
			const checkpoint = readCheckpointSnapshot(metadata);
			return checkpoint ? { checkpoint } : {};
		})(),
	};
}

export function coreSessionSnapshotToRecord(
	snapshot: CoreSessionSnapshot,
): SessionRecord {
	return {
		sessionId: snapshot.sessionId,
		parentSessionId: snapshot.lineage.parentSessionId,
		agentId: snapshot.lineage.agentId,
		parentAgentId: snapshot.lineage.parentAgentId,
		conversationId: snapshot.lineage.conversationId,
		isSubagent: snapshot.lineage.isSubagent,
		source: snapshot.source,
		startedAt: snapshot.createdAt,
		endedAt: snapshot.endedAt ?? undefined,
		exitCode: snapshot.exitCode ?? undefined,
		status: snapshot.status,
		interactive: snapshot.interactive,
		provider: snapshot.model.providerId,
		model: snapshot.model.modelId,
		cwd: snapshot.workspace.cwd,
		workspaceRoot: snapshot.workspace.root,
		teamName: snapshot.team?.name,
		enableTools: snapshot.capabilities.enableTools,
		enableSpawn: snapshot.capabilities.enableSpawn,
		enableTeams: snapshot.capabilities.enableTeams,
		prompt: snapshot.prompt,
		metadata: snapshot.metadata,
		updatedAt: snapshot.updatedAt,
		messagesPath: snapshot.artifacts?.messagesPath,
	};
}
