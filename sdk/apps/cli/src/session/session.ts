import type {
	AgentConfig,
	BasicLogger,
	RuntimeCapabilities,
	RuntimeHostMode,
	SessionHistoryRecord,
	SessionRecord,
} from "@clinebot/core";
import {
	ClineCore,
	listSessionHistoryFromBackend,
	resolveSessionBackend,
} from "@clinebot/core";
import { resolveWorkspaceRoot } from "../utils/helpers";
import { getCliTelemetryService } from "../utils/telemetry";
import type { ConversationHistory } from "./export";

function toSessionRecordLike(
	row: SessionRecord | undefined,
): unknown | undefined {
	return row;
}

export async function createCliCore(options?: {
	capabilities?: RuntimeCapabilities;
	toolPolicies?: AgentConfig["toolPolicies"];
	logger?: BasicLogger;
	backendMode?: RuntimeHostMode;
	forceLocalBackend?: boolean;
	cwd?: string;
	workspaceRoot?: string;
}): Promise<ClineCore> {
	const explicitBackendMode = options?.forceLocalBackend
		? "local"
		: options?.backendMode;
	const cwd = options?.cwd?.trim() || process.cwd();
	const workspaceRoot =
		options?.workspaceRoot?.trim() || resolveWorkspaceRoot(cwd);
	const core = await ClineCore.create({
		...(explicitBackendMode ? { backendMode: explicitBackendMode } : {}),
		...(options?.forceLocalBackend !== true
			? {
					hub: {
						cwd,
						workspaceRoot,
						clientType: "cli",
						displayName: "Cline CLI",
					},
				}
			: {}),
		capabilities: options?.capabilities,
		telemetry: getCliTelemetryService(options?.logger),
		logger: options?.logger,
		toolPolicies: options?.toolPolicies,
	});
	options?.logger?.log("CLI core runtime routing selected", {
		backendMode: explicitBackendMode ?? "env-managed",
		rpcAddress: core.runtimeAddress,
		forceLocalBackend: options?.forceLocalBackend === true,
	});
	return core;
}

async function withCliCore<T>(
	run: (core: ClineCore) => Promise<T>,
	options?: {
		forceLocalBackend?: boolean;
		logger?: BasicLogger;
		cwd?: string;
		workspaceRoot?: string;
	},
): Promise<T> {
	const core = await createCliCore({
		forceLocalBackend: options?.forceLocalBackend,
		logger: options?.logger,
		cwd: options?.cwd,
		workspaceRoot: options?.workspaceRoot,
	});
	try {
		return await run(core);
	} finally {
		await core.dispose("cli_session_helper_dispose");
	}
}

export async function listSessions(
	limit = 50,
	options?: { workspaceRoot?: string; hydrate?: boolean },
): Promise<SessionHistoryRecord[]> {
	const backend = await resolveSessionBackend({
		telemetry: getCliTelemetryService(),
	});
	return await listSessionHistoryFromBackend(backend, {
		limit,
		includeManifestFallback: true,
		hydrate: options?.hydrate ?? false,
	});
}

export async function deleteSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	return await withCliCore(
		async (core) => ({
			deleted: await core.delete(sessionId),
		}),
		{ forceLocalBackend: true },
	);
}

export async function updateSession(
	sessionId: string,
	updates: {
		prompt?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	},
): Promise<{ updated: boolean }> {
	return await withCliCore(
		async (core) => await core.update(sessionId, updates),
		{ forceLocalBackend: true },
	);
}

export async function getSessionRow(
	sessionId: string,
): Promise<SessionRecord | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	return await withCliCore(
		async (core) => (await core.get(target)) ?? undefined,
		{ forceLocalBackend: true },
	);
}

export async function getLatestSessionRow(): Promise<unknown | undefined> {
	return await withCliCore(
		async (core) => {
			const rows = await core.list(1, { hydrate: false });
			return toSessionRecordLike(rows[0]);
		},
		{ forceLocalBackend: true },
	);
}

export async function handleSessionHookEvent(
	payload: Parameters<ClineCore["ingestHookEvent"]>[0],
): Promise<void> {
	await withCliCore(
		async (core) => {
			await core.ingestHookEvent(payload);
		},
		{ forceLocalBackend: true },
	);
}

export async function readSessionMessagesArtifact(
	sessionId: string,
): Promise<ConversationHistory | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	return await withCliCore(
		async (core) => {
			const [row, messages] = await Promise.all([
				core.get(target),
				core.readMessages(target),
			]);
			if (!row || messages.length === 0) {
				return undefined;
			}
			return {
				version: 1,
				updated_at: row.updatedAt,
				messages: messages as ConversationHistory["messages"],
				sessionId: row.sessionId,
				systemPrompt:
					typeof row.metadata?.systemPrompt === "string"
						? row.metadata.systemPrompt
						: undefined,
			};
		},
		{ forceLocalBackend: true },
	);
}
