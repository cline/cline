import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	HubInstanceLock,
	HubLockHeldError,
	isHubLockHeldError,
	resolveHubInstanceLockPath,
} from "./instance-lock";

describe("HubInstanceLock", () => {
	function tempLockFile(): string {
		return resolveHubInstanceLockPath(
			join(mkdtempSync(join(tmpdir(), "cline-hub-lock-")), "discovery.json"),
		);
	}

	it("grants exclusive ownership and refuses a second acquirer", () => {
		const lockFile = tempLockFile();
		const first = HubInstanceLock.acquire(lockFile);
		expect(first.held).toBe(true);
		try {
			expect(() => HubInstanceLock.acquire(lockFile)).toThrow(HubLockHeldError);
		} finally {
			first.release();
		}
	});

	it("frees ownership on release so a successor can acquire", () => {
		const lockFile = tempLockFile();
		const first = HubInstanceLock.acquire(lockFile);
		first.release();
		expect(first.held).toBe(false);
		const second = HubInstanceLock.acquire(lockFile);
		expect(second.held).toBe(true);
		second.release();
	});

	it("release is idempotent", () => {
		const lockFile = tempLockFile();
		const lock = HubInstanceLock.acquire(lockFile);
		lock.release();
		expect(() => lock.release()).not.toThrow();
	});

	it("identifies its own error type", () => {
		const lockFile = tempLockFile();
		const lock = HubInstanceLock.acquire(lockFile);
		try {
			HubInstanceLock.acquire(lockFile);
			expect.unreachable("second acquire must throw");
		} catch (error) {
			expect(isHubLockHeldError(error)).toBe(true);
			expect((error as HubLockHeldError).lockFile).toBe(lockFile);
		} finally {
			lock.release();
		}
		expect(isHubLockHeldError(new Error("nope"))).toBe(false);
	});

	it("scopes locks per discovery path", () => {
		const first = HubInstanceLock.acquire(tempLockFile());
		const second = HubInstanceLock.acquire(tempLockFile());
		expect(first.held).toBe(true);
		expect(second.held).toBe(true);
		first.release();
		second.release();
	});
});
