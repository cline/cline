/**
 * `startTestHub` — boots the real hub WebSocket server in-process on an
 * ephemeral port, backed by a {@link ScriptedRuntimeHost} instead of a model.
 *
 * Nothing about the server is faked: this is `startHubWebSocketServer` from
 * `@cline/core/hub`, with real subprotocol auth, real command dispatch and real
 * event projection. Only the runtime host is scripted.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createLocalHubScheduleRuntimeHandlers,
	type HubWebSocketServer,
	startHubWebSocketServer,
} from "@cline/core/hub";
import {
	createHubSocket,
	HubClient,
	type HubClientOptions,
} from "@cline/hub-client";
import type { HubEventEnvelope, HubReplyEnvelope } from "@cline/shared";
import { createSessionId } from "@cline/shared";
import type { RecordedFrame } from "./canonicalize";
import { createFrameRecorder, type FrameRecorder } from "./recorder";
import type { ApprovalMode, ScriptStep, TurnScript } from "./script";
import { ScriptedRuntimeHost } from "./scripted-runtime-host";

export interface StartTestHubOptions {
	/** Script for the first turn. Further turns come from {@link TestHub.script}. */
	script?: ScriptStep[] | TurnScript;
	/** Default approval behaviour for `{ kind: "tool" }` steps. */
	approvals?: ApprovalMode;
	workspaceRoot?: string;
	providerId?: string;
	modelId?: string;
	/**
	 * Pairing tree the hub reads offers and its identity key from. Defaults to a
	 * throwaway directory, so a test hub can never read (or enroll a device
	 * against) the developer's real `~/.cline` identity.
	 */
	pairingDir?: string;
}

export interface TestHubClientOptions
	extends Omit<HubClientOptions, "url" | "WebSocketImpl"> {
	/** Overrides the hub's real auth token; used to force auth failures. */
	credential?: string;
}

export interface TestHubClient {
	readonly client: HubClient;
	readonly recorder: FrameRecorder;
	/** Frames this client exchanged, in wire order (spans reconnects). */
	frames(): RecordedFrame[];
	/** Every event the client received, in order. */
	events(): HubEventEnvelope[];
	eventsNamed(name: HubEventEnvelope["event"]): HubEventEnvelope[];
	connect(): Promise<void>;
	subscribe(sessionId?: string): () => void;
	/**
	 * `subscribe` plus a round-trip that proves the hub registered it.
	 *
	 * `stream.subscribe` is fire-and-forget, so events triggered out-of-band (a
	 * released gate, another client's command) can be published before the hub has
	 * processed the subscription. Await this whenever the thing that produces
	 * events is not this client's own next command.
	 */
	subscribeReady(sessionId?: string): Promise<() => void>;
	/** Resolves once `count` events named `name` have arrived (already-seen count). */
	waitForEvent(
		name: HubEventEnvelope["event"],
		count?: number,
	): Promise<HubEventEnvelope>;
	/** Creates a session through the real `session.create` command. */
	createSession(): Promise<string>;
	sendInput(sessionId: string, prompt: string): Promise<HubReplyEnvelope>;
	close(): void;
}

export interface RawRegisterOptions {
	/**
	 * Version to advertise. `HubClient` pins this to the version it was compiled
	 * against, so an unsupported one is only reachable through this path.
	 */
	protocolVersion?: string;
	clientId?: string;
	clientType?: string;
}

export interface RawRegisterResult {
	/** Frames the raw socket exchanged, in wire order. */
	frames(): RecordedFrame[];
	/** The `client.register` reply, whether it succeeded or carried an error. */
	reply: HubReplyEnvelope;
}

export interface TestHub {
	readonly url: string;
	readonly authToken: string;
	/** Where this hub looks for its identity key and pending pairing offers. */
	readonly pairingDir: string;
	readonly runtimeHost: ScriptedRuntimeHost;
	/** Queue the script for the next turn. */
	script(script: ScriptStep[] | TurnScript): void;
	/** Unblock a `{ kind: "gate" }` step. */
	releaseGate(id: string): void;
	createClient(options?: TestHubClientOptions): TestHubClient;
	connectClient(options?: TestHubClientOptions): Promise<TestHubClient>;
	/**
	 * Hand-build and send one `client.register`, then return its reply.
	 *
	 * Exists because the registration handshake is the one command whose payload a
	 * `HubClient` caller cannot influence — `protocolVersion` is compiled in — so
	 * the hub's protocol-refusal path is unreachable through the normal client.
	 * The socket is closed before this resolves; nothing else is sent on it.
	 */
	registerRaw(options?: RawRegisterOptions): Promise<RawRegisterResult>;
	close(): Promise<void>;
}

