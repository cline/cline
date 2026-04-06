import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import { createDefaultCliSessionManager, listSessions } from "./session";
import {
	inferProviderAndModelFromMessages,
	inferTitleFromMessages,
	summarizeCostFromMessages,
} from "./session-message-summary";

export type HistoryListRow = {
	sessionId: string;
	provider?: string;
	model?: string;
	startedAt: string;
	prompt?: string;
	metadata?: {
		title?: string;
		totalCost?: number;
		checkpoint?: {
			latest?: {
				ref?: string;
				createdAt?: number;
				runCount?: number;
			};
			history?: Array<{
				ref?: string;
				createdAt?: number;
				runCount?: number;
			}>;
		};
	};
};

type HistoryListRowInput = {
	session_id?: string;
	sessionId?: string;
	provider?: string;
	model?: string;
	started_at?: string;
	startedAt?: string;
	prompt?: string;
	metadata?: {
		title?: string;
		totalCost?: number;
		checkpoint?: {
			latest?: {
				ref?: string;
				createdAt?: number;
				runCount?: number;
			};
			history?: Array<{
				ref?: string;
				createdAt?: number;
				runCount?: number;
			}>;
		};
	};
};

type SessionManifestRecord = {
	session_id?: string;
	sessionId?: string;
	provider?: string;
	model?: string;
	started_at?: string;
	startedAt?: string;
	prompt?: string;
	metadata?: {
		title?: string;
		totalCost?: number;
		checkpoint?: {
			latest?: {
				ref?: string;
				createdAt?: number;
				runCount?: number;
			};
			history?: Array<{
				ref?: string;
				createdAt?: number;
				runCount?: number;
			}>;
		};
	};
};

function toHistoryListRow(
	input: HistoryListRowInput,
): HistoryListRow | undefined {
	const sessionId = input.sessionId?.trim() || input.session_id?.trim() || "";
	const startedAt = input.startedAt?.trim() || input.started_at?.trim() || "";
	if (!sessionId || !startedAt) {
		return undefined;
	}
	return {
		sessionId,
		provider: input.provider?.trim() || undefined,
		model: input.model?.trim() || undefined,
		startedAt,
		prompt: input.prompt,
		metadata: input.metadata,
	};
}

async function listManifestHistoryRows(
	limit: number,
): Promise<HistoryListRow[]> {
	const sessionsDir = resolveSessionDataDir();
	const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(
		() => [],
	);
	const rows = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const sessionId = entry.name.trim();
				if (!sessionId) {
					return undefined;
				}
				const manifestPath = join(sessionsDir, sessionId, `${sessionId}.json`);
				const raw = await readFile(manifestPath, "utf8").catch(() => undefined);
				if (!raw) {
					return undefined;
				}
				let parsed: SessionManifestRecord;
				try {
					parsed = JSON.parse(raw) as SessionManifestRecord;
				} catch {
					return undefined;
				}
				return toHistoryListRow(parsed);
			}),
	);

	return rows
		.filter((row): row is HistoryListRow => Boolean(row))
		.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
		.slice(0, Math.max(1, limit));
}

export async function hydrateHistoryRows(
	rows: HistoryListRow[],
): Promise<HistoryListRow[]> {
	if (rows.length === 0) {
		return rows;
	}
	const sessionManager = await createDefaultCliSessionManager();
	try {
		return await Promise.all(
			rows.map(async (row) => {
				const hasTitle = Boolean(
					row.metadata?.title?.trim() || row.prompt?.trim(),
				);
				const hasProvider = Boolean(row.provider?.trim());
				const hasModel = Boolean(row.model?.trim());
				const knownCost = row.metadata?.totalCost;
				const hasCost =
					typeof knownCost === "number" &&
					Number.isFinite(knownCost) &&
					knownCost > 0;
				if (hasTitle && hasProvider && hasModel && hasCost) {
					return row;
				}
				const messages = await sessionManager.readMessages(row.sessionId);
				if (messages.length === 0) {
					return row;
				}
				const inferredTitle = hasTitle
					? undefined
					: inferTitleFromMessages(messages);
				const inferredUsageCost = summarizeCostFromMessages(messages);
				const inferredProviderModel =
					inferProviderAndModelFromMessages(messages);
				return {
					...row,
					prompt: row.prompt?.trim() || inferredTitle || row.prompt,
					provider: row.provider?.trim() || inferredProviderModel.provider,
					model: row.model?.trim() || inferredProviderModel.model,
					metadata: {
						...(row.metadata ?? {}),
						title: row.metadata?.title?.trim() || inferredTitle,
						totalCost:
							hasCost || inferredUsageCost <= 0
								? row.metadata?.totalCost
								: inferredUsageCost,
					},
				};
			}),
		);
	} finally {
		await sessionManager.dispose().catch(() => {});
	}
}

export async function listHistoryRows(limit = 200): Promise<HistoryListRow[]> {
	const requestedLimit = Math.max(1, Math.floor(limit));
	const backendRowsRaw = (await listSessions(requestedLimit)) as
		| HistoryListRowInput[]
		| undefined;
	const backendRows = (backendRowsRaw ?? [])
		.map((row) => toHistoryListRow(row))
		.filter((row): row is HistoryListRow => Boolean(row));
	const manifestRows = await listManifestHistoryRows(
		Math.min(requestedLimit * 5, 2000),
	);
	const merged = new Map<string, HistoryListRow>();
	for (const row of [...backendRows, ...manifestRows]) {
		if (merged.has(row.sessionId)) {
			continue;
		}
		merged.set(row.sessionId, row);
	}
	if (merged.size === 0) {
		return [];
	}
	const sorted = Array.from(merged.values())
		.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
		.slice(0, requestedLimit);
	return await hydrateHistoryRows(sorted);
}
