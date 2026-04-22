import type {
	AgentConfig,
	BasicLogger,
	HookEventPayload,
	SessionHistoryRecord,
	SessionRecord,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/core";
import { ClineCore } from "@clinebot/core";
import { resolveWorkspaceRoot } from "../utils/helpers";
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
	cwd?: string;
	workspaceRoot?: string;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}): Promise<ClineCore> {
	const explicitBackendMode = options?.forceLocalBackend
		? "local"
		: process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase() ===
					"local" || process.env.CLINE_VCR?.trim()
			? undefined
			: "hub";
	const cwd = options?.cwd?.trim() || process.cwd();
	const workspaceRoot =
		options?.workspaceRoot?.trim() || resolveWorkspaceRoot(cwd);
	const core = await ClineCore.create({
		...(explicitBackendMode ? { backendMode: explicitBackendMode } : {}),
		...(explicitBackendMode === "hub"
			? {
					hub: {
						cwd,
						workspaceRoot,
						clientType: "cli",
						displayName: "Cline CLI",
					},
				}
			: {}),
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
	limit = 200,
	options?: { workspaceRoot?: string },
): Promise<SessionHistoryRecord[]> {
	const rows = await withCliCore(async (core) => await core.list(limit), {
		forceLocalBackend: true,
		cwd: options?.workspaceRoot,
		workspaceRoot: options?.workspaceRoot,
	});
	if (!options?.workspaceRoot) {
		return rows;
	}
	return rows.filter((row) => row.workspaceRoot === options.workspaceRoot);
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
): Promise<unknown | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	return await withCliCore(
		async (core) => toSessionRecordLike(await core.get(target)),
		{ forceLocalBackend: true },
	);
}

export async function getLatestSessionRow(): Promise<unknown | undefined> {
	return await withCliCore(
		async (core) => {
			const rows = await core.list(1);
			return toSessionRecordLike(rows[0]);
		},
		{ forceLocalBackend: true },
	);
}

export async function handleSessionHookEvent(
	payload: HookEventPayload,
): Promise<void> {
	await withCliCore(
		async (core) => {
			await core.handleHookEvent(payload);
		},
		{ forceLocalBackend: true },
	);
}
