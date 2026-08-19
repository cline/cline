/**
 * Discovery record: atomic, mode 0600, written only by the authority,
 * removed only by its own instance.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	createGatewayId,
	createGatewayInstanceId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	createInstanceAuthToken,
	type DiscoveryRecord,
	readDiscoveryRecord,
	removeDiscoveryRecord,
	writeDiscoveryRecord,
} from "./discovery";
import { tempDataRoot } from "./test-support";

function record(overrides: Partial<DiscoveryRecord> = {}): DiscoveryRecord {
	return {
		gatewayId: createGatewayId(),
		instanceId: createGatewayInstanceId(),
		host: "127.0.0.1",
		port: 4242,
		auth: createInstanceAuthToken(),
		pid: process.pid,
		startedAt: Date.now(),
		protocolVersions: [1],
		dataDir: "/tmp/x",
		namespace: "default",
		...overrides,
	};
}

describe("discovery record", () => {
	it("round-trips and is written mode 0600", () => {
		const file = join(tempDataRoot(), "gateway.json");
		const written = record();
		writeDiscoveryRecord(file, written);
		expect(readDiscoveryRecord(file)).toEqual(written);
		const mode = statSync(file).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("treats missing or invalid records as absent (diagnose, no crash)", () => {
		const dir = tempDataRoot();
		expect(readDiscoveryRecord(join(dir, "missing.json"))).toBeUndefined();
	});

	it("only the owning instance may remove its record", () => {
		const file = join(tempDataRoot(), "gateway.json");
		const mine = record();
		writeDiscoveryRecord(file, mine);
		// A stranger (e.g. an older instance shutting down late) is a no-op.
		removeDiscoveryRecord(file, createGatewayInstanceId());
		expect(existsSync(file)).toBe(true);
		removeDiscoveryRecord(file, mine.instanceId);
		expect(existsSync(file)).toBe(false);
	});

	it("per-instance auth tokens are unique and well-formed", () => {
		const a = createInstanceAuthToken();
		const b = createInstanceAuthToken();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[A-Za-z0-9_-]{16,}$/);
	});
});
