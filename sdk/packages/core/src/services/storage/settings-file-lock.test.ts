import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withSettingsRefreshLock } from "./settings-file-lock";

describe("withSettingsRefreshLock", () => {
	let dir: string;
	let settingsPath: string;
	let lockDir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "settings-lock-test-"));
		settingsPath = join(dir, "providers.json");
		lockDir = `${settingsPath}.oauth.lock`;
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("runs the body and cleans up the lock directory", async () => {
		let sawLock = false;
		const result = await withSettingsRefreshLock(settingsPath, async () => {
			sawLock = existsSync(lockDir);
			return 42;
		});
		expect(result).toBe(42);
		expect(sawLock).toBe(true);
		expect(existsSync(lockDir)).toBe(false);
	});

	it("releases the lock when the body throws", async () => {
		await expect(
			withSettingsRefreshLock(settingsPath, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(existsSync(lockDir)).toBe(false);
	});

	it("never overlaps two concurrent bodies", async () => {
		const order: string[] = [];
		const body = (name: string) => async () => {
			order.push(`${name}:enter`);
			await new Promise((r) => setTimeout(r, 30));
			order.push(`${name}:exit`);
			return name;
		};
		const [a, b] = await Promise.all([
			withSettingsRefreshLock(settingsPath, body("a")),
			withSettingsRefreshLock(settingsPath, body("b")),
		]);
		expect([a, b].sort()).toEqual(["a", "b"]);
		// enter/exit pairs must not interleave
		expect(order).toEqual(["a:enter", "a:exit", "b:enter", "b:exit"]);
	});

	it("queues same-process callers even when one rejects", async () => {
		const order: string[] = [];
		const results = await Promise.allSettled([
			withSettingsRefreshLock(settingsPath, async () => {
				order.push("first");
				throw new Error("first failed");
			}),
			withSettingsRefreshLock(settingsPath, async () => {
				order.push("second");
				return "ok";
			}),
		]);
		expect(order).toEqual(["first", "second"]);
		expect(results[0].status).toBe("rejected");
		expect(results[1]).toEqual({ status: "fulfilled", value: "ok" });
		expect(existsSync(lockDir)).toBe(false);
	});

	it("reclaims a stale lock left by a crashed holder", async () => {
		// Simulate a crashed holder: a populated lock dir with an old mtime.
		mkdirSync(lockDir, { recursive: true });
		writeFileSync(join(lockDir, "owner.stale"), "stale");
		const old = new Date(Date.now() - 120_000);
		utimesSync(lockDir, old, old);

		const result = await withSettingsRefreshLock(
			settingsPath,
			async () => "reclaimed",
			{ staleMs: 1_000, pollMs: 5, timeoutMs: 2_000 },
		);
		expect(result).toBe("reclaimed");
		expect(existsSync(lockDir)).toBe(false);
	});

	it("does not remove a fresh lock held by another owner, and falls through on timeout", async () => {
		mkdirSync(lockDir, { recursive: true });
		writeFileSync(join(lockDir, "owner.other"), "other");

		// Fresh foreign lock + tiny timeout → body still runs (degrade, don't fail).
		const result = await withSettingsRefreshLock(
			settingsPath,
			async () => "ran-unlocked",
			{ staleMs: 60_000, pollMs: 5, timeoutMs: 50 },
		);
		expect(result).toBe("ran-unlocked");
		// The foreign owner's lock must be untouched.
		expect(existsSync(lockDir)).toBe(true);
		expect(readdirSync(lockDir)).toEqual(["owner.other"]);
	});
});
