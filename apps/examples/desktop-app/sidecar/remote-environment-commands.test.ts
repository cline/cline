import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	RemoteEnvironmentConnection,
	RemoteEnvironmentProfile,
	RemoteEnvironmentService,
	RemoteEnvironmentStatus,
} from "./remote-environments";
import type { SessionRuntimeBinding, SidecarContext } from "./types";

const coreCreateMock = vi.hoisted(() => vi.fn());
const hubClientConstructorMock = vi.hoisted(() => vi.fn());
const hubConnectMock = vi.hoisted(() => vi.fn());
const hubSubscribeMock = vi.hoisted(() => vi.fn());
const hubDisposeMock = vi.hoisted(() => vi.fn());
const sessionStoreGetMock = vi.hoisted(() => vi.fn());
const sessionStoreDeleteMock = vi.hoisted(() => vi.fn());
const sessionStoreRunMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineCore: {
			create: coreCreateMock,
		},
		SqliteSessionStore: class {
			public get(sessionId: string): unknown {
				return sessionStoreGetMock(sessionId);
			}

			public delete(sessionId: string, cascade?: boolean): boolean {
				return sessionStoreDeleteMock(sessionId, cascade);
			}

			public run(sql: string, params?: unknown[]): void {
				sessionStoreRunMock(sql, params);
			}
		},
		NodeHubClient: class {
			public constructor(options: unknown) {
				hubClientConstructorMock(options);
			}

			public connect(): Promise<void> {
				return hubConnectMock();
			}

			public subscribe(listener: unknown): () => void {
				return hubSubscribeMock(listener);
			}

			public dispose(): Promise<void> {
				return hubDisposeMock();
			}
		},
	};
});

const profile: RemoteEnvironmentProfile = {
	id: "remote-1",
	name: "Build box",
	host: "build.example.com",
	user: "alice",
	port: 2222,
	createdAt: "2026-08-06T12:00:00.000Z",
	updatedAt: "2026-08-06T12:00:00.000Z",
};

const connection: RemoteEnvironmentConnection = {
	profile,
	profileId: profile.id,
	state: "connected",
	endpoint: "ws://127.0.0.1:40123/hub",
	authToken: "remote-hub-token",
	workspaceRoot: "/home/alice",
	homeDir: "/home/alice",
	platform: "linux",
	arch: "arm64",
	remoteHubUrl: "ws://127.0.0.1:25463/hub",
	localPort: 40123,
	connectedAt: "2026-08-06T12:01:00.000Z",
};

const secondProfile: RemoteEnvironmentProfile = {
	...profile,
	id: "remote-2",
	name: "Test box",
	host: "test.example.com",
	updatedAt: "2026-08-06T12:02:00.000Z",
};

const secondConnection: RemoteEnvironmentConnection = {
	...connection,
	profile: secondProfile,
	profileId: secondProfile.id,
	endpoint: "ws://127.0.0.1:40124/hub",
	authToken: "second-remote-hub-token",
	workspaceRoot: "/home/tester",
	homeDir: "/home/tester",
	remoteHubUrl: "ws://127.0.0.1:25464/hub",
	localPort: 40124,
	connectedAt: "2026-08-06T12:03:00.000Z",
};

type FakeService = {
	service: RemoteEnvironmentService;
	list: ReturnType<typeof vi.fn>;
	upsert: ReturnType<typeof vi.fn>;
	test: ReturnType<typeof vi.fn>;
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
	run: ReturnType<typeof vi.fn>;
};

