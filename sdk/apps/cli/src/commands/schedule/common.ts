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

export function mergeScheduleDeliveryMetadata(
	base: Record<string, unknown> | undefined,
	delivery: {
		deliveryAdapter?: string;
		deliveryThread?: string;
		deliveryChannel?: string;
		deliveryBot?: string;
	},
): Record<string, unknown> | undefined {
	const adapter = delivery.deliveryAdapter?.trim();
	const threadId = delivery.deliveryThread?.trim();
	const channelId = delivery.deliveryChannel?.trim();
	const userName = delivery.deliveryBot?.trim();
	if (!adapter && !threadId && !channelId && !userName) {
		return base;
	}
	const next = { ...(base ?? {}) };
	const existingDelivery =
		next.delivery &&
		typeof next.delivery === "object" &&
		!Array.isArray(next.delivery)
			? (next.delivery as Record<string, unknown>)
			: {};
	next.delivery = {
		...existingDelivery,
		...(adapter ? { adapter } : {}),
		...(threadId ? { threadId } : {}),
		...(channelId ? { channelId } : {}),
		...(userName ? { userName } : {}),
	};
	return next;
}

export function mergeScheduleAutonomousMetadata(
	base: Record<string, unknown> | undefined,
	autonomous: {
		autonomous?: true;
		noAutonomous?: true;
		idleTimeout?: string;
		pollInterval?: string;
	},
): Record<string, unknown> | undefined {
	const autonomousEnabled = !!autonomous.autonomous;
	const autonomousDisabled = !!autonomous.noAutonomous;
	const idleTimeoutSeconds = autonomous.idleTimeout;
	const pollIntervalSeconds = autonomous.pollInterval;
	if (
		!autonomousEnabled &&
		!autonomousDisabled &&
		!idleTimeoutSeconds &&
		!pollIntervalSeconds
	) {
		return base;
	}
	const next = { ...(base ?? {}) };
	const existingAutonomous =
		next.autonomous &&
		typeof next.autonomous === "object" &&
		!Array.isArray(next.autonomous)
			? (next.autonomous as Record<string, unknown>)
			: {};
	next.autonomous = {
		...existingAutonomous,
		...(autonomousEnabled ? { enabled: true } : {}),
		...(autonomousDisabled ? { enabled: false } : {}),
		...(idleTimeoutSeconds
			? { idleTimeoutSeconds: toPositiveInt(idleTimeoutSeconds, 60) }
			: {}),
		...(pollIntervalSeconds
			? { pollIntervalSeconds: toPositiveInt(pollIntervalSeconds, 5) }
			: {}),
	};
	return next;
}

export function hasMetadataPatchOpts(opts: Record<string, unknown>): boolean {
	return (
		!!opts.metadataJson ||
		!!opts.deliveryAdapter ||
		!!opts.deliveryThread ||
		!!opts.deliveryChannel ||
		!!opts.deliveryBot ||
		!!opts.autonomous ||
		!!opts.noAutonomous ||
		!!opts.idleTimeout ||
		!!opts.pollInterval
	);
}

export function mergeScheduleMetadata(
	base: Record<string, unknown> | undefined,
	opts: {
		deliveryAdapter?: string;
		deliveryThread?: string;
		deliveryChannel?: string;
		deliveryBot?: string;
		autonomous?: true;
		noAutonomous?: true;
		idleTimeout?: string;
		pollInterval?: string;
	},
): Record<string, unknown> | undefined {
	return mergeScheduleAutonomousMetadata(
		mergeScheduleDeliveryMetadata(base, opts),
		opts,
	);
}

export function isJsonPath(path: string): boolean {
	return path.toLowerCase().endsWith(".json");
}

export function parseMode(raw: string | undefined): "act" | "plan" | undefined {
	if (raw === "act" || raw === "plan") {
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
		.option("--delivery-adapter <name>", "Delivery adapter name")
		.option("--delivery-bot <name>", "Delivery bot user name")
		.option("--delivery-channel <id>", "Delivery channel ID")
		.option("--delivery-thread <id>", "Delivery thread ID");
}

export function addAutonomousOptions(cmd: Command): Command {
	return cmd
		.option("--autonomous", "Enable autonomous mode")
		.option("--no-autonomous", "Disable autonomous mode")
		.option("--idle-timeout <seconds>", "Autonomous idle timeout in seconds")
		.option("--poll-interval <seconds>", "Autonomous poll interval in seconds");
}
