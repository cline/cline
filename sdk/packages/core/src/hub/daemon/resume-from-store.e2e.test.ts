/**
 * Real-process proof that a transcript larger than the hub's inbound frame
 * limit can still be resumed.
 *
 * The hub runs under Bun, which closes any inbound websocket frame above
 * 16 MiB with code 1006 ("Received too big message"). Sending a long saved
 * transcript inline in `session.create` therefore made the chat impossible to
 * reopen. `session.resume` makes the hub read the saved history itself, so the
 * client sends a tiny frame instead.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MessageWithMetadata } from "@cline/llms";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSource } from "../../types/common";
import { NodeHubClient } from "../client";
import { HubRuntimeHost } from "../runtime-host/hub-runtime-host";

const MIB = 1024 * 1024;
// Bun's default inbound websocket frame limit.
const HUB_INBOUND_FRAME_LIMIT_BYTES = 16 * MIB;

interface ReadyDaemon {
	child: ChildProcess;
	dataDir: string;
	discovery: { authToken: string; url: string };
}

interface StartCall {
	sessionId: string;
	initialMessages: number;
}

// How many messages the fixture hub has saved for every session.
const STORED_HISTORY_MESSAGES = 3;

const tempDirs = new Set<string>();
const children = new Set<ChildProcess>();
const hosts = new Set<HubRuntimeHost>();

function resolveBunExecutable(): string {
	const currentExecutable = basename(process.execPath).toLowerCase();
	if (
		(process.versions as { bun?: string }).bun ||
		currentExecutable === "bun" ||
		currentExecutable === "bun.exe"
	) {
		return process.execPath;
	}
	const configured = process.env.BUN_EXEC_PATH?.trim();
	if (configured) {
		return configured;
	}
	const installed = process.env.BUN_INSTALL?.trim();
	const executableName = process.platform === "win32" ? "bun.exe" : "bun";
	if (installed) {
		const candidate = join(installed, "bin", executableName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	for (const directory of process.env.PATH?.split(delimiter) ?? []) {
		const candidate = join(directory, executableName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Bun executable (${executableName}) was not found on PATH`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHealthUrl(webSocketUrl: string): URL {
	const url = new URL(webSocketUrl);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = "/health";
	url.search = "";
	return url;
}

async function startDaemon(): Promise<ReadyDaemon> {
	const dataDir = await mkdtemp(join(tmpdir(), "cline-hub-resume-e2e-"));
	tempDirs.add(dataDir);
	const discoveryPath = join(dataDir, "hub-discovery.json");
	const entryPath = fileURLToPath(
		new URL("./__fixtures__/resume-daemon.ts", import.meta.url),
	);
	const child = spawn(
		resolveBunExecutable(),
		["--conditions=development", entryPath],
		{
			cwd: dataDir,
			env: {
				...process.env,
				CLINE_BUILD_ENV: "development",
				CLINE_DATA_DIR: dataDir,
				CLINE_HUB_DISCOVERY_PATH: discoveryPath,
				CLINE_HUB_TEST_PORT: "0",
				CLINE_NO_INTERACTIVE: "1",
				NO_COLOR: "1",
			},
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	children.add(child);
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const exited = once(child, "exit").then(() => true);

	// A hang guard, not a timing assertion: spawning a real bun daemon on a
	// loaded hosted runner can take well over 10s.
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const parsed = JSON.parse(await readFile(discoveryPath, "utf8")) as {
				url?: string;
				authToken?: string;
			};
			if (
				typeof parsed.url === "string" &&
				typeof parsed.authToken === "string" &&
				(await fetch(toHealthUrl(parsed.url))).status === 200
			) {
				return {
					child,
					dataDir,
					discovery: { url: parsed.url, authToken: parsed.authToken },
				};
			}
		} catch {
			// Startup has not published a complete record yet.
		}
		if (await Promise.race([exited, delay(25).then(() => false)])) {
			throw new Error(`Hub daemon exited before readiness: ${stderr}`);
		}
	}
	throw new Error(`Timed out waiting for the hub daemon: ${stderr}`);
}

function connect(daemon: ReadyDaemon): HubRuntimeHost {
	const host = new HubRuntimeHost({
		url: daemon.discovery.url,
		authToken: daemon.discovery.authToken,
		clientType: "resume-e2e",
	});
	hosts.add(host);
	return host;
}

async function readStartCalls(dataDir: string): Promise<StartCall[]> {
	const raw = await readFile(join(dataDir, "start-calls.jsonl"), "utf8").catch(
		() => "",
	);
	return raw
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as StartCall);
}

function transcriptOfBytes(bytes: number): MessageWithMetadata[] {
	return [
		{ role: "user", content: "earlier prompt" },
		{
			role: "assistant",
			content: [{ type: "text", text: "x".repeat(bytes) }],
		},
	];
}

function startInput(
	sessionId: string,
	initialMessages: MessageWithMetadata[],
	resumeFromStore: boolean,
) {
	return {
		config: {
			sessionId,
			providerId: "openai",
			modelId: "gpt-4.1",
			cwd: tmpdir(),
			workspaceRoot: tmpdir(),
			systemPrompt: "system",
			mode: "act" as const,
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		source: SessionSource.DESKTOP,
		interactive: true,
		initialMessages,
		...(resumeFromStore ? { resumeFromStore } : {}),
	};
}

afterEach(async () => {
	for (const host of hosts) {
		await host.dispose().catch(() => undefined);
	}
	hosts.clear();
	for (const child of children) {
		child.kill("SIGKILL");
		await Promise.race([once(child, "exit"), delay(5_000)]).catch(
			() => undefined,
		);
	}
	children.clear();
	for (const dataDir of tempDirs) {
		await rm(dataDir, { recursive: true, force: true });
	}
	tempDirs.clear();
});

describe("resuming a transcript larger than the hub's inbound frame limit (real hub)", () => {
	const oversized = transcriptOfBytes(HUB_INBOUND_FRAME_LIMIT_BYTES + MIB);

	it("closes the connection when the transcript is sent inline", async () => {
		const daemon = await startDaemon();
		const host = connect(daemon);

		await expect(
			host.startSession(startInput("inline-oversized", oversized, false)),
		).rejects.toThrow(/1006|connection closed/i);

		// The hub never saw the request.
		await expect(readStartCalls(daemon.dataDir)).resolves.toEqual([]);
	});

	it("resumes by ID, with the hub loading its own saved history", async () => {
		const daemon = await startDaemon();
		const host = connect(daemon);

		const started = await host.startSession(
			startInput("resume-oversized", oversized, true),
		);

		expect(started.sessionId).toBe("resume-oversized");
		await expect(readStartCalls(daemon.dataDir)).resolves.toEqual([
			{
				sessionId: "resume-oversized",
				// The oversized transcript stayed in the client process.
				initialMessages: STORED_HISTORY_MESSAGES,
			},
		]);
	});

	it("answers unsupported_command to a command it does not know, as a hub without session.resume does", async () => {
		const daemon = await startDaemon();
		// Like the desktop's hub client, this one registers a workspace. Without
		// one, the hub rejects every unrecognized command before it can answer
		// unsupported_command.
		const client = new NodeHubClient({
			url: daemon.discovery.url,
			authToken: daemon.discovery.authToken,
			clientType: "resume-e2e",
			workspaceRoot: tmpdir(),
			cwd: tmpdir(),
		});
		try {
			// The client falls back to `session.create` only on this error code.
			await expect(
				client.command("session.not_a_real_command" as never, {}),
			).rejects.toMatchObject({ code: "unsupported_command" });
		} finally {
			await client.dispose();
		}
	});

	it("still sends a transcript inline when it fits and no resume was requested", async () => {
		const daemon = await startDaemon();
		const host = connect(daemon);

		await host.startSession(
			startInput("inline-small", transcriptOfBytes(1024), false),
		);

		await expect(readStartCalls(daemon.dataDir)).resolves.toEqual([
			{ sessionId: "inline-small", initialMessages: 2 },
		]);
	});
});
