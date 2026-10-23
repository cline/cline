import type {
	HubClient,
	HubSocketRequestOptions,
	WebSocketLike,
} from "@cline/hub-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSessionApiError } from "../cloud/rest/CloudSessionGateway";
import {
	asRemoteSessionId,
	FakeRemoteSessionGateway,
	type HubClientFactory,
	type RemoteSession,
} from "../session";
import {
	buildCloudCreateSessionInput,
	buildCloudHubClientOptions,
	createCloudSessionHandle,
	NoCloudSessionsError,
	RefreshingCloudHubClient,
} from "./cloud-handle";

describe("buildCloudCreateSessionInput", () => {
	it("uses the canonical task identity and its desktop backup branch", () => {
		const input = buildCloudCreateSessionInput(
			"m",
			"tsk-12345678",
			"ses-other",
		);
		expect(input.sessionConfig).toMatchObject({ sessionId: "tsk-12345678" });
		const prompt = (input.sessionConfig as { systemPrompt: string })
			.systemPrompt;
		expect(prompt).toContain("cline/12345678");
		expect(prompt).toContain("git push -u origin cline/12345678");
		expect(prompt).toContain("never commit directly to the default branch");
		expect(prompt).toContain("Do not force-push or amend commits");
	});
	it("keeps resumable work local until the user asks to commit or push", () => {
		const input = buildCloudCreateSessionInput(
			"m",
			"task-12345678",
			"outer",
			"resumable",
		);
		const prompt = (input.sessionConfig as { systemPrompt: string })
			.systemPrompt;
		expect(prompt).toContain("cline/12345678");
		expect(prompt).toContain("Commit and push only when the user asks.");
		expect(prompt).not.toContain("git push -u");
		expect(prompt).not.toContain("commit to it freely");
	});
	it("matches the Cline desktop inner-session contract", () => {
		expect(buildCloudCreateSessionInput(" anthropic/claude ")).toMatchObject({
			workspaceRoot: "/workspace",
			cwd: "/workspace",
			sessionConfig: {
				providerId: "cline",
				modelId: "anthropic/claude",
				workspaceRoot: "/workspace",
				cwd: "/workspace",
				mode: "act",
				enableTools: true,
			},
			metadata: {
				source: "mobile",
				provider: "cline",
				model: "anthropic/claude",
				interactive: true,
			},
			runtimeOptions: { mode: "act" },
			modelSelection: { provider: "cline", model: "anthropic/claude" },
			toolPolicies: { "*": { autoApprove: true } },
		});
	});

	it("refuses to create a cloud ClineCore session without a model", () => {
		expect(() => buildCloudCreateSessionInput("  ")).toThrow(
			"missing its model id",
		);
	});

	it("keeps GitHub auth guidance inside the full Cline prompt", () => {
		const input = buildCloudCreateSessionInput("anthropic/claude");
		const prompt = (input.sessionConfig as { systemPrompt: string })
			.systemPrompt;
		expect(prompt).toContain("You are Cline");
		expect(prompt).toContain(
			"GitHub API authentication is handled automatically",
		);
		expect(prompt.length).toBeGreaterThan(1_000);
	});
});

/** A minimal HubClient stand-in: enough for resolveCloudSession to run. */
function fakeClient(): HubClient {
	return {
		connect: vi.fn(async () => {}),
		command: vi.fn(async () => ({
			payload: { sessions: [{ sessionId: "inner-existing" }] },
		})),
		close: vi.fn(),
		isConnected: () => true,
	} as unknown as HubClient;
}

function remoteSession(
	overrides: Partial<RemoteSession> & Pick<RemoteSession, "id">,
): RemoteSession {
	return {
		sandboxUrl: `https://core-api.test/api/v1/session/${overrides.id}`,
		status: "running",
		expiredAt: null,
		...overrides,
	};
}

describe("buildCloudHubClientOptions", () => {
	it("uses bearer-header auth and prefixes the JWT with workos:", () => {
		const options = buildCloudHubClientOptions({
			url: "wss://core-api.test/api/v1/session/ses-1",
			jwt: "cline-jwt",
		});
		expect(options.authMode).toBe("bearer-header");
		expect(options.credential).toBe("workos:cline-jwt");
		expect(options.clientType).toBe("cline-mobile");
		expect(options.displayName).toBe("Cline");
	});

	it("does not double the workos: prefix", () => {
		expect(
			buildCloudHubClientOptions({ url: "wss://x", jwt: "workos:already" })
				.credential,
		).toBe("workos:already");
	});
});

class AuthRecordingSocket implements WebSocketLike {
	static instances: AuthRecordingSocket[] = [];
	readyState = 0;
	private readonly listeners = new Map<
		string,
		Set<(...args: unknown[]) => void>
	>();

