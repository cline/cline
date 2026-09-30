import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolveFileMutationLockDir,
	withFileMutationLock,
} from "./file-mutation-lock";

const directories: string[] = [];
function lockBasis(): string {
	const directory = mkdtempSync(path.join(os.tmpdir(), "file-mutation-lock-"));
	directories.push(directory);
	return path.join(directory, "models.json");
}
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("withFileMutationLock", () => {
	it("serializes overlapping holders and releases the lock", async () => {
		const basis = lockBasis();
		const events: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const first = withFileMutationLock(basis, { label: "test" }, async () => {
			events.push("first:start");
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			events.push("first:end");
		});
		while (!releaseFirst) await new Promise((r) => setTimeout(r, 5));
		const second = withFileMutationLock(
			basis,
			{ label: "test", pollMs: 5 },
			async () => {
				events.push("second");
			},
		);
		await new Promise((r) => setTimeout(r, 30));
		expect(events).toEqual(["first:start"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second"]);
		expect(existsSync(resolveFileMutationLockDir(basis))).toBe(false);
	});

	it("releases the lock when the callback throws", async () => {
		const basis = lockBasis();
		const failure = new Error("boom");
		await expect(
			withFileMutationLock(basis, { label: "test" }, async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(existsSync(resolveFileMutationLockDir(basis))).toBe(false);
	});

	it("reclaims a lock whose owner process is gone", async () => {
		const basis = lockBasis();
		const lockDir = resolveFileMutationLockDir(basis);
		mkdirSync(lockDir);
		writeFileSync(
			path.join(lockDir, "owner.json"),
			JSON.stringify({
				pid: 2 ** 31 - 2,
				acquiredAt: new Date().toISOString(),
			}),
		);
		await expect(
			withFileMutationLock(
				basis,
				{ label: "test", waitMs: 1_000 },
				async () => "ok",
			),
		).resolves.toBe("ok");
	});

	it("times out behind a live holder", async () => {
		const basis = lockBasis();
		const lockDir = resolveFileMutationLockDir(basis);
		mkdirSync(lockDir);
		writeFileSync(
			path.join(lockDir, "owner.json"),
			JSON.stringify({
				pid: process.pid,
				acquiredAt: new Date().toISOString(),
			}),
		);
		await expect(
			withFileMutationLock(
				basis,
				{ label: "test", waitMs: 50, pollMs: 5 },
				async () => "never",
			),
		).rejects.toThrow("Timed out waiting for test lock");
	});

	it("excludes a holder in another process", async () => {
		const basis = lockBasis();
		const lockDir = resolveFileMutationLockDir(basis);
		const released = `${basis}.released`;
		// A child process takes the lock the same way (atomic mkdir + owner
		// record with its own pid), then marks the release before removing it.
		const child = spawn(
			process.execPath,
			[
				"-e",
				`const fs=require("node:fs");const p=require("node:path");
const d=${JSON.stringify(lockDir)};
fs.mkdirSync(d);
fs.writeFileSync(p.join(d,"owner.json"),JSON.stringify({pid:process.pid,acquiredAt:new Date().toISOString()}));
process.stdout.write("held\\n");
setTimeout(()=>{fs.writeFileSync(${JSON.stringify(released)},"");fs.rmSync(d,{recursive:true,force:true});},200);`,
			],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		const exited = new Promise<void>((resolve) =>
			child.once("exit", () => resolve()),
		);
		await new Promise<void>((resolve) =>
			child.stdout.once("data", () => resolve()),
		);
		await withFileMutationLock(
			basis,
			{ label: "test", pollMs: 10 },
			async () => {
				expect(existsSync(released)).toBe(true);
			},
		);
		await exited;
	});
});
