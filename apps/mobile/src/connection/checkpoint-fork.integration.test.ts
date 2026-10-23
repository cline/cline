import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startTestHub } from "@cline/hub-testkit";
import { expect, it, vi } from "vitest";
import type { SessionHandle } from "../session";
import { waitFor } from "../session/__testing__/test-hub-handle";
import { CloudLaunches } from "./cloud-launches";
import { SessionConnectionController } from "./controller";
import { createLocalSessionHandle } from "./local-handle";

const run = promisify(execFile);

it("forks checkpoint history through the real Hub without changing files or losing question ownership", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mobile-checkpoint-"));
	const git = (...args: string[]) => run("git", ["-C", cwd, ...args]);
	await git("init");
	await writeFile(join(cwd, "example.txt"), "original");
	await git("add", "example.txt");
	await git(
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"-m",
		"Initial fixture",
	);
	const ref = (await git("rev-parse", "HEAD")).stdout.trim();
	await writeFile(join(cwd, "example.txt"), "current work");
	const hub = await startTestHub({
		workspaceRoot: cwd,
		script: [{ kind: "text", chunks: ["First answer"] }],
	});
	// The scripted runtime omits persisted metadata/initial messages. Supply those
	// storage fields while retaining real Hub restore, ACLs, sockets, and Git refs.
	const records = new Map<
		string,
		{ metadata: Record<string, unknown>; initialMessages?: unknown[] }
	>();
	const start = hub.runtimeHost.startSession.bind(hub.runtimeHost);
	vi.spyOn(hub.runtimeHost, "startSession").mockImplementation(
		async (input) => {
			const result = (await start(input)) as { sessionId: string };
			const extra = input as typeof input & {
				sessionMetadata?: Record<string, unknown>;
				initialMessages?: unknown[];
				config: Record<string, unknown>;
			};
			records.set(result.sessionId, {
				metadata: {
					...extra.sessionMetadata,
					systemPrompt: extra.config.systemPrompt,
					mode: extra.config.mode,
				},
				initialMessages: extra.initialMessages,
			});
			return result;
		},
	);
	const get = hub.runtimeHost.getSession.bind(hub.runtimeHost);
	vi.spyOn(hub.runtimeHost, "getSession").mockImplementation(async (id) => {
		const record = await get(id);
		return record
			? { ...(record as object), metadata: records.get(id)?.metadata }
			: undefined;
	});
	const messages = hub.runtimeHost.readSessionMessages.bind(hub.runtimeHost);
	vi.spyOn(hub.runtimeHost, "readSessionMessages").mockImplementation(
		async (id) => records.get(id)?.initialMessages ?? messages(id),
	);
	const handles: SessionHandle[] = [];
	const descriptor = {
		mode: "local" as const,
		url: hub.url,
		authToken: hub.authToken,
	};
	const source = new SessionConnectionController(descriptor, {
		createHandle: async () => {
			const handle = await createLocalSessionHandle({
				url: hub.url,
				authToken: hub.authToken,
				workspaceRoot: cwd,
				createNewSession: true,
			});
			if (handles.length === 1) {
				const command = handle.client.command.bind(handle.client);
				let failHydration = true;
				vi.spyOn(handle.client, "command").mockImplementation((...args) => {
					if (
						args[0] === "session.attach" &&
						handle.hubSessionId &&
						failHydration
					) {
						failHydration = false;
						return Promise.reject(
							new Error("Temporary history connection failure"),
						);
					}
					return command(...args);
				});
			}
			handles.push(handle);
			return handle;
		},
	});
	const retained = new CloudLaunches();
	let fork: Awaited<ReturnType<typeof source.forkAtCheckpoint>> | undefined;
	try {
		await source.start();
		await source.sendInput("First request");
		hub.script([{ kind: "text", chunks: ["Second answer"] }]);
		await source.sendInput("Second request");
		const sourceId = source.getSnapshot().sessionId!;
		const checkpoint = { ref, createdAt: 1, runCount: 2, kind: "commit" };
		records.get(sourceId)!.metadata.checkpoint = {
			latest: checkpoint,
			history: [checkpoint],
		};
		expect(await source.listCheckpoints()).toEqual([checkpoint]);
		fork = await source.forkAtCheckpoint(2);
		expect(fork.sessionId).not.toBe(sourceId);
		expect(fork.controller.getSnapshot().status.phase).toBe("error");
		expect(await readFile(join(cwd, "example.txt"), "utf8")).toBe(
			"current work",
		);
		const restored = await hub.runtimeHost.readSessionMessages(fork.sessionId);
		expect(JSON.stringify(restored)).toContain("First request");
		expect(JSON.stringify(restored)).not.toContain("Second request");
		expect(records.get(fork.sessionId)?.metadata).toMatchObject({
			forkedFromSessionId: sourceId,
			mode: "act",
		});
		retained.retain(fork.descriptor, fork.controller);
		const lease = retained.open(fork.descriptor)!;
		expect(lease.controller).toBe(fork.controller);
		source.dispose();
		await fork.controller.reconnect();
		expect(fork.controller.getSnapshot().status.phase).toBe("ready");
		expect(await fork.controller.listCheckpoints()).toBeDefined();
		lease.release();
		const owner = handles[1]!.client;
		const question = owner.command(
			"capability.request",
			{
				sessionId: fork.sessionId,
				targetClientId: owner.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Continue fork?", ["Yes", "No"]] },
			},
			fork.sessionId,
		);
		await waitFor(
			() => fork!.controller.getSnapshot().view.pendingQuestions.length === 1,
			"fork owns its question",
		);
		await fork.controller.respondQuestion(
			fork.controller.getSnapshot().view.pendingQuestions[0]!.requestId,
			"Yes",
		);
		expect((await question).payload).toEqual({ result: "Yes" });
	} finally {
		source.dispose();
		fork?.controller.dispose();
		retained.clear();
		await hub.close();
		await rm(cwd, { recursive: true, force: true });
	}
});