	constructor(
		readonly url: string,
		readonly protocols?: string | string[],
		readonly requestOptions?: HubSocketRequestOptions,
	) {
		AuthRecordingSocket.instances.push(this);
	}

	addEventListener(type: string, listener: (...args: unknown[]) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			envelope?: { command?: string; requestId?: string };
		};
		if (frame.envelope?.command !== "client.register") return;
		queueMicrotask(() =>
			this.emit("message", {
				data: JSON.stringify({
					kind: "reply",
					envelope: {
						version: "v1",
						requestId: frame.envelope?.requestId,
						ok: true,
						payload: {},
					},
				}),
			}),
		);
	}

	open(): void {
		this.readyState = 1;
		this.emit("open");
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	private emit(type: string, payload?: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(payload);
	}
}

describe("RefreshingCloudHubClient", () => {
	afterEach(() => vi.useRealTimers());

	it.each([
		"suspended",
		"stopped",
		"expired",
		"failed",
		"missing",
		"missing token",
		401,
		403,
		404,
		410,
	] as const)("stops automatic retries for %s", async (status) => {
		vi.useFakeTimers();
		AuthRecordingSocket.instances = [];
		let remote: RemoteSession | undefined = remoteSession({
			id: asRemoteSessionId("ses-1"),
		});
		const getRemote = vi.fn(async () => remote);
		const getAccessToken = vi
			.fn<() => Promise<string | null>>()
			.mockResolvedValue("jwt");
		const onConnectionState = vi.fn();
		const client = new RefreshingCloudHubClient(
			{
				...buildCloudHubClientOptions({
					url: "wss://core-api.test/session/ses-1",
					jwt: "",
					WebSocketImpl: AuthRecordingSocket,
				}),
				onConnectionState,
			},
			getAccessToken,
			getRemote,
		);
		try {
			const connecting = client.connect();
			await vi.advanceTimersByTimeAsync(0);
			AuthRecordingSocket.instances[0]?.open();
			await connecting;
			client.subscribe(() => {});
			if (typeof status === "number") {
				getRemote.mockRejectedValue(
					new CloudSessionApiError("Workspace unavailable", status),
				);
			} else if (status === "missing token") {
				getAccessToken.mockResolvedValue(null);
			} else {
				remote = status === "missing" ? undefined : { ...remote, status };
			}
			AuthRecordingSocket.instances[0]?.close();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(AuthRecordingSocket.instances).toHaveLength(1);
			expect(getRemote).toHaveBeenCalledTimes(2);
			expect(onConnectionState).toHaveBeenLastCalledWith(
				expect.objectContaining({ state: "closed" }),
			);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			client.close();
		}
	});

	it.each([
		"provisioning",
		"network failure",
		429,
		503,
	] as const)("retries status checks after %s and reconnects once running", async (state) => {
		vi.useFakeTimers();
		AuthRecordingSocket.instances = [];
		const running = remoteSession({ id: asRemoteSessionId("ses-1") });
		const getRemote = vi
			.fn<() => Promise<RemoteSession>>()
			.mockResolvedValue(running);
		const client = new RefreshingCloudHubClient(
			buildCloudHubClientOptions({
				url: "wss://core-api.test/session/ses-1",
				jwt: "",
				WebSocketImpl: AuthRecordingSocket,
			}),
			async () => "jwt",
			getRemote,
		);
		try {
			const connecting = client.connect();
			await vi.advanceTimersByTimeAsync(0);
			AuthRecordingSocket.instances[0]?.open();
			await connecting;
			client.subscribe(() => {});
			if (state === "provisioning")
				getRemote.mockResolvedValue({ ...running, status: "provisioning" });
			else if (typeof state === "number")
				getRemote.mockRejectedValue(
					new CloudSessionApiError("Try again later", state),
				);
			else getRemote.mockRejectedValue(new Error("offline"));
			AuthRecordingSocket.instances[0]?.close();
			await vi.advanceTimersByTimeAsync(2_000);
			expect(AuthRecordingSocket.instances).toHaveLength(1);
			expect(getRemote.mock.calls.length).toBeGreaterThan(1);
			getRemote.mockResolvedValue(running);
			await vi.advanceTimersByTimeAsync(5_000);
			expect(AuthRecordingSocket.instances).toHaveLength(2);
			AuthRecordingSocket.instances[1]?.open();
			await vi.advanceTimersByTimeAsync(0);
			expect(client.isConnected()).toBe(true);
			expect(client.getConnectionEpoch()).toBe(2);
		} finally {
			client.close();
		}
	});

	it("does not reopen a client closed while credentials are refreshing", async () => {
		AuthRecordingSocket.instances = [];
		let resolveToken!: (token: string) => void;
		const token = new Promise<string>((resolve) => {
			resolveToken = resolve;
		});
		const getAccessToken = vi.fn(() => token);
		const client = new RefreshingCloudHubClient(
			buildCloudHubClientOptions({
				url: "wss://core-api.test/session/ses-1",
				jwt: "",
				WebSocketImpl: AuthRecordingSocket,
			}),
			getAccessToken,
			async () => remoteSession({ id: asRemoteSessionId("ses-1") }),
		);
		const connecting = client.connect();
		await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalledOnce());
		client.close();
		resolveToken("jwt");
		await expect(connecting).rejects.toThrow("Cloud connection closed");
		expect(AuthRecordingSocket.instances).toHaveLength(0);
	});

	it("uses a fresh bearer token for each socket attempt", async () => {
		AuthRecordingSocket.instances = [];
		const getAccessToken = vi
			.fn<() => Promise<string | null>>()
			.mockResolvedValueOnce("first")
			.mockResolvedValueOnce("workos:second");
		const client = new RefreshingCloudHubClient(
			buildCloudHubClientOptions({
				url: "wss://core-api.test/api/v1/session/ses-1",
				jwt: "",
				WebSocketImpl: AuthRecordingSocket,
			}),
			getAccessToken,
			async () => remoteSession({ id: asRemoteSessionId("ses-1") }),
		);

		const firstConnect = client.connect();
		await vi.waitFor(() =>
			expect(AuthRecordingSocket.instances).toHaveLength(1),
		);
		AuthRecordingSocket.instances[0]?.open();
		await firstConnect;
		client.close();

		const secondConnect = client.connect();
		await vi.waitFor(() =>
			expect(AuthRecordingSocket.instances).toHaveLength(2),
		);
		AuthRecordingSocket.instances[1]?.open();
		await secondConnect;

		expect(getAccessToken).toHaveBeenCalledTimes(2);
		expect(
			AuthRecordingSocket.instances.map(
				(socket) => socket.requestOptions?.headers?.Authorization,
			),
		).toEqual(["Bearer workos:first", "Bearer workos:second"]);
		client.close();
	});
});

