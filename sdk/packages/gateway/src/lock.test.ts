/**
 * OS-backed exclusive lock (ADR 0002): one holder per data directory;
 * losing the race means connect-or-diagnose, never replace; release (or
 * process death) frees the lock without leaking ownership.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GatewayLock, GatewayLockHeldError } from "./lock";
import { tempDataRoot } from "./test-support";

describe("GatewayLock", () => {
	it("grants exclusive ownership and rejects a second acquirer", () => {
		const lockFile = join(tempDataRoot(), "gateway.lock");
		const first = GatewayLock.acquire(lockFile);
		expect(first.held).toBe(true);
		expect(existsSync(lockFile)).toBe(true);

		// A second acquisition (same machine, same data dir) must fail with
		// the typed error — the caller connects or diagnoses, never replaces.
		expect(() => GatewayLock.acquire(lockFile)).toThrow(GatewayLockHeldError);

		first.release();
		expect(first.held).toBe(false);
	});

	it("can be re-acquired after release (no leaked ownership)", () => {
		const lockFile = join(tempDataRoot(), "gateway.lock");
		const first = GatewayLock.acquire(lockFile);
		first.release();
		const second = GatewayLock.acquire(lockFile);
		expect(second.held).toBe(true);
		second.release();
	});

	it("keeps the lock file owner-only", () => {
		const lockFile = join(tempDataRoot(), "gateway.lock");
		const lock = GatewayLock.acquire(lockFile);
		const mode = statSync(lockFile).mode & 0o777;
		expect(mode & 0o077).toBe(0);
		lock.release();
	});

	it("release is idempotent", () => {
		const lockFile = join(tempDataRoot(), "gateway.lock");
		const lock = GatewayLock.acquire(lockFile);
		lock.release();
		expect(() => lock.release()).not.toThrow();
	});
});
