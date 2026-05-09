import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import { formatDisplayUserInput, normalizeUserInput } from "@clinebot/shared";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import { toSessionRecord } from "../../services/session-data";
import type { SessionManifest } from "../../session/models/session-manifest";
import { SessionManifestSchema } from "../../session/models/session-manifest";
import type { SessionRow } from "../../session/models/session-row";
import type {
	SessionHistoryMetadata,
	SessionHistoryRecord,
	SessionRecord,
} from "../../types/sessions";
import type { SessionBackend } from "./host";
import type { RuntimeHost } from "./runtime-host";
import { readPersistedMessagesFile } from "./runtime-host-support";

export interface SessionHistoryListOptions {
	limit?: number;
	includeManifestFallback?: boolean;
	hydrate?: boolean;
}

type StoredSessionMessage = LlmsProviders.Message & {
	metrics?: {
		cost?: number;
	};
	modelInfo?: {
		id?: string;
		provider?: string;
	};
};

type TextBlock = {
	type?: string;
	text?: string;
};

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asKnownString(value: unknown): string | undefined {
	const trimmed = asTrimmedString(value);
	if (!trimmed) {
		return undefined;
	}
	return trimmed.toLowerCase() === "unknown" ? undefined : trimmed;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asHistoryMetadata(value: unknown): SessionHistoryMetadata | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return { ...(value as Record<string, unknown>) };
}

function normalizeHistoryLimit(limit: number | undefined): number {
	const value = limit ?? 200;
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 200;
}

function extractSessionRecencyToken(sessionId: string): number {
	const matches = sessionId.match(/\d{13,}/g);
	if (!matches || matches.length === 0) {
		return 0;
	}
	let best = 0;
	for (const match of matches) {
		const value = Number.parseInt(match, 10);
		if (Number.isFinite(value) && value > best) {
			best = value;
		}
	}
	return best;
}

export function manifestToSessionRecord(
	manifest: SessionManifest,
): SessionRecord {
	return {
		sessionId: manifest.session_id,
		source: manifest.source,
		pid: manifest.pid,
		startedAt: manifest.started_at,
		endedAt: manifest.ended_at ?? null,
		exitCode: manifest.exit_code ?? null,
		status: manifest.status,
		interactive: manifest.interactive,
		provider: manifest.provider,
		model: manifest.model,
		cwd: manifest.cwd,
		workspaceRoot: manifest.workspace_root,
		teamName: manifest.team_name,
		enableTools: manifest.enable_tools,
		enableSpawn: manifest.enable_spawn,
		enableTeams: manifest.enable_teams,
		isSubagent: false,
		prompt: manifest.prompt,
		metadata: manifest.metadata,
		messagesPath: manifest.messages_path,
		updatedAt: manifest.ended_at ?? manifest.started_at,
	};
}

async function listManifestHistoryRows(
	limit: number,
): Promise<SessionRecord[]> {
	const requestedLimit = normalizeHistoryLimit(limit);
	if (requestedLimit === 0) {
		return [];
	}
	const sessionsDir = resolveSessionDataDir();
	const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(
		() => [],
	);
	const candidateEntries = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			entry,
			recency: extractSessionRecencyToken(entry.name.trim()),
		}))
		.sort(
			(left, right) =>
				right.recency - left.recency ||
				right.entry.name.localeCompare(left.entry.name),
		);
	const rows = await Promise.all(
		candidateEntries.map(async ({ entry }) => {
			const sessionId = entry.name.trim();
			if (!sessionId) {
				return undefined;
			}
			const manifestPath = join(sessionsDir, sessionId, `${sessionId}.json`);
			const raw = await readFile(manifestPath, "utf8").catch(() => undefined);
			if (!raw) {
				return undefined;
			}
			let parsedJson: unknown;
			try {
				parsedJson = JSON.parse(raw) as unknown;
			} catch {
				return undefined;
			}
			const parsedManifest = SessionManifestSchema.safeParse(parsedJson);
			if (!parsedManifest.success) {
				return undefined;
			}
			return manifestToSessionRecord(parsedManifest.data);
		}),
	);

	return rows
		.filter((row): row is SessionRecord => Boolean(row))
		.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
		.slice(0, requestedLimit);
}

