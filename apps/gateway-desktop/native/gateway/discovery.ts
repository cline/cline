/**
 * Discovery resolution for the broker: locate the Gateway's mode-0600
 * discovery record through the shared path API and validate that the
 * file is actually private to this user before trusting the secret in
 * it. A missing or invalid record is a VISIBLE state (unavailable with
 * start instructions) — the broker never starts, stops, upgrades, or
 * replaces a Gateway (ADR 0003).
 */

import { statSync } from "node:fs";
import {
	type DiscoveryRecord,
	GatewayClient,
	readDiscoveryRecord,
	resolveGatewayPaths,
} from "@cline/gateway/client";
import type { GatewayPort, GatewayPortFactory } from "./port";

export type DiscoveryResolution =
	| { ok: true; record: DiscoveryRecord; discoveryFile: string }
	| {
			ok: false;
			reason: "missing" | "unreadable" | "insecure_permissions" | "not_owner";
			discoveryFile: string;
	  };

export interface DiscoveryOptions {
	dataRoot?: string;
	namespace?: string;
}

/** Resolve and validate the discovery record (owner + 0600 mode). */
export function resolveDiscovery(
	options: DiscoveryOptions = {},
): DiscoveryResolution {
	const paths = resolveGatewayPaths(options);
	const discoveryFile = paths.discoveryFile;
	let stats: ReturnType<typeof statSync>;
	try {
		stats = statSync(discoveryFile);
	} catch {
		return { ok: false, reason: "missing", discoveryFile };
	}
	// Windows has no POSIX modes; this validation targets macOS/Linux.
	if (process.platform !== "win32") {
		if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
			return { ok: false, reason: "not_owner", discoveryFile };
		}
		if ((stats.mode & 0o077) !== 0) {
			return { ok: false, reason: "insecure_permissions", discoveryFile };
		}
	}
	const record = readDiscoveryRecord(discoveryFile);
	if (!record) {
		return { ok: false, reason: "unreadable", discoveryFile };
	}
	return { ok: true, record, discoveryFile };
}

/**
 * Production port factory: resolve discovery, validate it, and complete
 * the hello handshake with `@cline/gateway/client`.
 */
export function createGatewayPortFactory(options: {
	discovery?: DiscoveryOptions;
	clientName?: string;
	clientVersion?: string;
}): GatewayPortFactory {
	return async ({ clientId }): Promise<GatewayPort> => {
		const resolution = resolveDiscovery(options.discovery);
		if (!resolution.ok) {
			throw Object.assign(new Error(`Gateway discovery ${resolution.reason}`), {
				gatewayError: {
					code: "gateway_unreachable",
					message:
						resolution.reason === "missing"
							? "No Gateway discovery record was found; the Gateway is not running"
							: `Gateway discovery record rejected (${resolution.reason})`,
					retryable: true,
				},
			});
		}
		const client = await GatewayClient.connectToDiscovery(resolution.record, {
			clientName: options.clientName ?? "gateway-desktop",
			clientVersion: options.clientVersion ?? "0.0.1",
			...(clientId ? { clientId } : {}),
		});
		return client;
	};
}
