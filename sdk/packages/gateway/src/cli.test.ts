/**
 * Lifecycle CLI, exercised with real processes: concurrent starters race
 * for the OS lock and exactly one becomes the authority — the loser
 * connects/diagnoses (exit code 3), never kills the winner and never
 * binds another port. `status`/`drain`/`stop`/`start` drive the running
 * instance through the wire protocol.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDiscoveryRecord } from "./discovery";
import { resolveGatewayPaths } from "./paths";
import { tempDataRoot, waitFor } from "./test-support";

const CLI = join(import.meta.dirname, "cli.ts");
const BUN = process.env.BUN_BIN ?? "bun";

interface CliProcess {
	child: ChildProcess;
	stdout: string[];
	stderr: string[];
	exit: Promise<number | null>;
}

const spawned: CliProcess[] = [];
const dataRoots: string[] = [];

function runCli(args: string[], dataRoot: string): CliProcess {
	const child = spawn(BUN, [CLI, ...args, "--data-root", dataRoot], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env },
	});
	const stdout: string[] = [];
	const stderr: string[] = [];
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => stdout.push(chunk));
	child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
	const exit = new Promise<number | null>((resolve) => {
		child.on("exit", (code) => resolve(code));
	});
	const proc: CliProcess = { child, stdout, stderr, exit };
	spawned.push(proc);
	return proc;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function parsedLines(proc: CliProcess): Record<string, unknown>[] {
	return proc.stdout
		.join("")
		.split("\n")
		.filter((line) => line.trim().startsWith("{"))
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(async () => {
	// Kill any process this test started (specific PIDs only), including
	// detached grandchildren recorded in discovery files.
	for (const dataRoot of dataRoots.splice(0)) {
		const record = readDiscoveryRecord(
			resolveGatewayPaths({ dataRoot }).discoveryFile,
		);
		if (record && isAlive(record.pid)) {
			try {
				process.kill(record.pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
	}
	for (const proc of spawned.splice(0)) {
		if (proc.child.pid && isAlive(proc.child.pid)) {
			try {
				proc.child.kill("SIGKILL");
			} catch {
				// Already gone.
			}
		}
	}
});

describe("concurrent starters (real processes)", () => {
	it("exactly one serve wins; the loser diagnoses with exit 3 and changes nothing", {
		timeout: 40_000,
	}, async () => {
		const dataRoot = tempDataRoot();
		dataRoots.push(dataRoot);
		const paths = resolveGatewayPaths({ dataRoot });

		// Two starters race for the same data directory.
		const a = runCli(["serve"], dataRoot);
		const b = runCli(["serve"], dataRoot);

		// Exactly one of them exits (the loser, code 3); the winner keeps
		// serving.
		const loserExit = await Promise.race([a.exit, b.exit]);
		expect(loserExit).toBe(3);
		const [winner, loser] =
			(await Promise.race([a.exit.then(() => "a"), b.exit.then(() => "b")])) ===
			"a"
				? [b, a]
				: [a, b];

		const loserOutput = parsedLines(loser);
		expect(loserOutput[0]?.status).toBe("already_running");

		// The winner reached readiness and published exactly one discovery
		// record; the loser did not touch it and did not bind a port.
		await waitFor(
			() => readDiscoveryRecord(paths.discoveryFile) !== undefined,
			{
				timeoutMs: 20_000,
			},
		);
		const record = readDiscoveryRecord(paths.discoveryFile);
		if (!record) {
			throw new Error("winner published no discovery record");
		}
		expect(isAlive(record.pid)).toBe(true);
		expect(record.pid).toBe(winner.child.pid);

		await waitFor(() => parsedLines(winner).length > 0, { timeoutMs: 20_000 });
		const winnerOutput = parsedLines(winner);
		expect(winnerOutput[0]?.status).toBe("serving");
		expect(winnerOutput[0]?.port).toBe(record.port);

		// The winner survived the contention: status connects fine.
		const status = runCli(["status"], dataRoot);
		expect(await status.exit).toBe(0);
		expect(parsedLines(status)[0]?.status).toBe("running");

		// And the loser never killed it.
		expect(isAlive(record.pid)).toBe(true);
	});

	it("start is idempotent, stop retires the instance and removes discovery", {
		timeout: 40_000,
	}, async () => {
		const dataRoot = tempDataRoot();
		dataRoots.push(dataRoot);
		const paths = resolveGatewayPaths({ dataRoot });

		const start = runCli(["start"], dataRoot);
		expect(await start.exit).toBe(0);
		expect(parsedLines(start)[0]?.status).toBe("started");
		const record = readDiscoveryRecord(paths.discoveryFile);
		if (!record) {
			throw new Error("start published no discovery record");
		}
		expect(isAlive(record.pid)).toBe(true);

		// A second start finds the running authority and does nothing.
		const again = runCli(["start"], dataRoot);
		expect(await again.exit).toBe(0);
		expect(parsedLines(again)[0]?.status).toBe("already_running");
		expect(readDiscoveryRecord(paths.discoveryFile)?.instanceId).toBe(
			record.instanceId,
		);

		// Drain, then stop through the wire (operator commands, not client
		// daemon replacement).
		const drain = runCli(["drain", "--reason", "cli-test"], dataRoot);
		expect(await drain.exit).toBe(0);

		const stop = runCli(["stop"], dataRoot);
		expect(await stop.exit).toBe(0);
		await waitFor(
			() => readDiscoveryRecord(paths.discoveryFile) === undefined,
			{ timeoutMs: 20_000 },
		);
		await waitFor(() => !isAlive(record.pid), { timeoutMs: 20_000 });
	});
});
