/**
 * Discovery record (Gateway RFC, Phase 3).
 *
 * The serving Gateway writes one mode-0600 JSON record into its data
 * directory — atomically (temp file + rename) and only after the server
 * is actually ready (lock held, database migrated, socket listening).
 * The record carries the loopback endpoint and the per-instance auth
 * secret; file permissions are the access control.
 *
 * The discovery record is NOT authority: authority is the OS-backed
 * lock. A stale record (crashed holder) simply fails to connect; readers
 * diagnose, they never "take over" by rewriting it.
 */

import { randomBytes } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	GatewayAuthTokenSchema,
	GatewayIdSchema,
	GatewayInstanceIdSchema,
} from "@cline/shared/gateway";
import { z } from "zod";

export const DiscoveryRecordSchema = z
	.object({
		gatewayId: GatewayIdSchema,
		instanceId: GatewayInstanceIdSchema,
		host: z.string().min(1),
		port: z.number().int().positive(),
		/** Per-instance loopback secret; protected by the 0600 file mode. */
		auth: GatewayAuthTokenSchema,
		pid: z.number().int().positive(),
		startedAt: z.number().int().nonnegative(),
		protocolVersions: z.array(z.number().int().positive()).nonempty(),
		dataDir: z.string().min(1),
		namespace: z.string().min(1),
	})
	.strict();

export type DiscoveryRecord = z.infer<typeof DiscoveryRecordSchema>;

/** Generate a per-instance loopback secret (never durable). */
export function createInstanceAuthToken(): string {
	return randomBytes(32).toString("base64url");
}

/** Atomic, owner-only write. Call only after the server is ready. */
export function writeDiscoveryRecord(
	discoveryFile: string,
	record: DiscoveryRecord,
): void {
	const validated = DiscoveryRecordSchema.parse(record);
	mkdirSync(dirname(discoveryFile), { recursive: true, mode: 0o700 });
	const tempFile = `${discoveryFile}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tempFile, `${JSON.stringify(validated, null, "\t")}\n`, {
		mode: 0o600,
	});
	chmodSync(tempFile, 0o600);
	renameSync(tempFile, discoveryFile);
}

export function readDiscoveryRecord(
	discoveryFile: string,
): DiscoveryRecord | undefined {
	let raw: string;
	try {
		raw = readFileSync(discoveryFile, "utf8");
	} catch {
		return undefined;
	}
	try {
		return DiscoveryRecordSchema.parse(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

/**
 * Remove the record, but only when it still names this instance — a
 * shutting-down process must never delete a successor's record.
 */
export function removeDiscoveryRecord(
	discoveryFile: string,
	instanceId: string,
): void {
	const current = readDiscoveryRecord(discoveryFile);
	if (!current || current.instanceId !== instanceId) {
		return;
	}
	try {
		rmSync(discoveryFile);
	} catch {
		// Already gone.
	}
}