const EVENT_WAIT_TIMEOUT_MS = 10_000;

/** Message-event payload -> parsed frame, for the raw (non-HubClient) socket. */
function parseSocketFrame(event: unknown): Record<string, unknown> | undefined {
	const data = (event as { data?: unknown })?.data ?? event;
	const text =
		typeof data === "string"
			? data
			: data instanceof Uint8Array
				? new TextDecoder().decode(data)
				: undefined;
	if (text === undefined) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export async function startTestHub(
	options: StartTestHubOptions = {},
): Promise<TestHub> {
	const runtimeHost = new ScriptedRuntimeHost({
		workspaceRoot: options.workspaceRoot,
		providerId: options.providerId,
		modelId: options.modelId,
		approvals: options.approvals,
	});
	if (options.script) {
		runtimeHost.enqueue(options.script);
	}

	// Hub discovery is a real on-disk record; point it at a throwaway directory so
	// a test hub can never be picked up as the developer's local hub.
	const discoveryDir = await mkdtemp(join(tmpdir(), "cline-hub-testkit-"));
	const pairingDir = options.pairingDir ?? join(discoveryDir, "hub", "pairing");
	const server: HubWebSocketServer = await startHubWebSocketServer({
		pairingDir,
		owner: {
			ownerId: "hub-testkit",
			discoveryPath: join(discoveryDir, "discovery.json"),
		},
		host: "127.0.0.1",
		port: 0,
		pathname: "/hub",
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		eventLog: { dbPath: ":memory:" },
		runQueue: { dbPath: ":memory:" },
		sessionHost: runtimeHost as never,
	});

	const clients = new Set<TestHubClient>();

	const createClient = (
		clientOptions: TestHubClientOptions = {},
	): TestHubClient => {
		const recorder = createFrameRecorder();
		const events: HubEventEnvelope[] = [];
		const waiters = new Set<() => void>();
		const client = new HubClient({
			clientType: "hub-testkit",
			displayName: "hub-testkit",
			workspaceRoot: runtimeHost.workspaceRoot,
			cwd: runtimeHost.workspaceRoot,
			...clientOptions,
			url: server.url,
			authMode: clientOptions.authMode ?? "hub-subprotocol",
			credential: clientOptions.credential ?? server.authToken,
			WebSocketImpl: recorder.socketCtor(),
		});

		const notify = (): void => {
			for (const waiter of [...waiters]) {
				waiter();
			}
		};

		const testClient: TestHubClient = {
			client,
			recorder,
			frames: () => recorder.frames(),
			events: () => [...events],
			eventsNamed: (name) => events.filter((event) => event.event === name),
			connect: () => client.connect(),
			subscribe: (sessionId) =>
				client.subscribe(
					(event) => {
						events.push(event);
						notify();
					},
					sessionId ? { sessionId } : undefined,
				),
			subscribeReady: async (sessionId) => {
				const unsubscribe = testClient.subscribe(sessionId);
				// Frames on one socket are processed in order, so any completed
				// round-trip proves the preceding `stream.subscribe` landed. Pending
				// approvals are the natural thing for a (re)connecting client to ask
				// for, and the reply does not depend on other clients' lifecycle.
				await client.command(
					"approval.list_pending",
					sessionId ? { sessionId } : {},
					sessionId,
				);
				return unsubscribe;
			},
			waitForEvent: async (name, count = 1) => {
				const matching = (): HubEventEnvelope[] =>
					events.filter((event) => event.event === name);
				if (matching().length >= count) {
					return matching()[count - 1] as HubEventEnvelope;
				}
				return await new Promise<HubEventEnvelope>((resolve, reject) => {
					const timer = setTimeout(() => {
						waiters.delete(check);
						reject(
							new Error(
								`Timed out waiting for ${count}x ${name}; saw [${events
									.map((event) => event.event)
									.join(", ")}]`,
							),
						);
					}, EVENT_WAIT_TIMEOUT_MS);
					const check = (): void => {
						const found = matching();
						if (found.length < count) {
							return;
						}
						clearTimeout(timer);
						waiters.delete(check);
						resolve(found[count - 1] as HubEventEnvelope);
					};
					waiters.add(check);
					check();
				});
			},
			createSession: async () => {
				const reply = await client.command("session.create", {
					workspaceRoot: runtimeHost.workspaceRoot,
					cwd: runtimeHost.workspaceRoot,
					sessionConfig: {
						providerId: options.providerId ?? "testkit",
						modelId: options.modelId ?? "testkit-model",
						cwd: runtimeHost.workspaceRoot,
						workspaceRoot: runtimeHost.workspaceRoot,
						systemPrompt: "testkit",
					},
					metadata: { source: "core", interactive: true },
				});
				const session = reply.payload?.session as
					| { sessionId?: string }
					| undefined;
				if (!session?.sessionId) {
					throw new Error("session.create did not return a session id");
				}
				return session.sessionId;
			},
			sendInput: (sessionId, prompt) =>
				client.command("session.send_input", { sessionId, prompt }, sessionId),
			close: () => client.close(),
		};
		clients.add(testClient);
		return testClient;
	};

	const registerRaw = async (
		rawOptions: RawRegisterOptions = {},
	): Promise<RawRegisterResult> => {
		const recorder = createFrameRecorder();
		const socket = createHubSocket({
			url: server.url,
			authMode: "hub-subprotocol",
			credential: server.authToken,
			WebSocketImpl: recorder.socketCtor(),
		});
		const clientId = rawOptions.clientId ?? "client-raw";
		const requestId = createSessionId("hubreq_");
		try {
			const reply = await new Promise<HubReplyEnvelope>((resolve, reject) => {
				const timer = setTimeout(
					() =>
						reject(
							new Error("Timed out waiting for the client.register reply"),
						),
					EVENT_WAIT_TIMEOUT_MS,
				);
				const settle = (
					outcome: () => void,
				): ((...args: unknown[]) => void) => {
					return () => {
						clearTimeout(timer);
						outcome();
					};
				};
				socket.addEventListener(
					"error",
					settle(() => reject(new Error("Raw register socket errored"))),
				);
				socket.addEventListener(
					"close",
					settle(() =>
						reject(new Error("Raw register socket closed before replying")),
					),
				);
				socket.addEventListener("message", (event: unknown) => {
					const frame = parseSocketFrame(event);
					const envelope = frame?.envelope as HubReplyEnvelope | undefined;
					if (frame?.kind !== "reply" || envelope?.requestId !== requestId) {
						return;
					}
					clearTimeout(timer);
					resolve(envelope);
				});
				socket.addEventListener("open", () => {
					socket.send(
						JSON.stringify({
							kind: "command",
							envelope: {
								version: "v1",
								command: "client.register",
								requestId,
								clientId,
								payload: {
									clientId,
									clientType: rawOptions.clientType ?? "hub-testkit",
									displayName: "hub-testkit",
									transport: "native",
									actorKind: "client",
									workspaceContext: {
										workspaceRoot: runtimeHost.workspaceRoot,
										cwd: runtimeHost.workspaceRoot,
									},
									// Deliberately not `satisfies HubClientRegistration`:
									// `protocolVersion` is typed as the literal union of versions
									// this build knows, and sending one outside it is the whole
									// point of this helper.
									...(rawOptions.protocolVersion
										? { protocolVersion: rawOptions.protocolVersion }
										: {}),
								},
							},
						}),
					);
				});
			});
			return { frames: () => recorder.frames(), reply };
		} finally {
			socket.close();
		}
	};

	return {
		url: server.url,
		authToken: server.authToken,
		pairingDir,
		runtimeHost,
		script: (script) => runtimeHost.enqueue(script),
		releaseGate: (id) => runtimeHost.releaseGate(id),
		createClient,
		registerRaw,
		connectClient: async (clientOptions) => {
			const testClient = createClient(clientOptions);
			await testClient.connect();
			return testClient;
		},
		close: async () => {
			for (const testClient of clients) {
				testClient.close();
			}
			clients.clear();
			await server.close();
			await rm(discoveryDir, { recursive: true, force: true });
		},
	};
}
