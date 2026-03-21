import type { LlmsProviders } from "@clinebot/core";
import { normalizeUserInput } from "@clinebot/core";

type StoredSessionMessage = LlmsProviders.Message & {
	metrics?: {
		cost?: number;
	};
	providerId?: string;
	modelId?: string;
};

type TextBlock = {
	type?: string;
	text?: string;
};

export type SessionPreviewMessage = {
	role: "user" | "assistant";
	text: string;
};

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

function getTextMessages(
	messages: LlmsProviders.Message[],
): SessionPreviewMessage[] {
	const out: SessionPreviewMessage[] = [];
	for (const raw of messages) {
		if (raw.role !== "user" && raw.role !== "assistant") {
			continue;
		}
		const text = toSingleLine(extractTextFromContent(raw.content));
		if (!text) {
			continue;
		}
		out.push({
			role: raw.role,
			text,
		});
	}
	return out;
}

export function inferTitleFromMessages(
	messages: LlmsProviders.Message[],
): string | undefined {
	const textMessages = getTextMessages(messages);
	for (const role of ["user", "assistant"] as const) {
		const candidate = textMessages.find((message) => message.role === role);
		if (!candidate) {
			continue;
		}
		const normalized = normalizeUserInput(
			candidate.text.split("\n")[0] ?? candidate.text,
		);
		return truncateText(normalized, 50);
	}
	return undefined;
}

export function summarizeCostFromMessages(
	messages: LlmsProviders.Message[],
): number {
	let total = 0;
	for (const message of messages as StoredSessionMessage[]) {
		const maybeCost = message.metrics?.cost;
		if (typeof maybeCost === "number" && Number.isFinite(maybeCost)) {
			total += maybeCost;
		}
	}
	return total;
}

export function inferProviderAndModelFromMessages(
	messages: LlmsProviders.Message[],
): {
	provider?: string;
	model?: string;
} {
	let provider: string | undefined;
	let model: string | undefined;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as StoredSessionMessage;
		const providerId = message.providerId?.trim();
		const modelId = message.modelId?.trim();
		if (!provider && providerId) {
			provider = providerId;
		}
		if (!model && modelId) {
			model = modelId;
		}
		if (provider && model) {
			break;
		}
	}
	return { provider, model };
}

export function getLastSessionPreviewMessages(
	messages: LlmsProviders.Message[],
	limit = 2,
): SessionPreviewMessage[] {
	const textMessages = getTextMessages(messages);
	if (textMessages.length <= limit) {
		return textMessages;
	}
	return textMessages.slice(-limit);
}

export function formatPreviewMessageText(
	message: SessionPreviewMessage,
	maxLength = 200,
): string {
	return `[${message.role}] ${truncateText(message.text, maxLength)}`;
}
