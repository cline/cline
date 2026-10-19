import type { Command } from "commander";
import type { CommandIo } from "./types";

export function parseList(raw: string | undefined): string[] | undefined {
	if (!raw) {
		return undefined;
	}
	const out = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return out.length > 0 ? out : undefined;
}

export function parseJsonObjectFlag(
	raw: string | undefined,
): Record<string, unknown> | undefined {
	if (!raw?.trim()) {
		return undefined;
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("metadata JSON must be an object");
	}
	return parsed as Record<string, unknown>;
}

export function toPositiveInt(
	value: string | undefined,
	fallback: number,
): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
}

export function isJsonPath(path: string): boolean {
	return path.toLowerCase().endsWith(".json");
}

export function parseMode(
	raw: string | undefined,
): "act" | "plan" | "yolo" | undefined {
	if (raw === "act" || raw === "plan" || raw === "yolo") {
		return raw;
	}
	return undefined;
}

export function emitJsonOrText(
	json: boolean,
	io: CommandIo,
	value: unknown,
): void {
	if (json) {
		io.writeln(JSON.stringify(value));
		return;
	}
	if (typeof value === "string") {
		io.writeln(value);
		return;
	}
	io.writeln(JSON.stringify(value, null, 2));
}

export function resolveAddress(
	address: string | undefined,
): string | undefined {
	const resolved = address ?? process.env.CLINE_HUB_ADDRESS;
	const trimmed = resolved?.trim();
	return trimmed ? trimmed : undefined;
}

export function formatResolvedAddressLabel(
	address: string | undefined,
): string {
	return address ? ` at ${address}` : "";
}

export function addSharedOptions(cmd: Command): Command {
	return cmd
		.option("--address <host:port>", "Hub server address")
		.option("--json", "Output as JSON");
}