function createFakeService(
	availableConnections: RemoteEnvironmentConnection[] = [connection],
): FakeService {
	const profiles = availableConnections.map((item) => item.profile);
	const availableById = new Map(
		availableConnections.map((item) => [item.profileId, item]),
	);
	const connectedById = new Map<string, RemoteEnvironmentConnection>();
	let activeProfileId: string | undefined;
	const list = vi.fn(async () => profiles);
	const upsert = vi.fn(async () => profile);
	const test = vi.fn(
		async (): Promise<RemoteEnvironmentStatus> => ({
			profileId: profile.id,
			state: "available",
			updatedAt: "2026-08-06T12:00:30.000Z",
			message: "SSH connection succeeded",
			remotePlatform: "linux",
			remoteArch: "arm64",
		}),
	);
	const connect = vi.fn(async (id: string) => {
		const next = availableById.get(id);
		if (!next) throw new Error(`Unknown fake remote environment: ${id}`);
		connectedById.set(id, next);
		activeProfileId = id;
		return next;
	});
	const disconnect = vi.fn(async (id?: string) => {
		const targetId = id ?? activeProfileId;
		if (!targetId) return false;
		const deleted = connectedById.delete(targetId);
		if (activeProfileId === targetId) activeProfileId = undefined;
		return deleted;
	});
	const deleteProfile = vi.fn(async () => true);
	const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
	const service = {
		list,
		upsert,
		test,
		connect,
		disconnect,
		delete: deleteProfile,
		run,
		getActive: vi.fn(() =>
			activeProfileId ? connectedById.get(activeProfileId) : undefined,
		),
		getConnection: vi.fn((id: string) => connectedById.get(id)),
		activateConnection: vi.fn((id: string) => {
			if (!connectedById.has(id)) return false;
			activeProfileId = id;
			return true;
		}),
		getStatuses: vi.fn(() => []),
	} as unknown as RemoteEnvironmentService;
	return {
		service,
		list,
		upsert,
		test,
		connect,
		disconnect,
		delete: deleteProfile,
		run,
	};
}

function createManager() {
	const unsubscribe = vi.fn();
	const manager = {
		subscribe: vi.fn(() => unsubscribe),
		dispose: vi.fn(async () => undefined),
	};
	return { manager, unsubscribe };
}

function attachEventRecorder(ctx: SidecarContext): ReturnType<typeof vi.fn> {
	const send = vi.fn();
	ctx.wsClients.add({ send });
	return send;
}

function readEvent(send: ReturnType<typeof vi.fn>, index: number) {
	return JSON.parse(String(send.mock.calls[index]?.[0]));
}

function createExistingRemoteBinding(
	environmentId: string,
): SessionRuntimeBinding {
	const sessionManager = {
		dispose: vi.fn(async () => undefined),
	} as unknown as SessionRuntimeBinding["sessionManager"] & {
		dispose: ReturnType<typeof vi.fn>;
	};
	const hubClient = {
		dispose: vi.fn(async () => undefined),
	} as unknown as SessionRuntimeBinding["hubClient"] & {
		dispose: ReturnType<typeof vi.fn>;
	};
	return {
		environmentId,
		kind: "ssh",
		workspaceRoot: "/old/workspace",
		sessionManager,
		hubClient,
		unsubscribeSessionEvents: vi.fn(),
	};
}

