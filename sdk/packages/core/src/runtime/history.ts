import type * as LlmsProviders from "@clinebot/llms";
import { formatDisplayUserInput, normalizeUserInput } from "@clinebot/shared";
import type {
	SessionHistoryMetadata,
	SessionHistoryRecord,
	SessionRecord,
} from "../types/sessions";
import type { RuntimeHost } from "./runtime-host";

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
	host: Pick<RuntimeHost, "readMessages">,
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
			const messages = await host.readMessages(row.sessionId);
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