async function listHostSessionRows(
	host: Pick<RuntimeHost, "listSessions" | "readSessionMessages">,
	limit: number,
): Promise<SessionRecord[]> {
	const requestedLimit = normalizeHistoryLimit(limit);
	if (requestedLimit === 0) {
		await host.listSessions(0);
		return [];
	}
	return (await host.listSessions(requestedLimit)).slice(0, requestedLimit);
}

function extractTextFromContent(
	content: LlmsProviders.Message["content"],
): string {
	if (typeof content === "string") {
		return content.trim();
	}
	const segments: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}
		const maybeText = block as TextBlock;
		if (maybeText.type !== "text") {
			continue;
		}
		const text = maybeText.text?.trim();
		if (text) {
			segments.push(text);
		}
	}
	return segments.join("\n").trim();
}

function toSingleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function inferTitleFromMessages(
	messages: LlmsProviders.Message[],
): string | undefined {
	for (const role of ["user", "assistant"] as const) {
		for (const raw of messages) {
			if (raw.role !== role) {
				continue;
			}
			const text = toSingleLine(extractTextFromContent(raw.content));
			if (!text) {
				continue;
			}
			const formatted =
				role === "user" ? toSingleLine(formatDisplayUserInput(text)) : text;
			const normalized = normalizeUserInput(
				formatted.split("\n")[0] ?? formatted,
			);
			return truncateText(normalized, 50);
		}
	}
	return undefined;
}

function summarizeCostFromMessages(messages: LlmsProviders.Message[]): number {
	let total = 0;
	for (const message of messages as StoredSessionMessage[]) {
		total += asFiniteNumber(message.metrics?.cost) ?? 0;
	}
	return total;
}

function inferProviderAndModelFromMessages(messages: LlmsProviders.Message[]): {
	provider?: string;
	model?: string;
} {
	let provider: string | undefined;
	let model: string | undefined;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as StoredSessionMessage;
		if (!provider) {
			provider = asKnownString(message.modelInfo?.provider);
		}
		if (!model) {
			model = asKnownString(message.modelInfo?.id);
		}
		if (provider && model) {
			break;
		}
	}
	return { provider, model };
}

function getMetadataProvider(
	metadata?: SessionHistoryMetadata,
): string | undefined {
	return (
		asKnownString(metadata?.provider) ??
		asKnownString(
			metadata?.provider &&
				typeof metadata.provider === "object" &&
				!Array.isArray(metadata.provider)
				? (metadata.provider as Record<string, unknown>).id
				: undefined,
		)
	);
}

function getMetadataModel(
	metadata?: SessionHistoryMetadata,
): string | undefined {
	return (
		asKnownString(metadata?.model) ??
		asKnownString(
			metadata?.model &&
				typeof metadata.model === "object" &&
				!Array.isArray(metadata.model)
				? (metadata.model as Record<string, unknown>).id
				: undefined,
		)
	);
}

function normalizeHistoryRow(
	row: SessionRecord,
	overrides?: {
		title?: string;
		provider?: string;
		model?: string;
		totalCost?: number;
	},
): SessionHistoryRecord {
	const metadata = asHistoryMetadata(row.metadata);
	const title =
		asTrimmedString(overrides?.title) ?? asTrimmedString(metadata?.title);
	const totalCost =
		asFiniteNumber(overrides?.totalCost) ?? asFiniteNumber(metadata?.totalCost);
	const nextMetadata =
		metadata || title !== undefined || totalCost !== undefined
			? {
					...(metadata ?? {}),
					...(title !== undefined ? { title } : {}),
					...(totalCost !== undefined ? { totalCost } : {}),
				}
			: undefined;
	return {
		...row,
		provider:
			asKnownString(overrides?.provider) ??
			asKnownString(row.provider) ??
			getMetadataProvider(metadata) ??
			"",
		model:
			asKnownString(overrides?.model) ??
			asKnownString(row.model) ??
			getMetadataModel(metadata) ??
			"",
		metadata: nextMetadata,
	};
}