describe("remote environment command routing", () => {
	beforeEach(() => {
		coreCreateMock.mockReset();
		hubClientConstructorMock.mockReset();
		hubConnectMock.mockReset();
		hubSubscribeMock.mockReset();
		hubDisposeMock.mockReset();
		sessionStoreGetMock.mockReset();
		sessionStoreDeleteMock.mockReset();
		sessionStoreRunMock.mockReset();
		hubConnectMock.mockResolvedValue(undefined);
		hubSubscribeMock.mockReturnValue(() => undefined);
		hubDisposeMock.mockResolvedValue(undefined);
		sessionStoreGetMock.mockReturnValue(undefined);
		sessionStoreDeleteMock.mockReturnValue(false);
	});

	it("routes list, upsert, and SSH test commands through the configured service", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService();
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;

		await expect(
			handleCommand(ctx, "list_remote_environments"),
		).resolves.toEqual({
			profiles: [profile],
			activeEnvironmentId: "local",
			activeProfileId: null,
			statuses: [],
		});

		const input = {
			id: profile.id,
			name: "Build box renamed",
			host: profile.host,
		};
		await expect(
			handleCommand(ctx, "upsert_remote_environment", { profile: input }),
		).resolves.toEqual({ profile });
		expect(fake.upsert).toHaveBeenCalledWith(input);

		await expect(
			handleCommand(ctx, "test_remote_environment", { id: ` ${profile.id} ` }),
		).resolves.toEqual({
			profile,
			status: "passed",
			message: "SSH connection succeeded",
			remotePlatform: "linux",
			remoteArch: "arm64",
		});
		expect(fake.test).toHaveBeenCalledWith(profile.id);
	});

	it("connects an authenticated remote runtime, records its binding, and disconnects it cleanly", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService();
		const { manager, unsubscribe } = createManager();
		coreCreateMock.mockResolvedValue(manager);
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;
		const send = attachEventRecorder(ctx);

		await expect(
			handleCommand(ctx, "connect_remote_environment", {
				id: profile.id,
			}),
		).resolves.toEqual({
			profile,
			status: "connected",
			environmentId: profile.id,
			activeEnvironmentId: profile.id,
			activeProfileId: profile.id,
			workspaceRoot: "/home/alice",
			homeDir: "/home/alice",
			remotePlatform: "linux",
			remoteArch: "arm64",
		});

		expect(fake.connect).toHaveBeenCalledWith(profile.id);
		expect(coreCreateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				clientName: "cline-code",
				backendMode: "remote",
				remote: {
					endpoint: connection.endpoint,
					authToken: connection.authToken,
					workspaceRoot: connection.workspaceRoot,
					cwd: connection.workspaceRoot,
					clientType: "code-sidecar-ssh",
					displayName: "Code App (Build box)",
				},
			}),
		);
		expect(hubClientConstructorMock).toHaveBeenCalledWith({
			url: connection.endpoint,
			authToken: connection.authToken,
			clientType: "code-sidecar-ssh-observer",
			displayName: "Code App observer (Build box)",
			workspaceRoot: connection.workspaceRoot,
			cwd: connection.workspaceRoot,
		});
		expect(ctx.activeEnvironmentId).toBe(profile.id);
		expect(ctx.runtimeBindings.get(profile.id)).toMatchObject({
			environmentId: profile.id,
			kind: "ssh",
			workspaceRoot: connection.workspaceRoot,
			remote: connection,
		});
		expect(readEvent(send, 0)).toEqual({
			type: "event",
			event: {
				name: "remote_environment_changed",
				payload: {
					profile,
					status: "connected",
					environmentId: profile.id,
					activeEnvironmentId: profile.id,
					activeProfileId: profile.id,
					workspaceRoot: "/home/alice",
					homeDir: "/home/alice",
					remotePlatform: "linux",
					remoteArch: "arm64",
				},
			},
		});

		await expect(
			handleCommand(ctx, "disconnect_remote_environment"),
		).resolves.toEqual({
			status: "disconnected",
			disconnectedProfileId: profile.id,
			activeEnvironmentId: "local",
			activeProfileId: null,
		});
		expect(fake.disconnect).toHaveBeenCalledWith(profile.id);
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(manager.dispose).toHaveBeenCalledWith(
			"code_sidecar_remote_disconnect",
		);
		expect(hubDisposeMock).toHaveBeenCalledOnce();
		expect(ctx.runtimeBindings.has(profile.id)).toBe(false);
		expect(ctx.activeEnvironmentId).toBe("local");
		expect(readEvent(send, 1)).toEqual({
			type: "event",
			event: {
				name: "remote_environment_changed",
				payload: {
					status: "disconnected",
					activeProfileId: null,
					activeEnvironmentId: "local",
					environmentId: "local",
					workspaceRoot: "/local/project",
				},
			},
		});
	});

	it("rolls back the SSH tunnel and partial runtime when observer authentication fails", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService();
		const { manager, unsubscribe } = createManager();
		coreCreateMock.mockResolvedValue(manager);
		hubConnectMock.mockRejectedValue(new Error("remote auth rejected"));
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;
		const send = attachEventRecorder(ctx);

		await expect(
			handleCommand(ctx, "connect_remote_environment", { id: profile.id }),
		).rejects.toThrow("remote auth rejected");

		expect(fake.disconnect).toHaveBeenCalledWith(profile.id);
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(manager.dispose).toHaveBeenCalledWith(
			"code_sidecar_remote_initialization_failed",
		);
		expect(hubDisposeMock).toHaveBeenCalledOnce();
		expect(ctx.runtimeBindings.has(profile.id)).toBe(false);
		expect(ctx.activeEnvironmentId).toBe("local");
		expect(send).not.toHaveBeenCalled();
	});

	it("preserves the previous environment when switching hosts fails", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService([connection, secondConnection]);
		const firstRuntime = createManager();
		const failedRuntime = createManager();
		coreCreateMock
			.mockResolvedValueOnce(firstRuntime.manager)
			.mockResolvedValueOnce(failedRuntime.manager);
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;
		const send = attachEventRecorder(ctx);

		await handleCommand(ctx, "connect_remote_environment", { id: profile.id });
		const firstBinding = ctx.runtimeBindings.get(profile.id);
		send.mockClear();
		hubConnectMock.mockRejectedValueOnce(
			new Error("second host auth rejected"),
		);

		await expect(
			handleCommand(ctx, "connect_remote_environment", {
				id: secondProfile.id,
			}),
		).rejects.toThrow("second host auth rejected");

		expect(ctx.activeEnvironmentId).toBe(profile.id);
		expect(ctx.runtimeBindings.get(profile.id)).toBe(firstBinding);
		expect(ctx.runtimeBindings.has(secondProfile.id)).toBe(false);
		expect(fake.service.getActive()?.profileId).toBe(profile.id);
		expect(fake.disconnect).toHaveBeenCalledWith(secondProfile.id);
		expect(fake.disconnect).not.toHaveBeenCalledWith(profile.id);
		expect(firstRuntime.unsubscribe).not.toHaveBeenCalled();
		expect(firstRuntime.manager.dispose).not.toHaveBeenCalled();
		expect(failedRuntime.unsubscribe).toHaveBeenCalledOnce();
		expect(failedRuntime.manager.dispose).toHaveBeenCalledWith(
			"code_sidecar_remote_initialization_failed",
		);
		expect(send).not.toHaveBeenCalled();

		await expect(
			handleCommand(ctx, "list_remote_environments"),
		).resolves.toMatchObject({
			activeEnvironmentId: profile.id,
			activeProfileId: profile.id,
		});
	});

	it("retires the previous runtime only after a host switch commits", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService([connection, secondConnection]);
		const firstRuntime = createManager();
		const secondRuntime = createManager();
		coreCreateMock
			.mockResolvedValueOnce(firstRuntime.manager)
			.mockResolvedValueOnce(secondRuntime.manager);
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;

		await handleCommand(ctx, "connect_remote_environment", { id: profile.id });
		await expect(
			handleCommand(ctx, "connect_remote_environment", {
				id: secondProfile.id,
			}),
		).resolves.toMatchObject({
			environmentId: secondProfile.id,
			activeEnvironmentId: secondProfile.id,
			activeProfileId: secondProfile.id,
		});

		expect(ctx.activeEnvironmentId).toBe(secondProfile.id);
		expect(ctx.runtimeBindings.has(profile.id)).toBe(false);
		expect(ctx.runtimeBindings.has(secondProfile.id)).toBe(true);
		expect(firstRuntime.unsubscribe).toHaveBeenCalledOnce();
		expect(firstRuntime.manager.dispose).toHaveBeenCalledWith(
			"code_sidecar_remote_disconnect",
		);
		expect(secondRuntime.manager.dispose).not.toHaveBeenCalled();
		expect(fake.disconnect).toHaveBeenCalledWith(profile.id);
		expect(fake.service.getActive()?.profileId).toBe(secondProfile.id);
	});

	it("disconnecting an inactive profile does not switch the active environment", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService([connection, secondConnection]);
		await fake.service.connect(profile.id);
		await fake.service.connect(secondProfile.id);
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;
		ctx.runtimeBindings.set(
			profile.id,
			createExistingRemoteBinding(profile.id),
		);
		ctx.runtimeBindings.set(
			secondProfile.id,
			createExistingRemoteBinding(secondProfile.id),
		);
		ctx.activeEnvironmentId = secondProfile.id;
		const send = attachEventRecorder(ctx);

		await expect(
			handleCommand(ctx, "disconnect_remote_environment", { id: profile.id }),
		).resolves.toEqual({
			status: "disconnected",
			disconnectedProfileId: profile.id,
			activeEnvironmentId: secondProfile.id,
			activeProfileId: secondProfile.id,
		});

		expect(ctx.activeEnvironmentId).toBe(secondProfile.id);
		expect(ctx.runtimeBindings.has(secondProfile.id)).toBe(true);
		expect(fake.service.getActive()?.profileId).toBe(secondProfile.id);
		expect(send).not.toHaveBeenCalled();
	});

	it("deletes a profile only after removing its runtime binding", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService();
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;
		const send = attachEventRecorder(ctx);
		const binding = createExistingRemoteBinding(profile.id);
		ctx.runtimeBindings.set(profile.id, binding);
		ctx.activeEnvironmentId = profile.id;

		await expect(
			handleCommand(ctx, "delete_remote_environment", { id: profile.id }),
		).resolves.toEqual({
			deleted: true,
			activeEnvironmentId: "local",
			activeProfileId: null,
		});

		expect(binding.unsubscribeSessionEvents).toHaveBeenCalledOnce();
		expect(binding.sessionManager.dispose).toHaveBeenCalledWith(
			"code_sidecar_remote_disconnect",
		);
		expect(binding.hubClient.dispose).toHaveBeenCalledOnce();
		expect(fake.delete).toHaveBeenCalledWith(profile.id);
		expect(ctx.runtimeBindings.has(profile.id)).toBe(false);
		expect(ctx.activeEnvironmentId).toBe("local");
		expect(readEvent(send, 0)).toEqual({
			type: "event",
			event: {
				name: "remote_environment_changed",
				payload: {
					status: "disconnected",
					activeProfileId: null,
					activeEnvironmentId: "local",
					environmentId: "local",
					workspaceRoot: "/local/project",
					reason: "profile_deleted",
				},
			},
		});
	});

	it("routes remote workspace browsing and operations to the explicitly selected directory", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const fake = createFakeService();
		const ctx = createSidecarContext("/local/project");
		ctx.remoteEnvironments = fake.service;
		ctx.runtimeBindings.set(
			profile.id,
			createExistingRemoteBinding(profile.id),
		);
		expect(ctx.activeEnvironmentId).toBe("local");

		fake.run.mockImplementation(async (_id, input) => {
			if (input.command === "pwd") {
				return { stdout: "/srv/code\n", stderr: "", exitCode: 0 };
			}
			if (input.command === "sh") {
				return {
					stdout: "/srv/code/zeta\0/srv/code/project\0",
					stderr: "",
					exitCode: 0,
				};
			}
			if (input.command === "git" && input.args[0] === "ls-files") {
				return {
					stdout: "src/remote.ts\nREADME.md\n",
					stderr: "",
					exitCode: 0,
				};
			}
			if (input.command === "git" && input.args[0] === "branch") {
				return { stdout: "feature/ssh\n", stderr: "", exitCode: 0 };
			}
			return { stdout: "main\nfeature/ssh\n", stderr: "", exitCode: 0 };
		});

		await expect(
			handleCommand(ctx, "list_workspace_directories", {
				environmentId: profile.id,
				path: "/srv/code",
			}),
		).resolves.toEqual({
			environmentId: profile.id,
			currentPath: "/srv/code",
			parentPath: "/srv",
			entries: [
				{ name: "project", path: "/srv/code/project" },
				{ name: "zeta", path: "/srv/code/zeta" },
			],
			truncated: false,
		});
		expect(fake.run).toHaveBeenCalledWith(profile.id, {
			command: "pwd",
			args: ["-P"],
			cwd: "/srv/code",
		});
		const listInvocation = fake.run.mock.calls.find(
			([, input]) => input.command === "sh",
		)?.[1];
		expect(listInvocation).toMatchObject({
			command: "sh",
			args: [
				"-c",
				expect.stringContaining("find -L"),
				"cline-list-workspace-directories",
				"/srv/code",
			],
		});
		expect(String(listInvocation?.args[1])).not.toContain("/srv/code");

		await expect(
			handleCommand(ctx, "validate_workspace_directory", {
				environmentId: profile.id,
				path: "/srv/code/project",
			}),
		).resolves.toEqual({ environmentId: profile.id, valid: true });
		expect(fake.run).toHaveBeenCalledWith(profile.id, {
			command: "test",
			args: ["-d", "/srv/code/project"],
		});

		await expect(
			handleCommand(ctx, "search_workspace_files", {
				environmentId: profile.id,
				workspaceRoot: "/srv/code/project",
				query: "remote",
			}),
		).resolves.toEqual(["src/remote.ts"]);
		expect(fake.run).toHaveBeenCalledWith(profile.id, {
			command: "git",
			args: ["ls-files", "--cached", "--others", "--exclude-standard"],
			cwd: "/srv/code/project",
		});

		await expect(
			handleCommand(ctx, "get_git_branch", {
				environmentId: profile.id,
				cwd: "/srv/code/project",
			}),
		).resolves.toEqual({
			environmentId: profile.id,
			branch: "feature/ssh",
		});
		expect(fake.run).toHaveBeenCalledWith(profile.id, {
			command: "git",
			args: ["branch", "--show-current"],
			cwd: "/srv/code/project",
		});
	});

	it("lists and bounds local workspace directories through the local binding", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const temporaryRoot = mkdtempSync(join(tmpdir(), "cline-workspaces-"));
		try {
			for (let index = 0; index < 201; index += 1) {
				mkdirSync(
					join(temporaryRoot, `project-${String(index).padStart(3, "0")}`),
				);
			}
			writeFileSync(join(temporaryRoot, "not-a-directory.txt"), "ignored");
			const ctx = createSidecarContext("/local/project");
			ctx.runtimeBindings.set("local", {
				...createExistingRemoteBinding("local"),
				kind: "local",
				workspaceRoot: "/local/project",
			});

			const currentPath = realpathSync(temporaryRoot);
			await expect(
				handleCommand(ctx, "list_workspace_directories", {
					environmentId: "local",
					path: temporaryRoot,
				}),
			).resolves.toEqual({
				environmentId: "local",
				currentPath,
				parentPath: realpathSync(tmpdir()),
				entries: expect.arrayContaining([
					{
						name: "project-000",
						path: join(currentPath, "project-000"),
					},
				]),
				truncated: true,
			});
			const result = (await handleCommand(ctx, "list_workspace_directories", {
				environmentId: "local",
				path: temporaryRoot,
			})) as { entries: unknown[] };
			expect(result.entries).toHaveLength(200);
		} finally {
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	});

	it("routes session reads, title updates, and deletes to the requested environment", async () => {
		const { handleCommand } = await import("./commands");
		const { createSidecarContext } = await import("./context");
		const ctx = createSidecarContext("/local/project");
		const readMessages = vi.fn(async () => [
			{ role: "user", content: "remote session message" },
		]);
		const update = vi.fn(async () => ({ updated: true }));
		const deleteSession = vi.fn(async () => true);
		const sessionManager = {
			readMessages,
			update,
			delete: deleteSession,
			dispose: vi.fn(async () => undefined),
		} as unknown as SessionRuntimeBinding["sessionManager"];
		ctx.runtimeBindings.set(profile.id, {
			...createExistingRemoteBinding(profile.id),
			sessionManager,
		});
		expect(ctx.activeEnvironmentId).toBe("local");

		await expect(
			handleCommand(ctx, "read_session_messages", {
				environmentId: profile.id,
				sessionId: "remote-session",
			}),
		).resolves.toHaveLength(1);
		expect(readMessages).toHaveBeenCalledWith("remote-session");

		ctx.liveSessions.set("same-id", {
			environmentId: "local",
			config: {},
			messages: [{ role: "user", content: "local-only message" }],
			promptsInQueue: [],
			busy: false,
			startedAt: Date.now(),
			status: "idle",
		});
		readMessages.mockResolvedValueOnce([]);
		await expect(
			handleCommand(ctx, "read_session_messages", {
				environmentId: profile.id,
				sessionId: "same-id",
			}),
		).resolves.toEqual([]);

		await expect(
			handleCommand(ctx, "update_chat_session_title", {
				environmentId: profile.id,
				sessionId: "remote-session",
				title: "Remote title",
			}),
		).resolves.toBe(true);
		expect(update).toHaveBeenCalledWith("remote-session", {
			title: "Remote title",
		});

		await expect(
			handleCommand(ctx, "delete_chat_session", {
				environmentId: profile.id,
				sessionId: "remote-session",
			}),
		).resolves.toBe(true);
		expect(deleteSession).toHaveBeenCalledWith("remote-session");
		expect(sessionStoreDeleteMock).not.toHaveBeenCalled();
	});
});
