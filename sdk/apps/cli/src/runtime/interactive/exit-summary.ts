import type { SessionAccumulatedUsage, SessionRecord } from "@clinebot/core";
import type { Message } from "@clinebot/shared";
import { c, formatUsd } from "../../utils/output";

export interface InteractiveExitSummary {
	sessionId: string;
	startedAt?: string;
	provider?: string;
	model?: string;
	cwd?: string;
	messageCount: number;
	totalCost?: number;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function trim(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function providerModel(summary: InteractiveExitSummary): string | undefined {
	const provider = trim(summary.provider);
	const model = trim(summary.model);
	if (provider && model) return `${provider}:${model}`;
	return provider ?? model;
}

function formatDuration(startedAt: string | undefined): string {
	if (!startedAt) {
		return "0s";
	}
	const startedAtMs = new Date(startedAt).getTime();
	if (!Number.isFinite(startedAtMs)) {
		return "0s";
	}
	return `${Math.max(0, Math.round((Date.now() - startedAtMs) / 1000))}s`;
}

export function createInteractiveExitSummary(input: {
	sessionId: string;
	row?: SessionRecord;
	messages?: Message[];
	usage?: SessionAccumulatedUsage;
}): InteractiveExitSummary | undefined {
	const sessionId = trim(input.sessionId);
	if (!sessionId) {
		return undefined;
	}

	const messageCount = input.messages?.length ?? 0;
	const messagesPath = trim(input.row?.messagesPath);
	if (!messagesPath && messageCount === 0) {
		return undefined;
	}

	const totalCost =
		asFiniteNumber(input.usage?.totalCost) ??
		asFiniteNumber(input.row?.metadata?.totalCost);

	return {
		sessionId,
		startedAt: trim(input.row?.startedAt),
		provider: trim(input.row?.provider),
		model: trim(input.row?.model),
		cwd: trim(input.row?.cwd),
		messageCount,
		...(totalCost !== undefined ? { totalCost } : {}),
	};
}

export function formatInteractiveExitSummary(
	summary: InteractiveExitSummary,
): string {
	const model = providerModel(summary);
	const lines = [
		"",
		"Session Summary",
		`  ID        ${summary.sessionId}`,
		`  Duration  ${formatDuration(summary.startedAt)}`,
		model ? `  Model     ${model}` : undefined,
		summary.cwd ? `  CWD       ${summary.cwd}` : undefined,
		`  Messages  ${summary.messageCount.toLocaleString()}`,
		typeof summary.totalCost === "number"
			? `  Cost      ${formatUsd(summary.totalCost)}`
			: undefined,
		`  Continue  ${c.cyan}clite --id ${summary.sessionId}${c.reset}`,
		"",
	];
	return lines.filter((line): line is string => line !== undefined).join("\n");
}
