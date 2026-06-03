import { spawn } from "node:child_process";
import process from "node:process";
import type { ProviderSettingsUpdate } from "./types";

export function readProviderSettingsUpdate(
	args: Record<string, unknown> | undefined,
): ProviderSettingsUpdate {
	return args?.settings && typeof args.settings === "object"
		? (args.settings as ProviderSettingsUpdate)
		: {};
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

export function asTimestamp(value: unknown): number | undefined {
	const numeric = asNumber(value);
	if (numeric !== undefined) return numeric;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function basename(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
}

export function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

export function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function isVisibleClient(clientType: string): boolean {
	return clientType.trim().length > 0;
}

export function isActiveSession(
	title: string | undefined,
	status: string | undefined,
	participantCount?: number,
): boolean {
	if (!title || !status) return false;
	const normalized = status?.trim().toLowerCase();
	if (normalized !== "running" && normalized !== "idle") return false;
	return typeof participantCount === "number" ? participantCount > 0 : false;
}

export function formatUptime(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(total / 86_400);
	const h = Math.floor((total % 86_400) / 3_600);
	const m = Math.floor((total % 3_600) / 60);
	const s = total % 60;
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

export function formatClientLabel(clientType: string | undefined): string {
	const normalized = clientType?.trim().toLowerCase() ?? "";
	if (!normalized || normalized === "unknown") return "Client";
	if (normalized.includes("cline")) return "Cline";
	return normalized
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function stringifyContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((entry) => {
				if (typeof entry === "string") return entry;
				if (entry && typeof entry === "object") {
					const record = entry as Record<string, unknown>;
					return (
						asString(record.text) ??
						asString(record.content) ??
						asString(record.result) ??
						""
					);
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	if (value == null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function chunkText(chunk: unknown): string {
	if (typeof chunk === "string") return chunk;
	if (chunk && typeof chunk === "object") {
		const record = chunk as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
		if (typeof record.content === "string") return record.content;
	}
	return "";
}

export function openExternalUrl(url: string): void {
	const platform = process.platform;
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args = platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { stdio: "ignore", detached: true });
	child.unref();
}
