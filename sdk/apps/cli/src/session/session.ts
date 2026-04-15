import type {
	AgentConfig,
	BasicLogger,
	HookEventPayload,
	SessionRecord,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/core";
import { ClineCore } from "@clinebot/core";
import { getCliTelemetryService } from "../utils/telemetry";

function toSessionRecordLike(
	row: SessionRecord | undefined,
): unknown | undefined {
	return row;
}

export async function createCliCore(options?: {
	defaultToolExecutors?: Partial<import("@clinebot/core").ToolExecutors>;
	toolPolicies?: AgentConfig["toolPolicies"];
	logger?: BasicLogger;
	forceLocalBackend?: boolean;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}): Promise<ClineCore> {
	const explicitBackendMode = options?.forceLocalBackend ? "local" : undefined;
	const core = await ClineCore.create({
		...(explicitBackendMode ? { backendMode: explicitBackendMode } : {}),
		defaultToolExecutors: options?.defaultToolExecutors,
		telemetry: getCliTelemetryService(options?.logger),
		logger: options?.logger,
		toolPolicies: options?.toolPolicies,
		requestToolApproval: options?.requestToolApproval,
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
	options?: { forceLocalBackend?: boolean; logger?: BasicLogger },
): Promise<T> {
	const core = await createCliCore({
		forceLocalBackend: options?.forceLocalBackend,
		logger: options?.logger,
	});
	try {
		return await run(core);
	} finally {
		await core.dispose("cli_session_helper_dispose");
	}
}

export async function listSessions(limit = 200): Promise<unknown[]> {
	return await withCliCore(async (core) => await core.list(limit));
}

export async function deleteSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	return await withCliCore(async (core) => ({
		deleted: await core.delete(sessionId),
	}));
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
	);
}

export async function getSessionRow(
	sessionId: string,
): Promise<unknown | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	return await withCliCore(async (core) =>
		toSessionRecordLike(await core.get(target)),
	);
}

export async function getLatestSessionRow(): Promise<unknown | undefined> {
	return await withCliCore(async (core) => {
		const rows = await core.list(1);
		return toSessionRecordLike(rows[0]);
	});
}

export async function handleSessionHookEvent(
	payload: HookEventPayload,
): Promise<void> {
	await withCliCore(async (core) => {
		await core.handleHookEvent(payload);
	});
}