export async function hydrateSessionHistory(
	host: Pick<RuntimeHost, "readSessionMessages">,
	rows: SessionRecord[],
): Promise<SessionHistoryRecord[]> {
	return await Promise.all(
		rows.map(async (row) => {
			const initial = normalizeHistoryRow(row);
			const hasTitle = Boolean(asTrimmedString(initial.metadata?.title));
			const hasProvider = Boolean(asKnownString(initial.provider));
			const hasModel = Boolean(asKnownString(initial.model));
			const knownCost = asFiniteNumber(initial.metadata?.totalCost);
			const hasCost = knownCost !== undefined && knownCost > 0;
			if (hasTitle && hasProvider && hasModel && hasCost) {
				return initial;
			}
			const messages = await host.readSessionMessages(row.sessionId);
			if (messages.length === 0) {
				return initial;
			}
			const inferredProviderModel = inferProviderAndModelFromMessages(messages);
			const inferredCost = summarizeCostFromMessages(messages);
			return normalizeHistoryRow(row, {
				title: hasTitle ? undefined : inferTitleFromMessages(messages),
				provider: hasProvider ? undefined : inferredProviderModel.provider,
				model: hasModel ? undefined : inferredProviderModel.model,
				totalCost: hasCost || inferredCost <= 0 ? undefined : inferredCost,
			});
		}),
	);
}

export async function listSessionHistory(
	host: Pick<RuntimeHost, "listSessions" | "readSessionMessages">,
	options: SessionHistoryListOptions = {},
): Promise<SessionHistoryRecord[]> {
	const limit = normalizeHistoryLimit(options.limit);
	const backendRows = await listHostSessionRows(host, limit);
	const manifestRows =
		options.includeManifestFallback === true && backendRows.length < limit
			? await listManifestHistoryRows(Math.min(Math.max(limit * 2, 100), 500))
			: [];
	const merged = new Map<string, SessionRecord>();
	for (const row of [...backendRows, ...manifestRows]) {
		if (merged.has(row.sessionId)) {
			continue;
		}
		merged.set(row.sessionId, row);
	}
	const rows =
		manifestRows.length === 0
			? backendRows
			: Array.from(merged.values())
					.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
					.slice(0, limit);
	if (options.hydrate === false) {
		return rows.map((row) => normalizeHistoryRow(row));
	}
	return await hydrateSessionHistory(host, rows);
}

async function readManifestMessagesPath(
	sessionId: string,
): Promise<string | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	const manifestPath = join(resolveSessionDataDir(), target, `${target}.json`);
	const raw = await readFile(manifestPath, "utf8").catch(() => undefined);
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = SessionManifestSchema.safeParse(JSON.parse(raw) as unknown);
		return parsed.success ? parsed.data.messages_path : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Lists history directly from the persistence backend without constructing a
 * runtime host. This keeps read-only history commands from initializing runtime
 * services such as plugins, MCP, or hub transport.
 */
export async function listSessionHistoryFromBackend(
	backend: Pick<SessionBackend, "listSessions">,
	options: SessionHistoryListOptions = {},
): Promise<SessionHistoryRecord[]> {
	const rowsById = new Map<string, SessionRow>();
	const host = {
		listSessions: async (limit?: number): Promise<SessionRecord[]> => {
			const rows = await backend.listSessions(limit);
			rowsById.clear();
			for (const row of rows) {
				rowsById.set(row.sessionId, row);
			}
			return rows.map(toSessionRecord);
		},
		readSessionMessages: async (
			sessionId: string,
		): Promise<LlmsProviders.Message[]> => {
			const messagesPath =
				rowsById.get(sessionId)?.messagesPath ??
				(await readManifestMessagesPath(sessionId));
			return await readPersistedMessagesFile(messagesPath);
		},
	};
	return await listSessionHistory(host, options);
}