describe("createCloudSessionHandle", () => {
	it("connects the newest remote session when no id is given", async () => {
		const gateway = new FakeRemoteSessionGateway([
			remoteSession({ id: asRemoteSessionId("ses-old"), updatedAt: 1000 }),
			remoteSession({ id: asRemoteSessionId("ses-new"), updatedAt: 5000 }),
		]);
		let connectedTo: RemoteSession | undefined;
		const clientFactory: HubClientFactory = ({ url, remoteSession: rs }) => {
			connectedTo = rs;
			expect(url).toBe("wss://core-api.test/api/v1/session/ses-new");
			return fakeClient();
		};

		const handle = await createCloudSessionHandle({
			apiBaseUrl: "https://core-api.test",
			getAccessToken: async () => "jwt",
			gateway,
			clientFactory,
		});

		expect(connectedTo?.id).toBe(asRemoteSessionId("ses-new"));
		expect(handle.needsCreate).toBe(false);
	});

	it("uses the selected model when lazily creating the inner session", async () => {
		let createPayload: Record<string, unknown> | undefined;
		const client = {
			connect: vi.fn(async () => {}),
			command: vi.fn(
				async (command: string, payload?: Record<string, unknown>) => {
					if (command === "session.list") return { payload: { sessions: [] } };
					if (command === "session.create") {
						createPayload = payload;
						return { payload: { session: { sessionId: "inner-1" } } };
					}
					return { payload: {} };
				},
			),
			close: vi.fn(),
			isConnected: () => true,
		} as unknown as HubClient;
		const gateway = new FakeRemoteSessionGateway([
			remoteSession({ id: asRemoteSessionId("ses-1") }),
		]);

		const handle = await createCloudSessionHandle({
			apiBaseUrl: "https://core-api.test",
			getAccessToken: async () => "jwt",
			remoteSessionId: asRemoteSessionId("ses-1"),
			modelId: "anthropic/claude",
			allowInitialCreate: true,
			gateway,
			clientFactory: () => client,
		});
		await handle.ensureSession();

		expect(createPayload).toMatchObject({
			workspaceRoot: "/workspace",
			sessionConfig: {
				providerId: "cline",
				modelId: "anthropic/claude",
				enableTools: true,
			},
		});
	});

	it("throws NoCloudSessionsError when the account has no sessions", async () => {
		await expect(
			createCloudSessionHandle({
				apiBaseUrl: "https://core-api.test",
				getAccessToken: async () => "jwt",
				gateway: new FakeRemoteSessionGateway([]),
				clientFactory: () => fakeClient(),
			}),
		).rejects.toBeInstanceOf(NoCloudSessionsError);
	});
});
