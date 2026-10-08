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

type ScheduleDeliveryOptions = {
	deliveryAdapter?: string;
	deliveryThread?: string;
	deliveryBot?: string;
};

export function hasMetadataPatchOpts(
	opts: ScheduleDeliveryOptions & { metadataJson?: string },
): boolean {
	return (
		!!opts.metadataJson ||
		!!opts.deliveryAdapter ||
		!!opts.deliveryThread ||
		!!opts.deliveryBot
	);
}

/**
 * Builds a schedule's metadata from the stored metadata, the
 * `--metadata-json` object and the delivery flags, in that order of
 * precedence. Connectors deliver a scheduled result only to a chat they can
 * find from `threadId`, `bindingKey` or `participantKey`, so a delivery that
 * the JSON or the flags set without any of them, or without an adapter, is
 * rejected here instead of being saved and never delivered. A stored
 * delivery that neither changes is kept as it is, and `"delivery": null`
 * in the JSON removes it.
 */
export function mergeScheduleMetadata(input: {
	stored?: Record<string, unknown>;
	json?: Record<string, unknown>;
	delivery: ScheduleDeliveryOptions;
}): Record<string, unknown> | undefined {
	const { stored, json, delivery } = input;
	const adapter = delivery.deliveryAdapter?.trim();
	const threadId = delivery.deliveryThread?.trim();
	const userName = delivery.deliveryBot?.trim();
	const flagsSetDelivery = !!(adapter || threadId || userName);
	const jsonSetsDelivery = !!json && Object.hasOwn(json, "delivery");
	if (!stored && !json && !flagsSetDelivery) {
		return undefined;
	}
	const next = { ...(stored ?? {}), ...(json ?? {}) };
	if (!flagsSetDelivery && !jsonSetsDelivery) {
		return next;
	}
	if (jsonSetsDelivery && next.delivery !== null && !isObject(next.delivery)) {
		throw new Error("metadata delivery must be an object or null");
	}
	if (!flagsSetDelivery && next.delivery === null) {
		return next;
	}
	const merged: Record<string, unknown> = {
		...(isObject(next.delivery) ? next.delivery : {}),
		...(adapter ? { adapter } : {}),
		...(threadId ? { threadId } : {}),
		...(userName ? { userName } : {}),
	};
	if (!hasDeliveryTarget(merged)) {
		throw new Error(
			"schedule delivery needs --delivery-thread <id>: send /whereami in the chat to get it",
		);
	}
	if (!hasNonEmptyString(merged.adapter)) {
		throw new Error(
			"schedule delivery needs --delivery-adapter <name>, such as telegram or slack",
		);
	}
	next.delivery = merged;
	return next;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function hasDeliveryTarget(delivery: Record<string, unknown>): boolean {
	return (
		hasNonEmptyString(delivery.threadId) ||
		hasNonEmptyString(delivery.bindingKey) ||
		hasNonEmptyString(delivery.participantKey)
	);
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

export function addDeliveryOptions(cmd: Command): Command {
	return cmd
		.option(
			"--delivery-adapter <name>",
			"Connector that posts each run's result, such as telegram",
		)
		.option(
			"--delivery-bot <name>",
			"Only this bot posts the result, when several are running",
		)
		.option(
			"--delivery-thread <id>",
			"Chat to post the result to; /whereami in the chat shows it",
		);
}
